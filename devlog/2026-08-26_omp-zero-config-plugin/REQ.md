# REQ: zero-config native plugin for `bili omp`

User report (continuing the investigation of the omp incident where 92% went uncompressed):
"Doesn't this not need an install? `bili omp` starts with zero config all by itself, so it still
does not meet our expectation." The omp distribution does not ship the bili plugin, and the /acp
experience has always depended on the historical `bili plugin install omp`. That entry was removed
on 08-25 at 23:02, after which it silently degraded to pure wire mode.
Expectation: `bili omp` with zero config, meaning the native /acp command works out of the box.

## Delivered (branch 2026-08-25_omp-pck-identity, commit 7749429)

- The launcher omp branch mirrors pi (PR #227): when there is no loadable bili entry, prepend
  `-e dist/agent/omp.js`.
- `ompPluginLoadedFrom()`: an entry counts as installed only if its target file exists (a stale path
  does not suppress the injection).
- server.ts log fix: `injectTool` now prints the effective value rather than the raw flag.
- Design ruling: omp does not put extension tools into the model's tool surface (measured on
  17.3.8), so omp keeps wire tools plus `prompt_cache_key` identity. The gain from -e injection is
  the native /acp command.
