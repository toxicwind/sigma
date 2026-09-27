# REQ - "zero model request" sessions under the dsh profile: making the symptom self-diagnosable and settleable in one pass (#1158)

- Task ID: `2026-09-23_dsh-llm-pi-ai-fetch-bypass`
- Home Repo: `billion-context`
- Created: 2026-09-23 (second revision the same day: the root-cause attribution was withdrawn, see §1)
- Status: Done
- Priority: P1
- Owner: xiaofengkuai / ework-agent
- References: https://github.com/ranxianglei/billion-context/issues/1158

## 1. Background & Problem Statement

- **Context**: dsh's native plugin (installed through a profile, no launcher) takes over model traffic via a `globalThis.fetch` patch (`src/agent/native-intercept.ts`), and attribution is decided by `takeoverGate` (dsh's AsyncLocalStorage initiator).
- **Reported symptom (genuinely real)**: under the dsh web GUI (profile `web`), sessions on some `llm-pi-ai` transport layer **never have any model request reach the proxy at all** — bili.log shows zero `processTurn`, `/__bili/stats` has no such session, `acp_status` 404s with "no model request has arrived", and compression fails silently with no way to self-diagnose; other providers on the same host work normally.
- **Root-cause status (important revision)**: the root cause asserted by the original issue text and by this document's first draft — "pi-ai hands the injected private fetch to the OpenAI SDK, bypassing the global fetch interception" — **has been overturned by the owner's review of the evidence**: unpacking every layer (dsh-llm-pi-ai all generations / pi-ai 0.82.1–0.87.1 / openai SDK 6.26–6.40) shows that `options?.fetch` is `undefined` right from upstream, and the SDK falls back to the globalThis fetch (i.e. the already-patched instance) when it is constructed; statically, dsh's main chat loop in the source is wrapped in `withInitiator`, and the llm-related packages contain zero `withoutInitiator`. The openai-completions.js :573-579 lines cited in the issue only prove that the injection channel **exists**, not that it is ever populated. The real cause still has to be settled from runtime evidence; the candidates: (a) the reporting environment runs a combination of versions we have not seen before; (b) a host-runtime attribution gap (the gate rejects the traffic with a silent direct connection); (c) the A/B comparison did not happen in the same process/session. The owner is standing up a real dsh + bili + mock-upstream end-to-end reproduction right now.
- **Expected behavior**: (the issue's expectation #2, a one-step-back option) whatever the real cause turns out to be, a request that was not taken over must leave actionable traces: a one-time warning on the proxy side + tool errors carrying troubleshooting guidance + an observable gate rejection point on the host side.
- **Impact**: every user who installed via a profile (bare dsh) and hits this symptom; the feature fails silently.

## 2. Reproduction

- **Environment**: Windows 11, dsh web GUI (profile `web`), billion-context 0.1.138, `bili plugin install dsh`, with the provider being any one entry under `llm-pi-ai.providers.*` in settings.yaml.
- **Minimal reproduction steps**:
  1) `bili plugin install dsh`;
  2) in dsh, pick a provider managed by `llm-pi-ai` and send a few messages;
  3) bili.log has no `processTurn` for that session; `acp_status` reports "no model request has arrived with this conversation id yet".
  Control: in the same environment, switch to a third-party provider that goes through the ordinary global fetch (commandcode = third-party plugin `@mars-sea/dsh-commandcode-provider`, a separate implementation from the official llm-pi-ai) and `processTurn` shows up immediately.
- **Cannot be fully reproduced locally** (needs Windows + the dsh web GUI); what this PR delivers is detection and instrumentation, so that the owner's runtime reproduction can settle the question in a single pass (see §4.3).

## 3. Constraints & Non-Goals

