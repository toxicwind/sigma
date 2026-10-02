# Regression test of PR#246 + PR#248 (local merge verification)

## User request

> Let's write a regression test for both of these, preferably after merging locally, to see
> whether they interfere with each other, then submit them to the agents for a double review

Each PR is green in its own CI, but both touched adjacent areas of the launcher/plugin/docs, so
after merging we need to verify that they do not interfere with each other.

## Regression content

- Branch `2026-08-26_regression-246-248` (local, from master 48f65c9)
- merge PR#246 (dsh) and then PR#248 (omp)
- The only conflicts are one each in CONFIGURATION.md / CONFIGURATION.zh-CN.md (both PRs edited
  the "install necessity" paragraph); the resolution: take the omp side's pi/omp `-e` wording as
  the base and restore the dsh `--patch` entry plus the note about omp's tool-surface limitation
- Pre-check: typecheck ✅, 616/616 tests ✅ (the first run had a flaky timing assertion in
  e2e-responses-chat-relay, which passed on a re-run), build ✅

## e2e results (dist, mock upstream)

### dsh (the PR#246 side)

- mock: /tmp/mock-sse.py (chat SSE) 19811/19812
- `DSH_HOME` isolation + settings llm-deepseek.baseURL → mock + `DEEPSEEK_API_KEY=dummy`
- `sigma dsh --profile headless`: the request goes through the proxy, the tools the upstream
  received include the 4 wire ACP tools (compress/decompress/search_context/acp_status),
  `~/.dsh-sigma/.sigma-acp.patch.yml` is generated correctly, exit 0
- Gotchas: once the mock process is killed dsh gets a 502 (expected); without DEEPSEEK_API_KEY
  dsh refuses to send (a dummy value is required)

### omp (the PR#248 side)

- mock: /tmp/mock-resp.py (Responses SSE, 19814) — omp goes through /v1/responses, so a
  chat-format mock does not apply
- isolated `PI_CODING_AGENT_DIR=/tmp/omp-reg/agent` (note: the launcher's omp overlay =
  `$PI_CODING_AGENT_DIR-sigma`; a custom env is inherited)
- First round `-p`: argv contains `-e dist/agent/omp.js` (injected in all 4 runs); RAW dump:
  `prompt_cache_key=01a03bd7-…` (= the omp session id), tools include the 4 wire ACP tools
- Second round `-c` continuing the conversation + **a brand-new proxy process (19821)**: it
  reuses the same proxy session `[d8a7b23542856a71]` — pck identity + cross-process continuity
  verified
- The real `~/.omp/agent/config.yml` md5 is identical before and after (df68a91a…), zero
  extensions written; the isolated config.yml was not modified by sigma either

### Cross-effects

- launcher.ts was changed by both PRs: the merge had no conflicts (different branch regions:
  dsh's prepareDshHome/writeDshAcpPatch vs omp's -e injection)
- plugin-install.ts was only touched by #248 (ompPluginLoadedFrom); #246 did not touch it
- The only overlap = the CONFIGURATION doc paragraph, in two copies, merged by hand

## Conclusion

No regression after the merge; the two PRs complement each other with no conflict. Either merge
order is fine (GitHub reports no conflicts); cut v0.1.55 after the merge.
