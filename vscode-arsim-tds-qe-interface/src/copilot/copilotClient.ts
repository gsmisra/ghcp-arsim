import * as vscode from 'vscode';
import { ModelInfo } from '../types';

/**
 * Thin wrapper around the built-in VS Code Language Model API
 * (`vscode.lm`), which is how GitHub Copilot Chat models are exposed to
 * other extensions. This is the *only* integration point with GHCP --
 * there is no HTTP hop, no child process, and no polling, so requests are
 * as fast as the editor's own Copilot Chat view.
 *
 * `vscode.lm` only exists on VS Code builds that ship the stable Language
 * Model API (1.90+). Older hosts simply don't have the namespace, so every
 * entry point here feature-detects first and throws a friendly, actionable
 * error instead of a TypeError -- this is what makes the extension
 * "backward compatible": it still activates and renders its UI on older
 * VS Code, it just tells the user plainly that Copilot features need an
 * upgrade rather than silently failing.
 */

export const MIN_LM_API_HINT =
  'GitHub Copilot chat model access requires VS Code 1.90 or newer. Please update VS Code to use this feature.';

export function isLanguageModelApiAvailable(): boolean {
  return typeof (vscode as unknown as { lm?: unknown }).lm !== 'undefined';
}

/** How long a single `vscode.lm` call is given before it's treated as
 *  stalled rather than merely slow. */
const LM_CALL_TIMEOUT_MS = 18000;

/** Thrown by withLmTimeout specifically (never by a real vscode.lm
 *  rejection) so callers can tell "this call stalled" apart from "this
 *  call genuinely failed" and react differently -- see
 *  orderedCandidateModels()/sendChatWithFallback() below, which retry on
 *  this error specifically and let every other error surface as-is. */
export class LmTimeoutError extends Error {}

/**
 * `vscode.lm` calls (`sendRequest`, `countTokens`) can sit pending forever
 * rather than rejecting -- the most common real-world cause is VS Code's
 * one-time "Allow this extension to use GitHub Copilot" consent
 * notification for a new request shape, which is easy to miss (it doesn't
 * appear inside this panel) and leaves the underlying promise neither
 * resolved nor rejected until it's clicked. Racing against a timeout is
 * what turns that into a bounded, actionable failure instead of a UI that
 * spins forever with the Context Limit meter stuck at 0 and no way to
 * tell why. This does not cancel the underlying `vscode.lm` call (arbitrary
 * promises can't be cancelled) -- it just stops *waiting* on it, which is
 * enough to let the caller's catch block run and recover the UI.
 */
function withLmTimeout<T>(thenable: Thenable<T>, label: string, timeoutMs = LM_CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new LmTimeoutError(
          `${label} did not respond within ${timeoutMs / 1000}s. If this is the first Copilot ` +
            `request this session, check for a "Allow this extension to use GitHub Copilot" notification ` +
            `(it can appear outside this panel) and approve it, then try again.`
        )
      );
    }, timeoutMs);
    thenable.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Exported (as `getModelUid`, avoiding a name clash with the many local
 *  `modelUid: string` message fields elsewhere in this codebase) so a
 *  caller that ends up with a `vscode.LanguageModelChat` object -- e.g.
 *  after a fallback retry picked a model different from what was asked
 *  for -- can report back which model it actually used, in the same uid
 *  shape the webview already understands from listModels(). */
function modelUid(m: vscode.LanguageModelChat): string {
  return `${m.vendor || '_'}:${m.id || m.family || '_'}`;
}
export const getModelUid = modelUid;

export async function listModels(): Promise<ModelInfo[]> {
  if (!isLanguageModelApiAvailable()) {
    throw new Error(MIN_LM_API_HINT);
  }
  const models = await vscode.lm.selectChatModels();
  return (models || []).map((m) => ({
    uid: modelUid(m),
    id: m.id || '',
    name: m.name || m.id || 'Unknown model',
    vendor: m.vendor || '',
    family: m.family || '',
  }));
}

export async function resolveModel(preferredUid?: string): Promise<vscode.LanguageModelChat> {
  if (!isLanguageModelApiAvailable()) {
    throw new Error(MIN_LM_API_HINT);
  }
  const models = await vscode.lm.selectChatModels();
  if (!models || models.length === 0) {
    throw new Error(
      'No GitHub Copilot chat models are available. Make sure the GitHub Copilot / Copilot Chat extension is installed, signed in, and enabled for this workspace.'
    );
  }
  if (preferredUid) {
    const match = models.find((m) => modelUid(m) === preferredUid);
    if (match) return match;
  }
  return models[0];
}

/**
 * Same lookup as resolveModel(), but returns every available model in try
 * order: the preferred/default one first, then the rest -- so a caller can
 * retry with the next model the instant the first one stalls, instead of
 * the user having to notice and manually switch the model dropdown
 * themselves (which is what this automates).
 */
