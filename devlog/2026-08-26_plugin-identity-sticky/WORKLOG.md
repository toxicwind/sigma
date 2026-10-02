# WORKLOG

## Investigation path
1. Proxy log 42947: pluginAgent null, and the 22:41 responses request had injectTool=true (wire).
2. An instrumentation plugin (`probe-plugin.js`, injecting `__log` into /tmp/ompreg/plugin.log) gathered
   evidence from inside the omp process. The whole chain works: session_start → manifest GET → identity
   register POST (verified for single-shot, TUI, and -r).
3. `plugin-conversations.json`: the conversation 01a03e4e → responses session 9b62 had a mapping, but
   `pluginAgent` was always null → the register was never consumed by a responses request.
4. Decisive reproduction: launcher TUI + a chat mock (19989) + a responses mock (19981). After the
   chat request consumed the register, switching to a responses model gave injectTool=true. The bug
   is confirmed.

## Fix
- `src/plugin.ts` `consumePluginRegisterFor`: on a hit it does delete+set (an LRU refresh) and no
  longer deletes.
- `tests/launcher-plugin-mode.test.ts` +1 test (two upstreams, one conversation, still plugin mode
  after the switch).
- Red/green verification: the new test FAILS on the old code ("upstream B") and PASSES 8/8 on the new
  code.

## Verification
- launcher-plugin-mode 8/8, full suite 647/647, typecheck, build.

## Incident and recovery
- One launcher test was missing PI_CODING_AGENT_DIR, so it rewrote the user overlay
  agent-sigma/models.yml to the dead port 19998 → restored with sed to the user's live proxy 42947
  (6 places), backup at /tmp/ompreg/models.yml.clobbered.bak.
- The first chatmock used `req.on("close")`, which fires too early on Node 25 and cleared the interval
  → SSE returned zero bytes. Removing the close handler fixed it.
