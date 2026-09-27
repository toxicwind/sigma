# WORKLOG — pi plugin install wired end to end + full-chain Windows verification

## Requirement

User (2026-08-24):

> Now get everything pi needs install working, by whatever means it takes. Then it needs
> testing on Windows — there is a remote Windows
> test environment. Make sure the bili command is supported and works.

Broken down:
1. `bili plugin install pi` works end to end, and every integration path for pi (persistent
   install registration, launcher, wire fallback) works.
2. Verify the `bili` command works on the remote Windows 10 test machine (win10-vm, see
   ~/system/win10-vm.md).

## Fix: install did not clean up old billion-context-pi entries

- Symptom: `isPiEntry` (src/plugin-install.ts) recognized only three shapes — `npm:billion-context`,
  `^npm:billion-context@`, `node_modules/billion-context` — and failed to recognize:
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

## Follow-up 2: `bili pi` native experience works out of the box (-e injection, no install needed)

The user confirmed the goal: the other clients (`bili omp` / `bili opencode`) all work natively out
of the box, and pi was the one gap that needed a manual install. Closing it:

- `src/launcher.ts` pi branch: when pi is not installed, prepend `pi -e <selfDistFile("agent/pi.js")>`
  to clientArgs (pi's official switch — it loads the extension for this run only and does not write
  settings.json). When pi IS installed, do not add it. The two are mutually exclusive: pi derives
  extension identity from the resolved path, and the install entry (package root) and -e (file) are
  different paths, so loading both would register the same tool and command twice. Pick exactly one.
  Added a `piPluginInstalled()` helper that reuses the same `isPiEntry` decision as install.
- `src/plugin-install.ts`: `isPiEntry` is now exported.
- `tests/launcher.test.ts` gained "runLaunch pi: native -e plugin injected only when not
  installed" (not installed → first two args are `[-e, dist/agent/pi.js]`; installed → no `-e`).
  A trap worth recording: `makeFakeChild` does not fire an exit event, so runClient's promise never
  resolves and the test hangs. Wrap it — register the exit listener, then trigger asynchronously with
  setTimeout. The proxy child process is left as it was.
- Full suite 516/516 ✅, typecheck ✅, build ✅ (dist/index.js 2.45MB).
- Real e2e (this machine, in the not-installed state): after `bili plugin remove pi`, running
  `bili pi -- -p "read ..."` → the very first real tool request already carried
  `"x-bili-plugin":"pi"` + conversation + context-window=1000000 (verified in
  /tmp/bili-proxy-34117.log). Reinstalling afterwards restored the installed state.

## Follow-up 3: Windows VM verification of the -e injection (all green)

- `npm pack` the current branch → scp bili-fix2.tgz → `npm install -g` (the VM is now at 0.1.50 with
  both fixes).
- `bili plugin remove pi` (not-installed state) → `bili pi -- -p "read C:\\Users\\dog\\note-e2e.txt ..."`
  → EXITCODE=0, the content was reproduced verbatim, and the upstream request headers carried
  `"x-bili-plugin":"pi"` + context-window=1000000 (verified in `Temp\\bili-proxy-8787.log`) →
  -e injection takes over natively on Windows ✓.
- Afterwards `bili plugin install pi` restored the installed state (the install path was verified
  on Windows a second time ✓). Temp files cleaned up.
- A trap: a .bat file must use CRLF. With LF line endings cmd mis-splits %VAR% and reports
  `'PDATAPATH"' is not recognized as an internal or external command`.

## Windows verification (win10-vm, Node 22.23.2 / npm 10.9.8 / pi 0.84.1 / GLM)

| Step | Result |
|------|--------|
| `npm install -g billion-context@latest` (0.1.39→0.1.50) | ✅ 13s |
| `bili --version` | ✅ 0.1.50 |
| `npm install -g bili-fix.tgz` (the npm pack artifact, includes the fix) | ✅ |
| `bili plugin install pi` | ✅ the old `npm:billion-context-pi` was replaced by `C:\Users\dog\AppData\Roaming\npm\node_modules\billion-context` (the only entry; settings.json.bili-bak is backed up automatically) |
| `bili plugin list` | ✅ pi: installed |
| `bili pi -- -p ...` (GLM cert-MITM open.bigmodel.cn) | ✅ full acp_status output + DONE |
| native plugin takeover | ✅ the upstream request headers include `x-bili-plugin: pi` + conversation + context-window=1000000 (on Windows the very first request already takes over, because the manifest completes registration before that first request) |
| `bili start --port 18901` | ✅ listen/persist/status log(`~/.local/state/billion-context/bili.log`)/auto-update/web UI/health all working |

Windows traps (reusing the conclusions already recorded in win10-vm.md):
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
