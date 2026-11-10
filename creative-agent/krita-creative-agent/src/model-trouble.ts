// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// What a failed model request was, in the artist's words (openspec model-busy-retries).
//
// Every failed request used to read "Temporary model connection problem" and was retried twice in three seconds. In
// the Istanbul repaint chat (2026-11-10) the trouble was the model's hosts refusing with 429 (overloaded, shared
// pool): the network was fine, and an overloaded host does not recover in three seconds.

export type TroubleKind = 'busy' | 'connection' | 'provider' | 'other';
export interface Trouble { kind: TroubleKind; code: number | null }

/** The model retries: waits of 3, 6, 12, 24 and 48 seconds (the library doubles the base each attempt). */
export const MODEL_RETRY = Object.freeze({ maxRetries: 5, baseDelayMs: 3000, maxAgentDelayMs: 60000 });

const BUSY = /rate.?limit|too many requests|overloaded|capacity|quota|resource.?exhausted|throttl/i;
const CONNECTION = /fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|timed? ?out|terminated|connection (error|closed|reset|refused)|other side closed/i;

/** The status code a message leads with ("429: {...}", "503 unavailable") or carries as a "code"/"status" field. */
function statusCode(text: string): number | null {
  const found = /^\s*(?:error:?\s*)?([1-5]\d\d)\b/i.exec(text) ?? /"(?:code|status|status_code)"\s*:\s*"?([1-5]\d\d)\b/.exec(text);
  return found ? Number(found[1]) : null;
}

export function modelTrouble(message: unknown): Trouble {
  const text = typeof message === 'string' ? message : '';
  const code = statusCode(text);
  if (code === 429 || code === 529 || (code === null && BUSY.test(text))) return { kind: 'busy', code };
  if (code !== null && code >= 500) return { kind: BUSY.test(text) ? 'busy' : 'provider', code };
  if (code === null && CONNECTION.test(text)) return { kind: 'connection', code };
  return { kind: 'other', code };
}

const WHAT: Record<TroubleKind, string> = {
  busy: 'The model is busy at its provider',
  connection: 'Connection problem',
  provider: "The model's provider had an error",
  other: 'The model request failed',
};

/** The status line while a retry waits. */
export function retryStatus(trouble: Trouble, attempt: number, attempts: number, delayMs: number): string {
  return WHAT[trouble.kind] + '. Trying again in ' + Math.max(1, Math.round(delayMs / 1000)) + ' s (' + attempt + '/' + attempts + ')…';
}

/** The message a run pauses with once the retries ran out. `raw` is the provider's own text, already redacted: an
 *  error that is not a passing one keeps it, since it says what to change. */
export function pausedMessage(trouble: Trouble, raw: string): string {
  if (trouble.kind === 'other') return raw;
  const what = WHAT[trouble.kind] + (trouble.code === null ? '' : ' (' + trouble.code + ')') + ' and did not recover after several tries. Nothing on the canvas was lost. ';
  if (trouble.kind === 'busy') return what + 'Send a message to try again, or choose another model. With your own provider key the shared limit does not apply.';
  if (trouble.kind === 'connection') return what + 'Check the internet connection, then send a message to try again.';
  return what + 'Send a message to try again, or choose another model.';
}
