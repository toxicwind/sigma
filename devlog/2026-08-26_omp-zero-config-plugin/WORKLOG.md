# WORKLOG

1. Confirmed the omp 17.3.8 distribution package has no sigma traces. The `sigma omp`
   branch originally had no -e injection (pi had one).
2. Implemented `ompPluginLoadedFrom` + the launcher -e injection + a 3-state test (a `runLaunch omp`
   matrix and a four-state unit test).
3. e2e hunted the culprit: the argv injection succeeded but the `x-sigma-plugin` header count was 0
   → the probe showed omp only sends `session_start` and has no `before_provider_headers` event.
4. Tried an identity register (POST `/__bili/plugin/register` with `identity: true`). The server-side
   binding was verified end to end (reproduced with curl, and omp's real consume matched), but it
   turned out that an omp main-turn request never includes the extension-registered tools (they are
   visible only to the internal title request) → binding pluginMode actually strips the model of the
   ACP tools. That approach was rejected and `postIdentityRegister` was reverted.
5. Along the way, a log bug surfaced at server.ts:1187. It printed
   `injectTool=${shouldInject}` (the raw flag) instead of `injectTools` (the effective value) →
   fixed to print the effective value plus a plugin-mode marker.
6. Final verification: two headless task rounds with 4/4 wire tools injected + FINAL-E2E-OK, and
   the tmux interactive /acp panel rendering (sigma@0.1.54, Context 0%/200k).
   603/603 + typecheck + build.

Lessons:
- When debugging whether injection happened, do not trust the `injectTool=` log line (before the fix
  it printed the raw value). Read the contents of the `fwdTools` list instead.
- In omp (17.x), extension tools reach only the title request, not the main-turn tool surface. Any
  omp approach that depends on "native tools" is therefore unworkable. omp's correct position is
  wire tools plus the /acp command plus pck identity.
- The real `~/.omp/agent` config.yml has no trailing newline on its last line, so appending
  `extensions` by hand corrupts the YAML (omp moves a broken file aside). The `ompInstall` code
  already handles this trap.
