# WORKLOG — joint regression of PR#257 + PR#258

## 2026-08-26

### Merge

- Branch `2026-08-26_regression-257-258` from master `5982720`
- merge #257 (4ca494e) + merge #258 (7f33f9e) — **zero conflicts** (#257 changed agent/pi.ts +
  plugin-agent.test.ts + CONFIGURATION; #258 changed loop/adapter-responses.ts + server.ts
  prepareResponses + a new test file; each branch inserted one line into CHANGELOG
  [Unreleased], and the merge left no duplicate)
- Pre-check: typecheck ✓ / **636/636** (632 + 4 new) / build ✓

### e2e setup

- `/tmp/reg-e2e/`: isolated `PI_CODING_AGENT_DIR` (models.yml pointing at the mock), isolated
  `SIGMA_SESSIONS_DIR`
- mock.py (tmux regmock, 127.0.0.1:19941): **routing by content** (not by turn count — the first
  attempt counted turns and backfired: omp's title request stole turn 1's script):
  - no tools → title request → plain-text title
  - has tools and input has no `function_call_output` → main turn 1 → **a blank
    text("\n\n") block + function_call(acp_status)** mixed turn (manufacturing both verification
    conditions — a flattened empty message and a native tool call — in one go)
  - has `function_call_output` → final text `REG-E2E-OK-2`
  - log the tools list and the shape of the input entries for every request (including the
    character count of each text part / WS markers)
- How it was run: `node dist/index.js --no-auto-update --port 19942 omp -p "status please"`
  (the launcher starts the proxy itself; it actually used 37349)

### e2e results (all four points hit in a single run)

| Verification point | Evidence |
|---|---|
| #257 native tools reach the main turn | main-turn tools = omp's 11 built-ins + `compress,decompress,search_context,acp_status`, **one copy each** (mock log turn 2) |
| #257 identity binding | both main turns log `injectTool=false (plugin mode: wire injection suppressed)` (bound on the first request) |
| #257 native tools really execute | `[plugin] tool acp_status executed via plugin (285 chars)` — the model calls acp_status → omp validates it → forwardTool → /__bili/plugin/tool → the kernel actually adjudicates it |
| #258 blank messages dropped | turn 2's request replays the flattened entries → `dropped 1 whitespace-only message item(s) before projection (flattened-turn artifact)` → the mock's turn 3 input holds only `[developer, user, function_call, function_call_output]`, with **no blank message item** |

- Zero interaction pollution: isolated PI_CODING_AGENT_DIR + the launcher's temporary overlay;
  exit 0, output `REG-E2E-OK-2`

### Wrap-up

- Cleaned up tmux regmock/regproxy + `/tmp/reg-e2e`
- pushed the branch → PR (joint regression, same pattern as #250; a supersede comment left on
  #257/#258)

### Lessons

- The mock router should route **by request content** (tools present or not / function_call_output
  present or not), not by turn count — omp's title request (no tools) will steal the first turn's
  script
- A single omp headless `-p` run is naturally multi-turn: the main turn's tool call → omp executes
  it → replaying function_call+output is the second request, which is enough to verify #258

### Gap found in review, appended after the merge

- The local merge above pulled in only the two PRs' **initial commits** (f5342f3 / 7e7fbb1) and
  missed the fixes each pushed during review:
  - `2a1bd22` (#257 branch): retry after an identity register failure — without the fix, a
    register failure pins the whole session into wire mode (ACP tools duplicated)
  - `21fa531` (#258 branch): a duplicated `### Fixes` heading in CHANGELOG
- Two more merges (zero conflicts): `a05cba5` (merge #257 head) + `cffc5d5` (merge #258 head)
- Re-ran the pre-check: typecheck ✓ / **636/636** / build ✓ (dist/index.js 2.48 MB,
  dist/agent/omp.js 11.79 KB)
- The e2e conclusion still holds for the new tree: 2a1bd22 only changes the register **failure**
  path (the e2e walked the happy path where binding succeeds on the first request, so the end
  state is identical); 21fa531 is docs-only

## Follow-up: plugin-mode passthrough tag-echo strip (same day)

User reported a NEW omp session (post-#257 testing) filling with fake render tags
(`<acp tokens="247" type="text">m00042</acp>`, same ref, tokens counting down) and the
model never quoting the requested text. First diagnosis blamed an old Aug-24 proxy
process — WRONG (user challenged it; the session was on the fresh sigma-omp proxy).
Real root cause: `server.ts` plugin-mode branch pipes the upstream Responses stream
VERBATIM (`pipeThroughWithUsage`), and the tag-echo stripper (#206) only exists in the
compress-loop stream path — bringing omp into plugin mode (#257) bypassed the output-side
strip, so fake tags flowed back verbatim, omp flattened them into session items, replay
amplified them, and #258's ingress drop could not save mixed (tag+prose) messages.

Fix (on this regression branch):
- `src/loop/tag-echo-filter.ts`: `TagEchoFilter` gains `pending(): boolean`.
- `src/plugin.ts`: new `pipePluginResponsesWithStrip(stream, res, session, log?)` —
  event-level passthrough that filters `output_text.delta` through the same
  `createTagEchoFilter` state machine (fast path when no tag and nothing pending),
  flushes held tail as a delta before done-family events, strips full-text fields of
  done events, keeps every other event byte-identical; samples usage from
  `ev.response.usage`.
- `src/server.ts`: plugin-mode branch uses the new pipe for protocol "responses".

Verification: tests/plugin-passthrough-tag-strip.test.ts 4/4 (single-event strip,
split-across-deltas strip + tail flush with item_id, byte-identical passthrough for
clean events, done-payload strip); full suite 640/640; typecheck; build. Real omp e2e
(isolate PI_CODING_AGENT_DIR + full lifecycle mock): proxy log shows
`injectTool=false (plugin mode)` + `[tag-echo] stripped ... (plugin passthrough)` and
omp receives `Here:  ECHO-DONE` — tag gone, prose intact. (First e2e attempt failed
with "stream closed before terminal event" — mock lacked output_item.added/
content_part events; pi-ai Responses parser needs the full lifecycle chain.)

Also fixed a duplicated `### Fixes` header in [Unreleased] (merge artifact from #258's
CHANGELOG edit) while adding the entry.

User recovery: kill the pre-fix proxy; next `sigma omp` spawns a fresh one with the strip.
Poisoned session (01a03dcb) is unrecoverable — start a new session.
