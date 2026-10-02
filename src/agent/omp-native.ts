// Native omp mode (#957): the package-installed omp extension bootstraps its
// own proxy — bare `omp` (with this package installed via
// `sigma plugin install omp`) gets full plugin-mode compression with NO
// launcher. Same flow as pi-native.ts (#519):
//   1. spawn the package's own proxy (`dist/index.js start`, ephemeral
//      port, parent-pid watchdog = this omp process) via ensureProxyRunning —
//      a healthy compatible instance is ATTACHED, not doubled;
//   2. patch globalThis.fetch (native-intercept.ts) so model-API requests
//      are rewritten to `<proxy>/sigma/<full-upstream-url>` (verified
//      patchable under Bun — omp runs on a bundled bun);
//   3. set SIGMA_PROXY so the shared plugin (pi.ts) detects the
//      proxy through its existing env fallback — tools, /acp, the compaction
//      cancel and the prompt_cache_key stamp all reuse the launcher-mode
//      code paths. omp never emits before_provider_headers, so its
//      runtime-info report (#955) rides before_provider_request instead.
// Skipped when a proxy is already managed (SIGMA_PROXY set by a
// `sigma` MITM launch, or SIGMA_PROVIDER_REWRITES set by a `sigma` /sigma/
// launch) or opted out (SIGMA_NATIVE_OMP=0).

import { ensureProxyRunning, LAUNCHER_DEFAULT_HOST } from "../launcher.js";
import { createSigmaPlugin } from "./pi.js";
import { markNativeHost, nativeBootstrapGate, nativeProxyScriptPath, singleFlight } from "./native-bootstrap.js";
import { installNativeFetchIntercept, type NativeInterceptState } from "./native-intercept.js";

/** Decides whether the native bootstrap should run in this process. */
export function shouldBootstrapNativeOmp(env: NodeJS.ProcessEnv): boolean {
    return nativeBootstrapGate(env, "SIGMA_NATIVE_OMP");
}

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

const state: NativeInterceptState = { origin: undefined, ready: Promise.resolve(undefined) };

async function bootstrap(): Promise<string | undefined> {
    try {
        const handle = await ensureProxyRunning(
            { host: LAUNCHER_DEFAULT_HOST, port: 0, passthrough: false, debug: false, lane: "omp" },
            { scriptPath: nativeProxyScriptPath() },
        );
        const origin = handle.origin;
        state.origin = origin;
        process.env.SIGMA_PROXY = origin;
        return origin;
    } catch (err) {
        console.error(`sigma-native: proxy bootstrap failed — model traffic goes direct (uncompressed): ${errMessage(err)}`);
        return undefined;
    }
}

const nativeActive = shouldBootstrapNativeOmp(process.env);
if (nativeActive) markNativeHost(process.env, "omp");

// node:test imports this module for shouldBootstrapNativeOmp — never
// bootstrap a real proxy from inside a test run.
if (process.env.NODE_TEST_CONTEXT === undefined && nativeActive) {
    const start = singleFlight(bootstrap);
    state.respawn = start;
    state.onGiveUp = () => {
        // We wrote SIGMA_PROXY at successful bootstrap. If the proxy
        // dies mid-session and the respawn fails, traffic goes direct — clear
        // the env so event-time ownership checks (session_before_compact
        // cancel, prompt_cache_key stamping) stop claiming compression
        // ownership and native compaction comes back with the direct traffic.
        delete process.env.SIGMA_PROXY;
    };
    state.ready = start();
    installNativeFetchIntercept(state);
}

export default createSigmaPlugin("omp");
