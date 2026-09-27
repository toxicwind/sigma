# Requirement: two consecutive injections/compressions under omp + a wrong 81% accounting basis

User report (an omp --resume session):
1. 02:56:35 INJECT 81% → compressed 33k. 02:57:41 INJECT 85% again → compressed another 3k.
   The same logical turn should only be compressed once.
2. The first 81% was itself wrong. The real window is 262144 (declared in omp models.yml, and SGLang
   measured accepting 234k), but the proxy used a denominator of 95232 (its built-in table,
   /^qwen/i → 128000 − max_output 32768) → the whole session was treated as 81% full at 29% real
   usage and compressed far too early.

The user ruled: "fix a and c, and try to avoid user configuration" (B, having the user declare the
window in the provider config on their side, was rejected).

## Fix A: compress credit

- The re-request after a compression intentionally resends the unfolded history (friendly to the
  prefix cache, 96% hit rate measured), and its usage report carries the pre-compression size → it
  overwrites lastInputTokens → the next request's nudge re-judges against a stale value → repeated
  injection.
- Fix: record the net change immediately after `applyRanges` succeeds. Every usage recorder (the
  loop's `recordUsage`, the plugin's `applyUsageSample`, and the non-streaming JSON path) applies the
  credit. The next request's `processTurn` (where the fold actually lands) zeroes it. A genuine
  over-limit still triggers as usual, and the cumulative billed `inputTokens` keeps its original
  value.

## Fix C: launcher window reporting

- While rewriting the client config, the launcher already reads the per-model `contextWindow`:
  pi's models.json, omp's models.yml, opencode's `models.<id>.limit`, and codex's
  `model` + `model_context_window`.
- Pass that to the spawned proxy via `BILI_LAUNCHER_MODEL_WINDOWS` (JSON). The proxy inserts it into
  the native chain (plugin report > launcher > registry > routes/table).
- Zero user configuration. Only the launcher sets this env var (so the headless-spoofing risk surface
  does not exist).
