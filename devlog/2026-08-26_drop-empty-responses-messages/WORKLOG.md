# WORKLOG — drop whitespace-only Responses message items

## 2026-08-26

### Diagnosis

1. **Session file forensics** `~/.omp/agent/sessions/-tmp/2026-08-26T10-35-43-161Z_01a03da3-....jsonl`:
   - One local assistant message = a content block array `[thinking, text("\n\n"), toolCall(read), text("\n"), toolCall(read)]`
   - Valid JSON throughout, **not split on carriage returns**.
2. **The wire layer flattens**: the Responses API `input` is a flat list of entries (message / function_call / function_call_output, each at the top level). There is no anthropic-style "one message with mixed blocks" expression, so when omp serializes, each text block becomes its own message item. A whitespace text block (the `\n\n` the model emits before a tool call) therefore becomes a standalone empty message. This is forced by the protocol, not an omp bug.
3. **pi comparison** (6 real sessions): an anthropic-wire content field is already a block array, so a whitespace block sits inside a mixed message as-is → 162 whitespace blocks, all internal to mixed messages, **0 standalone empty messages**. pi is unaffected.
4. **Three layers of responsibility**: the model emits `\n\n` (a SGLang habit, normal) / omp flattens (forced by the protocol) / **bili stamps a 42-character tag plus a number onto 1-token whitespace (the only layer worth fixing)**.
5. **A stickiness finding**: replaying the request dumps (`~/.local/state/billion-context/dumps/req-*-9d41f1d8aa9cd4f3.json`, 8 of them) showed a plain `trim()` emptiness check dropped 0 items, because the tag stamped in an earlier round had already turned the whitespace into 43 characters of "non-empty" text that omp replays verbatim → the tag must be **stripped before the emptiness check**.

### Fix

- `src/loop/adapter-responses.ts`:
  - `dropWhitespaceResponsesMessages(input): number` — walks in reverse; requires `type === "message" || undefined` (omp's user entries carry no type) + role user/assistant + pure-text content (an array containing anything other than text/input_text/output_text parts is marked mixed and kept) + `stripRenderTags` followed by a trim to empty → splice.
  - `RENDER_TAG_RE` (per the source rule that any `<acp>` XML is hex-escaped) + `stripRenderTags()`: strips `<acp ...>ref</acp>` and its self-closing form. A tag wrapping real content (such as the actual text `m00002`) is never deleted.
- `src/server.ts` `prepareResponses`: called after `sanitizeResponsesInputIds`. When dropped > 0 it logs `dropped N whitespace-only message item(s) before projection (flattened-turn artifact)`.
- `tests/responses-empty-messages.test.ts` 4 tests: a mixed shape drops 3 and keeps 6 / emptiness is judged after stripping the tag (tag over nothing is dropped, tag over content is kept) / string content and developer/system roles are never dropped / non-array content is tolerated and refusal parts are kept.

### Verification

- Real dump replay: 8 historical requests dropped `0/0/2/2/3/3/4/2` — 2 to 4 empty shells stripped per request.
- `632/632` tests + typecheck + build all green.

### Decision

- **Not folded into PR #257** (the omp native plugin, CI green and awaiting merge). There is zero file overlap and the two have different purposes: #257 restores native mode, while this fix is wire-mode context hygiene that stays useful for every Responses client that is not bound to the plugin — in native mode the first request (before binding) still produces empty messages, so the two fixes are complementary.
- Branch `2026-08-26_drop-empty-responses-messages` from master `5982720`.

### Lessons

- A whitespace message that reads as "non-empty" in a dump is tag stickiness. The emptiness check must strip the tag first.
- Any `<acp>` XML inside source must be hex-escaped as `\x3c/\x3e` (an AGENTS.md rule).
