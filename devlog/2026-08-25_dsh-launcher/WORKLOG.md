# WORKLOG — 2026-08-25 dsh launcher

## Live probes run before implementation (a /tmp scratch environment, since cleaned up)

1. A mock SSE upstream plus an isolated `DSH_HOME` plus `DEEPSEEK_BASE_URL` produced a complete
   dsh headless turn: PROBE-OK. That proves the env redirection works.
2. Guessing the settings.yaml section name. A top-level `providers:` does nothing.
   `llm-pi-ai.providers.deepseek` does not take effect, because the default route is not pi-ai.
   `--dump-config` revealed that agent-default-model is pinned to `deepseek-official`. Garbage
   settings crash hard, which proves settings are read from DSH_HOME.
3. The `dsh-llm-deepseek` source: `config.baseURL ?? env.DEEPSEEK_BASE_URL ?? PUBLIC_BASE_URL`.
4. The whole chain: dsh → sigma (with the /sigma/ prefix) → mock, with the compression tools injected
   (tools=[...,compress,decompress,search_context,acp_status]) and two sessions tracked
   independently.

## Code changes

- src/client-config.ts: `DshConfig`, `resolveDshHome`, `parseDshSettingsYaml`, `readDshConfig`, with
  loadClientConfig attaching `config.dsh`.
- src/launcher.ts: dsh added to LAUNCH_CLIENTS/BaseClientName, a dsh branch in discoverRoutes
  (baseUrls → httpRewrites), `prepareDshHome` (an overlay rewrite, the sibling of the hermes one),
  a dsh branch in runLaunch (SIGMA_PROXY + DEEPSEEK_BASE_URL + the DSH_HOME overlay +
  a three-state warning), dsh excluded from launcherInjectMcp, and a re-export of the three new
  symbols.
- src/loop/adapter-openai.ts: `?? 0` fallbacks on the numeric fields of the emitCompletion usage
  object, fixing dsh's non-JSON-serializable data.
- src/cli.ts: dsh added in three places in the help text.
- tests/launcher.test.ts +6 tests (parse/read/resolve, discoverRoutes, the prepare rewrite, CRLF and
  unreadable inputs, and a spawn-level env assertion for runLaunch).
- tests/loop-adapters.test.ts +1 regression test (usage field completeness).
- README(.zh-CN).md and CONFIGURATION(.zh-CN).md: the launcher command, the redirect/CA table, the
  discovery table, isolated config, and a wire-only note.

## Verification

- typecheck ✅, npm test 604/604 ✅ (three runs), build ✅.
- Real e2e: `node dist/index.js dsh --profile headless "..."` with an isolated DSH_HOME and a
  settings.yaml carrying llm-deepseek.baseURL pointed at the mock. The overlay was generated,
  DEEPSEEK_BASE_URL was set, two requests went through the proxy, the SSE stream returned
  `DSH-E2E-OK`, and the exit code was 0. A before/after comparison confirmed the usage fix (before
  it, dsh reported "session event assistant/chunk carries non-JSON-serializable data").

## Lessons

- Any test of the dist service must pass --no-auto-update. The repo package.json got updated in
  place to 0.1.54 again, and `git checkout` restored it.
- When a mock port is already held by an old process, the new mock dies silently with EADDRINUSE
  while the old mock keeps answering, which makes the symptoms baffling. Run `ps` first, then kill.

## Follow-up 6: native `/acp` command via `--patch` injection (issue: wire-mode /acp not native)

User feedback: typing `/acp` in the dsh web UI sent it to the model as a plain
prompt (model then called the wire-injected `acp_status` tool and pasted raw
JSON). Requested parity with pi/omp/codex/claude — a real native command.

**dsh plugin mechanics discovered** (dsh 0.1.1-rc.2):
- cordis plugins: `{name, inject:["commands"], apply(ctx)}`;
  `ctx.commands.register({name, description, handler})`; handler returns
  `{kind:"success"|"error", text}` — verified against `dsh-command-compact`.
- `--patch <path>` CLI flag: repeatable overlay applied after the profile's
  user layer; entries `[{insert: [{name: <specifier>}]}]` append to the root
  loader tree. Entry names resolve through Node's module loader — a `file://`
  absolute URL works (cordis-plugin-loader `EntryTree.import`).
- Subcommand rules: `dsh web` accepts its own `--patch` (parent flags
  rejected before it); `dsh plugin` (pnpm forwarding) and
  `--dump-default-config` take no `--patch` at all.
- `dsh-headless` is a one-shot direct Agent driver — it never parses slash
  commands (native `/compact` is equally unavailable there); `/acp` targets
  the web/tui interactive surfaces.

**Implementation**:
- `src/agent/dsh-acp.ts` (tsup entry → `dist/agent/dsh-acp.js`): registers
  `/acp`; outcome chain = proxyBaseFromEnv → fetchStatusLatest (panel text)
  → fetchProxyVersion (armed-but-idle info, PR#235 wording) → unreachable
  error. No-env case hints `sigma dsh`.
- `src/agent/shared.ts`: +`fetchStatusLatest` — status endpoint rejects an
  EMPTY conversationId, so the URL carries `conversationId=dsh&fallback=latest`.
- `src/launcher.ts`: +`writeDshAcpPatch` (writes `~/.dsh-sigma/.sigma-acp.patch.yml`
  with `- insert:\n    - name: file://…/dsh-acp.js\n`; independent of the
  settings rewrite so it exists with zero custom providers) and
  `dshArgsWithPatch` (three-shape splice: prepend / after-`web` / skip).
  runLaunch dsh branch wires both.

**Tests**: launcher 85 (argv splice assertions in the existing runLaunch dsh
e2e + writeDshAcpPatch content + dshArgsWithPatch four shapes);
tests/dsh-acp.test.ts 4 (panel / armed / unreachable / no-env). 610/610.
Gotcha: the handler test's fetch mock must be restored AFTER `await
handler()` — restoring synchronously raced ahead of the first actual fetch
call and a live proxy on 127.0.0.1:8787 answered instead.

**e2e (real vllm)**: `--dump-config` shows our insert row; headless one-shot
through `sigma dsh` returns ACP-E2E-OK with no loader errors (plugin loads and
registers); `dsh web` boots clean; `status?conversationId=dsh&fallback=latest`
on a live proxy returns the rendered panel.

**Docs**: README(.zh-CN).md dsh line + CONFIGURATION(.zh-CN).md launcher
"native tools" section, install-matrix wording (dsh no longer "wire-only").
