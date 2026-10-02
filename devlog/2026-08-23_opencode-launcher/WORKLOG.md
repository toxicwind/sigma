# WORKLOG — opencode launcher + /acp thin plugin

## Date
2026-08-23

## What was done (this commit)

### 1. Thin opencode plugin — `src/agent/opencode.ts` (new)
- Activates only when `SIGMA_PROXY` is set (launcher sets it);
  prints `[sigma-opencode] plugin active (proxy <origin>)`.
- `config` hook registers the `acp` command (`{ template: "", description }`).
- `command.execute.before` intercepts `/acp`: GETs
  `/__bili/plugin/status?conversationId=<sid>&fallback=latest`, then renders
  the returned panel via `client.session.prompt` with
  `{ noReply: true, parts: [{ type: "text", text, ignored: true }] }`
  (same rendering path opencode-acp uses — writes into the session without
  triggering a model reply), then throws `__SIGMA_ACP_HANDLED__` to stop
  opencode from sending the empty template to the model.
- Early iteration also POSTed `/__bili/plugin/register` on `session.created`;
  this was REMOVED: registering made the proxy set `pluginAgent` and suppress
  wire tool injection, but this plugin does not natively register the 4 tools
  (opencode's `tool` hook needs zod schemas) → the model lost the ACP tools.
  Wire injection + `fallback=latest` status is the correct split.

### 2. Launcher injection — `src/launcher.ts`
- `prepareOpencodeHttpRewrite(..., pluginPath?)`: appends the absolute plugin
  path to the temp config's `plugin` array (deduped). Temp config is now
  emitted whenever a pluginPath is given — even if the real opencode.json is
  missing/unreadable or has no rewriteable providers — so `/acp` always rides
  along `sigma opencode`.
- `runLaunch` opencode branch: resolves `dist/agent/opencode.js` next to the
  running CLI (`fs.existsSync` guarded) and passes it in.

### 3. Status fallback — `src/plugin.ts` + `src/server.ts`
- `handlePluginStatus(conversationId, res, fallbackLatest = false)`: when the
  conversation is unknown and `fallbackLatest`, pick the session with the
  newest `lastSeen` via `listSessions()`; response gains `fallback: true`.
- `/__bili/plugin/status` route parses `fallback=latest`.

### 4. Build + tests
- `tsup.config.ts`: entry += `src/agent/opencode.ts` (dist 1.8KB).
- `tests/launcher.test.ts`: plugin-injection assertions (appended, not
  duplicated; provider baseURL untouched when no rewrites; temp config emitted
  from a missing source file).
- `tests/plugin-protocol.test.ts`: `fallback=latest` resolves unknown
  conversation → ok/fallback=true; plain unknown still 404.

## Verification
- `npm run typecheck` clean; `npm test` 530 pass / 0 fail; build OK.
- e2e `node dist/index.js opencode run "reply with exactly: pong"`:
  - proxy starts (MITM: open.bigmodel.cn; 1 HTTP /sigma/ rewrite)
  - `[opencode-acp] disabled: SIGMA_PROXY detected`
  - `[sigma-opencode] plugin active`
  - model replies pong; proxy log round 2 shows
    `tools=[bash,read,...,compress,decompress,search_context,acp_status]`
    (4 ACP tools appended after opencode's native set)
- Fallback endpoint test (proxy + one OpenAI request + unknown conv):
  `?fallback=latest` → 200 `{ok:true, fallback:true}` with the
  buildStatusPanel rendered (`sigma@0.1.46` header); without the
  param → 404. PASS.
- Real `~/.config/opencode/opencode.json` byte-identical; temp dirs cleaned.

## Follow-up fix — symlink-safe dist path resolution
Symptom: user's `sigma opencode` TUI (22:44) loaded the temp config and
opencode-acp/awork/omo but NOT `dist/agent/opencode.js`, while `node
dist/index.js opencode` (same dist) injected it fine.
Root cause: the launcher resolved the plugin as
`path.resolve(path.dirname(process.argv[1]), "agent/opencode.js")` — via the
global bin symlink `~/.local/.../bin/sigma` that dirname is the bin dir, so
`existsSync` failed and the plugin was silently skipped. Same latent bug in
`buildMcpConfig` / `buildCodexMcpArgs` (dist/mcp.js).
Fix: added `selfDistFile(name)` = `path.join(selfPackageRoot(), "dist", name)`
(selfPackageRoot is import.meta.url-based, so Node's realpath resolution
makes it symlink-safe); used it at all three sites.
Verified: `sigma opencode run "reply with exactly: pong"` through the global
symlink now prints `[sigma-opencode] plugin active` and the session log shows
`dist/agent/opencode.js loading plugin`. 530 tests pass, typecheck/build OK.

## Rollback
Revert this commit. No data-format or protocol changes; the fallback param is
additive and ignored by older callers.

## Notes / pitfalls
- Registering the plugin conversation (`/__bili/plugin/register`) suppresses
  wire tool injection — only register when the plugin ALSO natively registers
  the 4 tools (pi/omp do; opencode cannot without zod).
- opencode loads `plugin: ["opencode-acp@latest"]` from
  `~/.cache/opencode/packages/...` (NOT ~/.config/opencode/node_modules) —
  local self-disable patches must hit the cached copy.
- The ignored-message render path (`noReply` + `parts[].ignored`) is the
  opencode-sanctioned way to print UI text from a plugin.

## Follow-up 3: /acp did nothing, the `this` binding was lost (2026-08-23 23:06)

**Symptom**: under `sigma opencode`, choosing /acp and sending produced no reaction at all, with no
error and no output.

**Investigation** (tmux plus console.error markers in dist):
- The first Enter only selects the slash command and pops open the menu. The second Enter is what
  actually submits. That is normal TUI behavior, not a bug.
- After submitting, the hook fired correctly, the status HTTP call returned 200, and the 422-byte
  panel arrived. But `prompt() THREW: undefined is not an object (evaluating 'this._client')`, and
  the old `catch {}` swallowed the error, so the failure was completely silent.

**Root cause**: `showText` destructured the SDK method out of its object and then called it:
```ts
const prompt = ctx.client?.session?.prompt;
await prompt({...});        // this === undefined → this._client throws
```
Upstream opencode-acp calls `client.session.prompt(...)` as a method, so `this` is the session.

**Fix** (src/agent/opencode.ts): guard first with `const session = ctx.client?.session; if
(!session || typeof session.prompt !== "function") ...`, then call `await session.prompt({...})` as
a method. The catch now uses console.error to print the real error instead of swallowing it.

**Verification**: two Enters on /acp inside tmux rendered the panel successfully
(sigma@0.1.46 / Context 0% (0/200k) / Blocks none / Tag visibility), and stderr showed no
THREW. Typecheck, 530 tests, and build all green.

## Follow-up 4: codex/claude launcher verification + claude /sigma/ switch (2026-08-23 23:30)

**Context**: verify `sigma codex` / `sigma claude` end-to-end. No real API keys on the
box, so plumbing was proven with a fake local upstream (401 from it = full path OK)
plus real-upstream runs (401/403 from comfly/anthropic = upstream reachable).

**Fix 1 — cli.ts `--` passthrough**: `sigma codex -- exec ...` forwarded the literal
`--` to the client; clap treats everything after it as positionals →
`error: unexpected argument`. Now cli.ts consumes a leading `--` after the client
name (documented form `sigma <client> [opts --] [args]`). sigma's own options must
still precede the client name (`sigma --port N codex -- ...`).

**Fix 2 — claude drops cert-MITM, rides /sigma/ for everything**: claude 2.1.227
(undici fetch) ignores HTTPS_PROXY, so the MITM path could never intercept it
(region-block 403 arrived with zero proxy forward logs). discoverRoutes now routes
every claude upstream — raw HTTP, raw HTTPS, or pre-wrapped at an old proxy
origin — into httpRewrites; buildClaudeEnv wraps it via ANTHROPIC_BASE_URL (claude
honors that env natively). MITM whitelist stays empty for claude.

**Fix 3 — readClaudeSettings honors shell env**: settings.json-only reading
ignored a user-exported ANTHROPIC_BASE_URL (their real relay); the launcher would
then wrap api.anthropic.com and override the relay entirely. Now env is a fallback
(settings.json still wins). Loop-local variable renamed settingsEnv to avoid
shadowing.

**Verification** (fake upstream 127.0.0.1:9955 + real runs):
- codex `/sigma/`: `OPENAI_API_KEY=dummy sigma codex -- exec --skip-git-repo-check
  -c model_providers.sigma-comfly.base_url=http://127.0.0.1:8901/sigma/http://127.0.0.1:9955/v1 ...`
  → upstream saw `POST /v1/responses ua=codex_exec/0.147.0` with
  `tools=[compress,decompress,search_context,acp_status]` injected. codex exec
  needs `--skip-git-repo-check` + `</dev/null` (else blocks reading stdin).
- codex MITM (comfly, real): session file `ai.comfly.org_*.json` created through
  the CONNECT tunnel; real upstream 401 surfaced in codex output.
- claude `/sigma/` (raw env relay): 16 upstream hits
  `POST /v1/messages?beta=true ua=claude-cli/2.1.227`, ACP tools appended to the
  full 30-tool Claude set (plus alternating 4-tool probe rounds — expected).
- claude default (no base_url): proxy log `forward POST →
  https://api.anthropic.com/v1/messages?beta=true` + real 403 round-trip.

**Tests**: updated discoverDomains/discoverRoutes claude expectations (no MITM
domains; ANTHROPIC_BASE_URL rewrite), added wrapped-URL unwrap→rewrap test.
531 pass / 0 fail; typecheck + build clean.
