# REQ — restore omp native plugin mode

The user's chain of observations:
1. In an omp wire-mode session, the model fabricated "📦 [ACP] Compressed" receipts and fake
   `<acp>` tags, and the final turn "stopped halfway through its output" (emitting only whitespace
   and a fake tag).
2. The user diagnosed the root cause as: "omp has no real tools, wire mode injects the compressed
   content to the model" → the model learned the compression artifacts as a behavior.
3. The user's decision (m07040): "none of this is the fundamental approach — what we need to see is
   how to restore bili in omp's native mode" — restore native mode so compression goes through the
   real client tool.

## Root cause (why omp previously could only do wire mode)
- omp 17.x mounts an extension tool that does not declare `loadMode` onto an xd:// device URL (invisible
  in the main turn's tools array, visible only to the title request) → even with the plugin installed, the
  model cannot reach `compress`.
- The omp fork does not emit `before_provider_headers` → there is no way to stamp `x-bili-plugin`, so the
  proxy cannot enter pluginMode.
- The earlier conclusion (from the PR #248 era) that "omp never sees extension tools in the main turn"
  came from this. At the time it was assumed unfixable, so the compromise of wire plus /acp was chosen.

## Fix
- `manifestToTool` registers with `loadMode: "essential"` (the declared value takes priority over the
  default discoverable, so the tool is visible in the main turn; pi ignores the field).
- omp has no headers event → once the tools are ready, POST `/__bili/plugin/register` with
  `{conversationId: <session uuid>, agent: "omp", identity: true}` (reusing the #162 claude/codex
  channel). The proxy binds subsequent requests into pluginMode using that identity.
- The `before_provider_request` event drives retries (omp fires it on every request).
