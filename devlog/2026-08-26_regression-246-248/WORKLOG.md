# WORKLOG — regression PR#246+PR#248

1. `git checkout -b 2026-08-26_regression-246-248` (from master 48f65c9)
2. merge origin/2026-08-25_dsh-launcher (no conflicts, 71bcd9d)
3. merge origin/2026-08-25_omp-pck-identity: 1 conflict each in CONFIGURATION.md/.zh-CN.md → a
   python script took the omp side as the base and restored the dsh wording (0da4274)
4. Pre-check: typecheck ✅ / 616/616 ✅ (e2e-responses-chat-relay:251 had a flaky timing assertion
   once, 7/7 on the re-run) / build 2.47MB ✅
5. dsh e2e: mock-sse 19811 → `node dist --port 198{13,16} dsh --profile headless`, 4/4 wire tools
   injected, patch file generated, REG-OK, exit 0
   - Gotcha 1: mock killed → HTTP 502 (upstream dead, expected behavior)
   - Gotcha 2: no DEEPSEEK_API_KEY → dsh MISSING_CREDENTIAL, a dummy value is required
6. omp e2e: mock-resp.py (Responses SSE) 19814; isolated PI_CODING_AGENT_DIR=/tmp/omp-reg/agent
   + SIGMA_SESSIONS_DIR
   - Gotcha 3: omp goes through /v1/responses; a chat mock triggers 10 omp retries of
     STREAM_CLOSED — a Responses-format mock is mandatory
   - Gotcha 4: no config.yml in the isolated directory → the default model resolves to a dead
     ollama on 11435; the real config.yml (with modelRoles) must be copied over
   - Gotcha 5: the launcher's omp overlay = `$PI_CODING_AGENT_DIR-sigma`; a custom home is
     inherited rather than ignored
   - Gotcha 6: `rm`-ing the log file of an already-started mock → the fd points at an unlinked
     inode, so there is no log to see (the mock itself is fine)
   - Gotcha 7: inside the SIGMA_CLIENT_BIN wrapper script, omp's real path =
     /home/dog/.bun/bin/omp (not ~/.local/bin)
7. Verification points:
   - -e injection: argv log 4/4
   - wire tools: the RAW dump tools array contains compress/decompress/search_context/acp_status
   - pck: RAW dump prompt_cache_key = omp session id = x-session-id
   - cross-process continuity: the second round `-c` + a new proxy process reuses the same
     session [d8a7b23542856a71]
   - zero on-disk writes: the real ~/.omp/agent/config.yml md5 unchanged (df68a91a…); no sigma
     changes in the isolated config.yml; no extensions entry in the real home
8. Cleanup: kill mock-sse/mock-resp; delete the local temp directories but keep /tmp/omp-reg (for
   post-mortem)
9. Double review: acp_delegate × 2 (reviewer), one per PR, diff range master...each branch
