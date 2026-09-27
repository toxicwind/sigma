import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

process.env.NODE_ENV = "test";

import { defaultConfig } from "acp-kernel";
import { startServer, type ProxyOptions } from "../src/server.ts";
import { SessionStore, _setStoreForTest } from "../src/persist.ts";
import {
    _setForTest as setRegistryForTest,
    _setOpenRouterForTest,
    loadOpenRouterModels,
    peekOpenRouterContext,
    peekOpenRouterOutputLimit,
} from "../src/registry.ts";
import { listSessions } from "../src/session.ts";

// #1462: OpenRouter publishes each model's context window at runtime
// (`context_length`), which models.dev/OpenAI/Anthropic/zhipu/comfly do not.
// A live session on stealth/space-bunny-alpha was budgeted against a 200,000
// window while the model serves 1,000,000, so preflight fired at "526% of the
// window" and spent up to 330,735 ms compressing a payload that was never over
// the real one. A published window outranks the built-in family table but not
// client/plugin/operator evidence, and is tier-capped exactly like the
// models.dev source (#1321).

test("#1462 peekOpenRouterContext: exact published id only, never a guess", () => {
    _setOpenRouterForTest({
        "stealth/space-bunny-alpha": { context: 1_000_000, output: 524_288 },
        "vendor/no-output": { context: 200_000 },
    });
    try {
        assert.equal(peekOpenRouterContext("stealth/space-bunny-alpha"), 1_000_000, "exact published id resolves");
        assert.equal(peekOpenRouterOutputLimit("stealth/space-bunny-alpha"), 524_288, "top_provider.max_completion_tokens is the ceiling");
        assert.equal(peekOpenRouterOutputLimit("vendor/no-output"), undefined, "a model publishing no ceiling reports none");
        // nvidia/nemotron-3.5-lightning-30b-a3b is NOT on OpenRouter (verified
        // against the live /v1/models), so discovery must yield nothing and let
        // the family table answer rather than assuming a sibling's window.
        assert.equal(peekOpenRouterContext("nvidia/nemotron-3.5-lightning-30b-a3b"), undefined, "an unpublished id is never guessed");
        assert.equal(peekOpenRouterContext("space-bunny-alpha"), undefined, "a bare root is not resolved by exact id");
    } finally {
        _setOpenRouterForTest(null);
    }
});

test("#1462 peekOpenRouterContext: an unloaded cache yields nothing, it never throws", () => {
    _setOpenRouterForTest(null);
    assert.equal(peekOpenRouterContext("stealth/space-bunny-alpha"), undefined, "no cache means no published window");
    assert.equal(peekOpenRouterOutputLimit("stealth/space-bunny-alpha"), undefined, "same for the output ceiling");
    assert.equal(peekOpenRouterContext(undefined), undefined, "a missing model id is not an error");
});

// startServer calls `void loadOpenRouterModels()`, and a fire-and-forget fetch
// inside a widely used factory is a test-hygiene landmine: every test that
// builds a proxy inherits a real request to openrouter.ai, and the open socket
// keeps the event loop alive so the suite never exits (observed: 5/5 passing
// tests, 458 models fetched, then a 600s hang). A warm cache is the seam, so
// this pins the short-circuit every seeded test depends on.
test("#1462: a warm cache short-circuits discovery instead of reaching the network", async () => {
    _setOpenRouterForTest({ "vendor/seeded": { context: 64_000 } });
    const started = process.hrtime.bigint();
    try {
        await loadOpenRouterModels();
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        assert.ok(elapsedMs < 50, `a warm cache returns immediately, took ${elapsedMs.toFixed(1)}ms`);
        // If the fetch had run it would have replaced the cache with all 458 live
        // models and dropped vendor/seeded entirely.
        assert.equal(peekOpenRouterContext("vendor/seeded"), 64_000, "the warm cache is untouched by the short-circuit");
        assert.equal(peekOpenRouterContext("stealth/space-bunny-alpha"), undefined, "no live catalog leaked in");
    } finally {
        _setOpenRouterForTest(null);
    }
});

