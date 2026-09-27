# WORKLOG

1. Diagnosis (see REQ): the double compression came from a stale usage value on the re-request. The
   81% came from a wrong denominator of 95232.
2. Fix A: `session.stats` gained `+compressCreditTokens` (in-memory). `stream.ts` `applyRanges`
   accumulates and nets immediately. Three recorders net it: `loop/core.ts` `recordUsage`,
   `plugin.ts` `applyUsageSample`, and the non-streaming JSON path in server.ts. The three `prepare`
   sites in server.ts zero it after `processTurn`. `persist.ts` sets it to 0 on restore.
   - A trap: inserting a non-nullable type into the middle of a TS `??` chain collapses the
     subsequent undefined branches (the native chain reported TS2322) → wrap it in a
     `launcherContextWindow()` annotated `number | undefined`.
3. Fix C: `client-config.ts` gained `+ModelWindow` / `toModelWindow`. `PiProvider` / `OmpProvider` /
   `OpencodeProvider` gained `+models`. `parseOmpYaml`'s state machine gained dashIndent (in the real
   file the dash lines are indented 6 while the models line is 4, so the first version's `===` match
   found nothing and returned an empty result; real-machine verification caught this). `baseUrl` sits
   at the same level as models, so use `<=` to catch it. `parseCodexToml` captures
   `model` + `model_context_window`. `readOpencodeConfig` captures `limit`. `collectModelWindows`
   takes the largest window for a colliding id. `launcher.ts` `LaunchOptions.modelWindows` goes to
   env, and both `runLaunch` call sites are wired. server.ts gained `parseLauncherModelWindows`
   (exported as a pure function) inserted into the native chain.
4. Tests: `tests/model-windows.test.ts` (9 cases: three omp YAML shapes, codex, pi, opencode,
   collect collision, launcher env parsing). `tests/compress-credit.test.ts` (netting on a successful
   compression + zero credit on a failed compression). `launcher.test.ts` +1 (the proxy spawn env
   carries the window JSON, in the real omp models.yml shape). 628/628 + typecheck + build green.
5. e2e: dist + `BILI_LAUNCHER_MODEL_WINDOWS='{"test-model-x":262144}'` + a mock upstream +
   `max_tokens` 32768 → the log denominator was 229376 (= 262144−32768). Before the fix it would
   have been 95232.
6. Lessons: TS `??` chains collapse types. A YAML indent state machine must be verified against a
   real file. Any test of the dist service must pass `--no-auto-update`.
