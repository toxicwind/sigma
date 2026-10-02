import { homedir } from "node:os";
import path from "node:path";

/** XDG base-directory paths for sigma.
 *
 *  Follows the XDG Base Directory Specification so the proxy lands in the
 *  conventional Linux/macOS locations instead of a bespoke ~/.sigma/:
 *
 *    config (user-edited, dotfile-managed):
 *      $XDG_CONFIG_HOME/sigma/sigma.json
 *      default: ~/.config/sigma/sigma.json
 *
 *    data (persisted session state, grows over time):
 *      $XDG_DATA_HOME/sigma/sessions/
 *      default: ~/.local/share/sigma/sessions/
 *
 *  Env overrides (highest priority) are kept so test runners and container
 *  setups can relocate everything without touching the config file. */

function xdg(envVar: string, fallback: string): string {
    const v = process.env[envVar];
    if (v && v.length > 0) return path.resolve(v);
    return path.join(homedir(), fallback);
}

/** Root config dir: user-editable configuration lives here. */
export function configDir(): string {
    return path.join(xdg("XDG_CONFIG_HOME", ".config"), "sigma");
}

/** Main config file path. */
export function configFile(): string {
    const env = process.env.SIGMA_CONFIG_FILE;
    if (env && env.length > 0) return path.resolve(env);
    return path.join(configDir(), "sigma.json");
}

/** Root data dir: persistent session state lives here. */
export function dataDir(): string {
    return path.join(xdg("XDG_DATA_HOME", ".local/share"), "sigma");
}

/** Sessions dir: one JSON file per session. */
export function sessionsDir(): string {
    const env = process.env.SIGMA_SESSIONS_DIR;
    if (env && env.length > 0) return path.resolve(env);
    return path.join(dataDir(), "sessions");
}

/** Root cache dir: transient/ephemeral data (update-check throttle, etc.). */
export function cacheDir(): string {
    return path.join(xdg("XDG_CACHE_HOME", ".cache"), "sigma");
}

/** Root state dir: log files and other per-host state. */
export function stateDir(): string {
    return path.join(xdg("XDG_STATE_HOME", ".local/state"), "sigma");
}

/** Default log file path. */
export function defaultLogFile(): string {
    return path.join(stateDir(), "sigma.log");
}

/** Origin of the most recently started proxy (best-effort discovery file for
 *  host-spawned MCP shells that have no env passthrough: opencode/claude/codex). */
export function proxyOriginFile(): string {
    return path.join(stateDir(), "proxy-origin");
}

/** Body-dump dir (ACP_DUMP_BODY / SIGMA_DUMP_4XX): ACP_DUMP_DIR override first,
 *  else the XDG state dir so dumps co-locate with sigma.log on every platform. */
export function dumpsDir(): string {
    const env = process.env.ACP_DUMP_DIR;
    if (env && env.length > 0) return env;
    return path.join(stateDir(), "dumps");
}

/** CA dir: root CA + dynamically-signed host certificates for MITM mode.
 *  Lives under the data dir (the private key is sensitive but regenerable).
 *  Created lazily by ca.ts on first MITM use. */
export function caDir(): string {
    return path.join(dataDir(), "ca");
}
