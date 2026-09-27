# WORKLOG

- Branch 2026-08-25_configuration-usage-docs, from master e551506.
- `git diff 7d958b1..master` exported the deleted README lines to /tmp/en-deleted.txt and
  /tmp/zh-deleted.txt as source material.
- Checked src/launcher.ts (the claude ANTHROPIC_BASE_URL route at :236-246, the per-client env at
  :920-975, BILI_LAUNCHER_PLUGIN at :358, the direct warnings at :907/:911) and rewrote the table
  rather than copying the stale content.
- CONFIGURATION.md: the env var table grew by 16 rows. Five sections were appended (CLI Reference /
  Client Integration / Launcher Reference / Plugin Mode / Sessions & Migration), taking it from 346
  to 620 lines.
- CONFIGURATION.zh-CN.md: the env var table grew by 18 rows (including the missing BILI_REPLAY_*).
  The same five sections were appended, taking it from 344 to 620 lines, matching the English
  section for section.
- Documentation-only change, no code and no version number involved.
