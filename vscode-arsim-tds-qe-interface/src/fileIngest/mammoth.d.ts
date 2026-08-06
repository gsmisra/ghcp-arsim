/**
 * mammoth ships no TypeScript types of its own and there's no reliable
 * @types/mammoth package to depend on. Minimal ambient declaration limited
 * to the one function this extension actually calls.
 */
declare module 'mammoth' {
  export interface ConvertResult {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(input: { buffer: Buffer }): Promise<ConvertResult>;
}