- **Constraints**:
  - must not change the existing substrings `no model request has arrived` / `no model request has arrived with this conversation id yet` inside the `/__bili/plugin/tool` 404 error, which are matched by `src/mcp.ts` (ORPHAN_ADOPT) and `src/agent/opencode-v2.ts`;
  - must not touch `src/update.ts`, the release process, or the acp-kernel pin (the #7.4 auto-merge forbidden zone);
  - the content branch does not bump the version; the gate's boolean contract is unchanged (adding logs does not change the verdict).
- **Non-Goals**:
  - generically intercepting any injected fetch (not feasible: the function reference is private to the host's module graph, pnpm isolation blocks cross-module patching, and patching undici internals is too invasive). If the runtime evidence ultimately points at the transport layer's fetch shape, the real fix belongs in the dsh repo (lazy resolution of the global fetch / a middleware seam) and stays manual across repos;
  - do not log every rejected request (the per-request silence of #1117 stays): legitimate unattributed lanes (dsh's background drivers that are intentionally `withoutInitiator`, third-party in-process plugins) get at most one standing noise line per endpoint;
  - do not touch the same-shaped 404 text in `handlePluginCompact` (not on this symptom's path).

## 4. Chosen Approach

Detection that assumes nothing, a one-time actionable warning, gate rejection instrumentation, and documentation:

1. `handlePluginTool` emits a **once-per-session** `[plugin] NO MODEL REQUESTS seen for conversation …` warning for conversations that were "never registered" (!entry), listing the candidate causes (transport-layer fetch shape bypassing interception / host attribution gap so the traffic is never claimed by the gate / id expired after a host resume) + how to self-diagnose (send a message and watch for processTurn; the baseURL rewrite done by the bili launcher goes through the proxy under both hypotheses, without exception) + the same guidance appended to the 404 error body (keeping the existing substrings);
2. `takeoverGate` (dsh-native) records, **once per endpoint per process**, the rejected origin+pathname (query stripped to avoid leaking keys) + the attribution state at that moment (no initiator / initiator present but session id missing) through console.error — a rejection line exists while a chat turn should have been attributed → points at a runtime attribution gap; no rejection lines at all yet traffic still bypasses → points at the transport-layer fetch shape;
3. the dsh sections in the README (zh/en) change from "known limitation = llm-pi-ai injects fetch" to "reported, under investigation" (withdrawing the assertion), and give the two detection signals plus the launcher workaround;
4. regression tests: `tests/issue1158-no-model-request-warning.test.ts` (substrings preserved, once-only semantics, the entry branch's old behavior unchanged, the wording must not name a single confirmed cause) + a new gate-rejection-log test in `tests/dsh-native.test.ts` (once per endpoint, query never logged, one line per distinct endpoint, silent by default when attribution succeeds).
5. **Bootstrap failures persisted into bili.log (third revision the same day)**: the owner's Linux end-to-end reproduction (headless + chromium driving the web GUI) failed to reproduce the symptom — all llm-pi-ai traffic went through the proxy; the transport-shape hypothesis is out of the running on Linux, and the largest remaining suspect = a Windows-specific spawn/attach bootstrap failure that silently degrades — its only output is a one-time console.error, and the GUI process's stderr is invisible. So every degradation point in dsh-native (the bootstrap catch / the fallback when the attach target is unhealthy / the three respawn onGiveUp sites) is simultaneously appended, through `persistClientEvent`, as a `[dsh-client]`-tagged line into the shared bili.log (same file, same line shape as the proxy's tee log, best-effort, never throws back to the host); the console.error dual channel is kept.
6. **Gate tri-state + cumulative counters (L2 follow-up, landed after #1187)**: the reporter's runtime evidence nailed the root cause (dsh-http-proxy's settings-refresh re-arm overwrites `globalThis.fetch` with a frozen pre-bili capture, kicking bili out of the chain; the owner already self-healed L1 with a guarded accessor in #1187). Per the plan agreed within the thread, the gate instrumentation is upgraded: `attributionOf` becomes tri-state (ok / none / threw-with-message — the old bare catch swallowed a `currentInitiator()` exception into "no attribution", which makes a throwing ALS boundary indistinguishable from a legitimate agentless lane); the first rejection per endpoint prints one line (format unchanged) + a silent running counter for the same state + a reprint only on a state transition (`state none→threw`); every printed line is simultaneously appended to bili.log through persistClientEvent (`[dsh-client]` tag — the invisible GUI stderr is the direct cause of this "zero traces" round). The gate's boolean contract is unchanged, and #1117's per-request silence holds.
