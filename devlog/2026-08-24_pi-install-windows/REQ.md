# pi plugin install works end to end + full-chain verification on Windows

## Requirement

User (2026-08-24):

> Now get everything pi needs installed working, by whatever means it takes. Then it needs
> testing on Windows — there is a remote Windows
> test environment. Make sure the bili command is supported and works.

Broken down:
1. `bili plugin install pi` works end to end, and every integration path for pi (persistent
   install registration, launcher, wire fallback) works.
2. Verify the `bili` command works on the remote Windows 10 test machine (win10-vm, see
   ~/system/win10-vm.md).

## Fix: install does not clean up old billion-context-pi entries

- Symptom: `isPiEntry` (src/plugin-install.ts) recognizes only three shapes — `npm:billion-context`,
  `^npm:billion-context@`, `node_modules/billion-context` — and fails to recognize:
  - `npm:billion-context-pi` (the standalone package from the 0.1.x era, which is exactly what
    win10-vm and many older environments have in their settings.json) → after installing, the old
    and the new plugin coexist and register tools of the same name twice.
  - dev checkout paths (a billion-context directory not ending in node_modules).
  - Windows backslash paths (the old regex only handled `/`).
- Fix (commit 2d86955): `isPiEntry` was expanded to four shapes (root equality /
  `npm:billion-context(-pi)?(@|$)` / `node_modules[/\]billion-context(-pi)?([/\]|$)` /
  `(^|[/\])billion-context(-pi)?$`), all of which are replaced with the currently installed root
  at install time, guaranteeing that only one live plugin remains.
  `piStatus` was tightened to a strict match against the current root (leftover old entries no
  longer report installed by mistake).
- Tests: the roundtrip case in tests/plugin-agent.test.ts was extended — seed 6 entries
  (including `npm:billion-context-pi`, `npm:billion-context-pi@0.1.48`, a dev path, a
  Windows backslash path, and an unrelated package), then assert that after install only
  `[unrelated package, root]` remains, and after remove only the unrelated package remains.

## Linux verification (this machine, qwen GLM vllm @127.0.0.1:18081)

- `bili plugin remove pi` + `install pi`: settings.json goes from
  `["npm:billion-context-pi","/home/dog/projects/billion-context"]` to a single root entry.
- `bili pi -- -p ...` (launcher; note that opts must come before the client name — everything
  after `--` is client args):
  - MITM domain discovery (open.bigmodel.cn, coding.dashscope) + 7 HTTP /bili/ rewrites ✓
  - plugin load (pi 0.83.5 via a packages-path entry) → proxyBase detection ✓ → manifest fetch ✓
  - a temporary debug line confirmed `ctx.model.baseUrl` = the rewritten /bili/ URL, so the
    detection chain is correct
  - round 1 wire injection (by design: the toolsReady race guard); the second request, after a
    real tool call, carries `x-bili-plugin: pi` + conversation id + context-window=1000000 →
    the plugin takes over natively ✓

## Windows verification (win10-vm, Node 22.23.2 / npm 10.9.8 / pi 0.84.1 / GLM)

| Step | Result |
|------|------|
| `npm install -g billion-context@latest` (0.1.39→0.1.50) | ✅ 13s |
| `bili --version` | ✅ 0.1.50 |
| `npm install -g bili-fix.tgz` (the npm pack artifact, includes the fix) | ✅ |
| `bili plugin install pi` | ✅ the old `npm:billion-context-pi` was replaced by `C:\Users\dog\AppData\Roaming\npm\node_modules\billion-context` (the only entry; settings.json.bili-bak is backed up automatically) |
| `bili plugin list` | ✅ pi: installed |
| `bili pi -- -p ...` (GLM cert-MITM open.bigmodel.cn) | ✅ full acp_status output + DONE |
| native plugin takeover | ✅ the upstream request headers include `x-bili-plugin: pi` + conversation + context-window=1000000 (on Windows the very first request already takes over, because the manifest completes registration before that first request) |
| `bili start --port 18901` | ✅ listen/persist/status log(`~/.local/state/billion-context/bili.log`)/auto-update/web UI/health all working |

Windows gotchas (reusing the conclusions already recorded in win10-vm.md):
- SSH session PATH caching: before every command, `set "PATH=C:\Program Files\nodejs\;%APPDATA%\npm;%PATH%"`.
- Nested quotes (cmd over ssh + powershell) are unreliable: scp the file back to read it, and
  write a .bat for multi-step operations.
- A background process started with `start /b` dies when the SSH session exits: do start + curl +
  netstat/taskkill inside a bat in the same session.
- The VM's pi has no bash tool (Windows), so use read/ls to test a real tool round trip.

## Other

- The local global bili was reinstalled from the registry as 0.1.50 (it used to be a symlink
  pointing at the repo); afterwards `npm install -g ~/projects/billion-context` (symlink back to
  the repo, dist is the current build).
- The system doc ~/system/win10-vm.md has been updated (commit c38c6f5).
- The VM's temp files (bili-fix.tgz, vm-start-test.bat, bili-start.log) have been cleaned up;
  the VM keeps the tgz version 0.1.50 (with the fix), and auto-update takes over once 0.1.51 is
  released.
