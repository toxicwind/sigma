# WORKLOG — omp native plugin mode

## Forensics

- omp source (`/home/dog/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`):
  `ToolLoadMode = "essential" | "discoverable"` (pi-agent-core types.ts:717).
  `defaultLoadModeForToolName` (essential-tools.ts): a declared value wins; an undeclared tool is
  pinned to essential only for built-in names. The `tools.xdev` setting (on by default) mounts
  discoverable tools onto xd://.
- Measured with a probe (an isolated `PI_CODING_AGENT_DIR` plus a mock /v1/responses to capture
  traffic): `probe_default`, registered with defaults, does not appear in the main turn's tools;
  `probe_essential`, declared essential, does appear. Settled.
- server.ts:765 `consumePluginRegisterFor(clientConv ?? conversation)`, plus plugin.ts
  `registeredIds`. An identity register works in general, and omp's `x-session-id`/pck is the session
  uuid, which is naturally identical to the registration key.

## Implementation

- `src/agent/pi.ts`: `ToolDefinition` gains `+loadMode?: string`; `manifestToTool` sets
  `loadMode: "essential"`; `postIdentityRegister(fetch POST, AbortSignal.timeout(5000))`;
  `RegisterState` gains `+identityAt` (a per-sid cache that prevents a duplicate POST);
  `registerTools` registers on the success path when `agent === "omp"` (a failure backs off with
  `retryAt` at 10s); `pi.on("before_provider_request")` drives the retries.
- `tests/plugin-agent.test.ts`: `startFakeProxy` gains `+registers` capture and `+failRegister`
  options; 4 new tests (the essential declaration, an omp identity register happening once and
  re-registering for a new session, pi not registering, and a failed register backing off instead of
  hammering the endpoint). 24/24.

## e2e (isolated PI_CODING_AGENT_DIR + tmux mock)

- Trap 1: `pkill -f 19921` matched its own command line, which killed the shell and blocked it. The
  heredoc write was killed too, so the file on disk stayed stale. Fix: kill by PID, and rewrite with
  the write tool.
- Trap 2: the pi-ai Responses parser reads the event type from the `type` field of the data JSON, so
  writing only an `event:` line does nothing. The `type` has to be inside the data.
- Trap 3: omp argument validation. `compress` needs a content array where every entry carries
  `startId`, `endId`, and `summary` (the kernel's `validateEntry`).
- Proof of the final chain: the main turn's tools contained the 4 native ACP tools (a single copy,
  no wire duplication). The proxy log showed `injectTool=false (plugin mode: wire injection
  suppressed)` and binding on the very first request. The model called `compress` (native) → omp
  validation → `forwardTool` → `/__bili/plugin/tool` → the kernel adjudicated and returned a receipt
  (the observed return was "[Compression FAILED: ... does not exist in this session]", which proves
  the real kernel path was taken) → replay → the next turn printed NATIVE-E2E-DONE with exit 0.

## Docs

- The omp bullet in CONFIGURATION(.zh-CN).md was rewritten (essential plus the identity register).
  The stale "the omp fork hides extension tools" note was deleted from the Chinese file at :596.
- CHANGELOG Unreleased: the old omp -e entry was rewritten into its final form, in the same section
  as this change so the two do not contradict each other.

## Verification

- typecheck ✓, 632/632 ✓, build ✓. Branch `2026-08-26_omp-native-plugin-mode` (from
  origin/master 5982720, with #252 already merged).
