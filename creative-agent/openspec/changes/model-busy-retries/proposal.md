# Model busy retries: a rate limit is named, waited out, and never loses the move

Status: APPROVED by the artist (2026-11-10: "fix that yes").

## Why

- **Istanbul repaint chat (2026-11-10, 14:39).** The painter model (Qwen3-VL 235B through OpenRouter) was refused three
  times in twenty seconds with `429 ... temporarily rate-limited upstream` (`engine_overloaded`, the hosts' shared
  pool). Each refusal came back in half a second. The status line said "Temporary model connection problem", which it
  was not: the network was fine.
- **Two retries in three seconds.** `retry: { maxRetries: 2, baseDelayMs: 1000 }` waits 1 s and 2 s. An overloaded host
  does not recover in three seconds; one more refusal would have stopped the run with the provider's raw JSON as the
  message.
- **The log does not say why.** `model_auto_retry_start` records no cause; it had to be read from the transcript.

## Goals

1. The status line names the trouble: a rate limit or overload ("The model is busy at its provider"), a network failure
   ("Connection problem"), a provider fault ("The model's provider had an error"), each with the wait and the attempt.
2. Five retries with waits of 3, 6, 12, 24 and 48 seconds (93 s in all) instead of two in 3 s.
3. When the retries run out the run pauses with a plain message in place of the raw error: what happened, that nothing
   on the canvas was lost, and what to do (send a message to try again; for a busy model, choose another model or
   connect your own provider key). A lapsed sign-in keeps its own message.
4. `model_auto_retry_start` records the kind of trouble and the status code.

## Not in this change

- Waiting the time a provider asks for (`Retry-After`): the model library does not pass that header on.
- A "Try again" button in the panel: any message continues the move today.
- Switching to another host or model by itself.
