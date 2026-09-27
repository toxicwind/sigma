# Requirement

After the user merged PR #231 (the README aligned to the Chinese version), they pointed out that
the README had dropped a lot of detailed usage. They asked for those details to move into
CONFIGURATION.md / CONFIGURATION.zh-CN.md (in both English and Chinese, in step) and for the gaps
where `--help` covered something the docs did not to be filled.

- Source material: the deleted lines from `git diff 7d958b1..master -- README*.md` (plugin mode,
  manual MITM setup, per-client baseURL examples, the launcher table, Codex subagents,
  sessions/export, and so on).
- Fact check: the launcher table was rewritten against the current src/launcher.ts (claude uses
  ANTHROPIC_BASE_URL rather than cert-MITM; pi auto-injects -e when no plugin is installed; hermes
  has no MITM; omp/opencode use isolated config). The parts of the old README table that had gone
  stale were not copied over.
- The environment variable table gained 17 rows (ACP_SESSION_HEADER / ACP_REASONING_KEEP /
  ACP_LOG_FILE / ACP_DUMP_SSE / BILI_UPSTREAM_PROXY / BILI_PERSIST* / BILI_MAX_SESSIONS /
  BILI_SESSIONS_DIR / BILLION_CONTEXT_PROXY / BILLION_CONTEXT_PLUGIN / BILI_LAUNCHER_PLUGIN /
  BILI_LAUNCHER_DIRECT / BILI_CLAUDE_UPSTREAM, plus BILI_REPLAY_* on the Chinese side).