function okSse(inputTokens: number): string {
    return (
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", role: "assistant", usage: { input_tokens: inputTokens } } })}\n\n` +
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n` +
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}\n\n` +
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n` +
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } })}\n\n` +
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
    );
}

interface Rig {
    proxyPort: number;
    upstreamPort: number;
    proxy: http.Server;
    upstream: http.Server;
}

// deepseek-v4-flash is table-matched at 1,000,000 (CONTEXT_LIMIT_TABLE /^deepseek/i),
// so it proves a published window both lowers AND raises the family guess.
const MODEL = "deepseek/deepseek-v4-flash";
const TABLE = 1_000_000;

async function startRig(): Promise<Rig> {
    const upstream = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(okSse(500));
        });
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = upstream.address().port;

    _setStoreForTest(new SessionStore({ enabled: false }));
    setRegistryForTest({});
    const proxy = await startServer({
        port: 0,
        host: "127.0.0.1",
        upstream: "http://127.0.0.1",
        routes: { [`http://127.0.0.1:${upstreamPort}`]: {} },
        modelContextLimit: 200_000,
        kernelConfig: defaultConfig(200_000),
        compress: { injectTool: true, injectNudge: true },
        promptCache: { routing: "auto" },
        sessionHeader: "x-acp-session",
        log: false,
        debug: false,
        passthrough: false,
        autoUpdate: false,
        mitm: { enabled: false, domains: [] },
    } as ProxyOptions);
    await once(proxy, "listening");
    return { proxyPort: proxy.address().port, upstreamPort, proxy, upstream };
}

async function effectiveLimit(rig: Rig, session: string): Promise<number | undefined> {
    const r = await fetch(`http://127.0.0.1:${rig.proxyPort}/bili/http://127.0.0.1:${rig.upstreamPort}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-acp-session": session, "x-bili-plugin": "test-agent" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(r.status, 200);
    await r.text();
    return listSessions().find((s) => s.id === session)?.metadata.effectiveContextLimit;
}

async function closeRig(rig: Rig): Promise<void> {
    rig.proxy.close();
    await once(rig.proxy, "close");
    rig.upstream.close();
    await once(rig.upstream, "close");
}

// Seed BEFORE startRig. startServer kicks off `void loadOpenRouterModels()`,
// which early-returns on a warm cache — so seeding here is what keeps these
// tests off the network entirely. Without it every rig fires a real fetch to
// openrouter.ai and the suite never exits.
test("#1462: a published OpenRouter window outranks the built-in family table", async () => {
    const rig = await startRig();
    // startRig seeds the registry, which also clears this cache, so the
    // published windows have to be installed after the server exists.
    _setOpenRouterForTest({ [MODEL]: { context: 128_000 } });
    try {
        assert.equal(await effectiveLimit(rig, "or-lower"), 128_000, "published 128k beats the table's 1,000,000");
    } finally {
        _setOpenRouterForTest(null);
        await closeRig(rig);
    }
});

test("#1462: an unpublished id falls through to the family table unchanged", async () => {
    const rig = await startRig();
    _setOpenRouterForTest({ "vendor/some-other-model": { context: 128_000 } });
    try {
        assert.equal(await effectiveLimit(rig, "or-absent"), TABLE, "no published window means the table still answers");
    } finally {
        _setOpenRouterForTest(null);
        await closeRig(rig);
    }
});

test("#1462: a published window can also RAISE a stale family guess", async () => {
    const rig = await startRig();
    _setOpenRouterForTest({ [MODEL]: { context: 2_000_000 } });
    try {
        assert.equal(await effectiveLimit(rig, "or-higher"), 2_000_000, "published 2M beats the table's 1,000,000");
    } finally {
        _setOpenRouterForTest(null);
        await closeRig(rig);
    }
});
