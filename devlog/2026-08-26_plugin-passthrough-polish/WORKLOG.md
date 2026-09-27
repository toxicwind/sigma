# WORKLOG

- Branch `2026-08-26_plugin-passthrough-polish` (from master 159e82b, with #259 already merged).
- `src/plugin.ts`:
  - `pipePluginJson` gained a responses branch at the tail: when the body contains a render tag,
    run `stripResponsesText` and re-serialize before returning. The openai protocol and a body with
    no tags stay byte-identical. This aligns with the compress loop's JSON branch
    (`compressLoopResponsesJson` strips every round).
  - `rebuildEvent` hardened: after replacing the first `data:` line, every later `data:` line is
    dropped, so a multi-line data payload is collapsed into a single-line rebuild rather than
    concatenating two JSON values.
  - `pipePluginResponsesWithStrip`: once the read loop ends, if the response is not yet destroyed,
    flush the held tail as a final delta, so prose is not lost when the stream is cut off.
- `src/loop/adapter-responses.ts` `dropWhitespaceResponsesMessages`: a non-object content part
  (such as `content: [42]`) changed from "silently skipped" to mixed → the whole item is kept,
  because an unknowable emptiness must not cause a deletion.
- Tests:
  - `tests/plugin-passthrough-tag-strip.test.ts` +4: flush the tail when the stream is cut off /
    collapse multi-line data / `pipePluginJson` responses strip / `pipePluginJson` openai and
    no-tag cases are byte-identical. A trap: the quotes inside a tag in the test payload must be
    JSON-escaped (`\"`), otherwise the payload is itself invalid JSON, it takes the verbatim
    fallback path, and the test fails for the wrong reason. `makeRes.end` has to record its content.
  - `tests/responses-empty-messages.test.ts` +1: a malformed part → the item is kept.
- Verification: typecheck ✓ 646/646 ✓ build ✓.
- Note 4 (not stripping on the openai protocol) stays as it is: every observed tag-echo loop was
  omp/Responses. Widening the scope waits until a real case appears.
