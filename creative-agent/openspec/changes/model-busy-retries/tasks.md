# Tasks: model busy retries

Tests first, seen failing. From `krita-creative-agent`: `npm run -s test:unit`, `npm run -s typecheck`.

- [x] 1. `src/model-trouble.ts`: `modelTrouble(message)` (kind and code), `retryStatus(...)`, `pausedMessage(...)`,
      `MODEL_RETRY`. Tests: `tests/model-trouble.test.ts`, with the Istanbul error text.
- [x] 2. `runtime.mjs`: the retry settings, the status line, the paused message and the diagnostic fields use it.
- [x] 3. Typecheck and the unit suite pass.
- [ ] 4. Live in Toska: a rate-limited model shows the new status line. Needs a model that is being rate-limited.
