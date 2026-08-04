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

function modelUid(m: vscode.LanguageModelChat): string {
  return `${m.vendor || '_'}:${m.id || m.family || '_'}`;
}

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
    response = await model.sendRequest(messages, {}, handlers.token);
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

export async function testConnection(
  modelUid: string
): Promise<{ model: string; response: string }> {
  const model = await resolveModel(modelUid);
  let text = '';
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User('Who are you ?')],
      {},
      undefined
    );
    for await (const fragment of response.text) {
      text += fragment;
    }
  } catch (error) {
    throw translateLmError(error);
  }
  return { model: model.name || model.id || 'unknown', response: text.trim() };
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