export async function orderedCandidateModels(preferredUid?: string): Promise<vscode.LanguageModelChat[]> {
  if (!isLanguageModelApiAvailable()) {
    throw new Error(MIN_LM_API_HINT);
  }
  const models = await vscode.lm.selectChatModels();
  if (!models || models.length === 0) {
    throw new Error(
      'No GitHub Copilot chat models are available. Make sure the GitHub Copilot / Copilot Chat extension is installed, signed in, and enabled for this workspace.'
    );
  }
  const preferred = preferredUid ? models.find((m) => modelUid(m) === preferredUid) : undefined;
  return preferred ? [preferred, ...models.filter((m) => m !== preferred)] : models;
}

export interface StreamHandlers {
  onChunk: (text: string) => void;
  token?: vscode.CancellationToken;
}

/**
 * Sends a single-turn chat request built from pre-assembled context and
 * streams the response back chunk-by-chunk via `onChunk` so the webview
 * can render tokens as they arrive (no buffering, no artificial lag).
 */
export async function sendChat(
  model: vscode.LanguageModelChat,
  systemPrompt: string,
  userContent: string,
  handlers: StreamHandlers
): Promise<string> {
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userContent),
  ];

  let response: vscode.LanguageModelChatResponse;
  try {
    // Only the request's *start* is timeout-guarded -- once the model
    // begins streaming, a verbose real answer legitimately keeps this
    // promise's continuation (the `for await` below) busy for a while,
    // and that is not the "stalled" case this guards against.
    response = await withLmTimeout(model.sendRequest(messages, {}, handlers.token), 'The Copilot chat request');
  } catch (error) {
    throw translateLmError(error);
  }

  let full = '';
  try {
    for await (const fragment of response.text) {
      full += fragment;
      handlers.onChunk(fragment);
    }
  } catch (error) {
    throw translateLmError(error);
  }
  return full;
}

/**
 * Sends a chat request against `candidates[0]`, and if -- and only if --
 * that specific model stalls (LmTimeoutError; a real error like
 * "content blocked" or "permission denied" is not retried, since trying a
 * different model wouldn't change that outcome), automatically retries
 * with the next candidate, and the next, until one responds or the list is
 * exhausted. This is what used to require the user to notice their chat
 * was stuck and manually pick a different model from the dropdown --
 * automated, and paid only when the default model actually needs it (no
 * added latency in the normal case, since the first candidate is always
 * tried directly with no upfront probing).
 */
export async function sendChatWithFallback(
  candidates: vscode.LanguageModelChat[],
  systemPrompt: string,
  userContent: string,
  handlers: StreamHandlers
): Promise<{ text: string; model: vscode.LanguageModelChat; switched: boolean }> {
  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    try {
      const text = await sendChat(candidates[i], systemPrompt, userContent, handlers);
      return { text, model: candidates[i], switched: i > 0 };
    } catch (error) {
      lastError = error;
      const isStall = error instanceof LmTimeoutError;
      if (!isStall || i === candidates.length - 1) throw error;
      // else: this model didn't respond in time -- try the next one.
    }
  }
  throw lastError;
}

/**
 * Counts tokens for a piece of content using the *selected model's own*
 * tokenizer (`LanguageModelChat.countTokens`). This is what makes the
 * token panel trustworthy: it's not a generic heuristic (e.g. chars/4) --
 * it's the same tokenizer the model itself will bill against. If a given
 * model doesn't support counting (older/limited providers), we fail soft
 * and surface `null` so the UI can show "unavailable" instead of a
 * misleading zero.
 */
export async function countTokens(
  model: vscode.LanguageModelChat,
  content: string | vscode.LanguageModelChatMessage,
  token?: vscode.CancellationToken
): Promise<number | null> {
  try {
    const count = await withLmTimeout(model.countTokens(content, token), 'A Copilot token-count request');
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

export async function testConnection(
  modelUid: string
): Promise<{ model: string; response: string; promptTokens: number | null; completionTokens: number | null }> {
  const model = await resolveModel(modelUid);
  const probe = 'Who are you ?';
  let text = '';
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(probe)],
      {},
      undefined
    );
    for await (const fragment of response.text) {
      text += fragment;
    }
  } catch (error) {
    throw translateLmError(error);
  }
  const [promptTokens, completionTokens] = await Promise.all([
    countTokens(model, probe),
    countTokens(model, text),
  ]);
  return { model: model.name || model.id || 'unknown', response: text.trim(), promptTokens, completionTokens };
}

function translateLmError(error: unknown): Error {
  if (error instanceof vscode.LanguageModelError) {
    switch (error.code) {
      case 'NoPermissions':
        return new Error(
          'Access to the Copilot chat model was not granted. Approve the permission prompt VS Code shows and try again.'
        );
      case 'Blocked':
        return new Error('The request was blocked by content filtering.');
      case 'NotFound':
        return new Error('The selected model is no longer available. Pick another model.');
      default:
        return new Error(`Copilot request failed (${error.code}): ${error.message}`);
    }
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
