import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

process.env.NODE_ENV = "test";

import { defaultConfig } from "acp-kernel";
import { startServer } from "../src/server.ts";
import type { ProxyOptions } from "../src/config.ts";
import { SessionStore, _setStoreForTest } from "../src/persist.ts";
import { _setForTest as setRegistryForTest } from "../src/registry.ts";
import { MAX_PREFLIGHT_ROUNDS, MAX_SUMMARY_CALLS_PER_PREFLIGHT } from "../src/preflight.ts";

// The summarization budget (MAX_SUMMARY_CALLS_PER_PREFLIGHT) bounds CALLS, so it
// only bounds wall time while the upstream is fast. A live run spent 330735ms
// across 3 ranges — ~44 tokens/sec — and threw the result away when the client
// disconnected mid-flight. compress.maxPreflightMs is the wall-clock counterpart:
// it must cut the walk short and report a DISTINCT, retryable failure, and
// disabling it must restore the old call-count behaviour exactly.

// This file's only deliberate wall-clock dependency is SUMMARY_DELAY_MS, and it
// is the documented exception: the code under test reads Date.now() across a real
// fetch to a real http.Server, so fake timers cannot reach it — the clock being
// exercised IS the platform clock, and a slow upstream is the only way to make
// "the ceiling fired before the call budget" observable at all. The assertions
// are therefore on CALL COUNTS, which stay deterministic under load (a slow
// machine fires the ceiling EARLIER, never later), not on elapsed time.

const WINDOW = 30_000;
const COUNT = 400;
const REPEATS = 200;
const SUMMARY_DELAY_MS = 120;
const SUMMARY_TEXT =
    "PREFLIGHT SUMMARY: this segment is a load-growth fixture whose every marker is derivable from its turn index, so the folded view keeps everything the work still needs and drops only repetition.";

const CALLS: { summary: boolean }[] = [];

function longMessages(count: number, repeats: number): { role: string; content: string }[] {
    const messages: { role: string; content: string }[] = [];
    for (let i = 0; i < count; i++) {
        messages.push({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `turn ${i}: ` + `FILLER_${i}_payload_`.repeat(repeats),
        });
    }
    return messages;
}

function mockSlowUpstream(): http.Server {
    return http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const isSummary = /TASK: The conversation segment below/.test(raw);
            CALLS.push({ summary: isSummary });
            // Only the summarization call is slow; the forward path answers at
            // once, so any delay in the test is unambiguously preflight's.
            const answer = (): void => {
                if (raw.includes('"stream":true')) {
                    res.writeHead(200, { "content-type": "text/event-stream" });
                    res.end(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "gpt-test", choices: [{ index: 0, delta: { content: "forwarded answer" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`);
                } else {
                    res.writeHead(200, { "content-type": "application/json" });
                    res.end(JSON.stringify({ id: "chatcmpl-sum", object: "chat.completion", model: "gpt-test", choices: [{ index: 0, message: { role: "assistant", content: SUMMARY_TEXT }, finish_reason: "stop" }] }));
                }
            };
            if (isSummary) setTimeout(answer, SUMMARY_DELAY_MS);
            else answer();
        });
    });
}

function proxyOptions(upstreamPort: number, maxPreflightMs: number): ProxyOptions {
    return {
        port: 0,
        host: "127.0.0.1",
        upstream: "http://127.0.0.1",
        routes: { [`http://127.0.0.1:${upstreamPort}`]: { models: { "gpt-test": { context: WINDOW } } } } as ProxyOptions["routes"],
        modelContextLimit: WINDOW,
        kernelConfig: defaultConfig(WINDOW, {
            preserveRecentMessages: 2,
            preserveRecentTokens: 2000,
            compress: { minCompressRange: 1000, maxSummaryLength: 20000, minSummaryLength: 50 },
        }),
        compress: { injectTool: true, injectNudge: true, maxPreflightMs },
        sessionHeader: "x-acp-session",
        log: false,
        debug: false,
        passthrough: false,
        autoUpdate: false,
        mitm: { enabled: false, domains: [] },
    } as ProxyOptions;
}

async function runWithCeiling(maxPreflightMs: number): Promise<{ status: number; body: string; summaries: number }> {
    CALLS.length = 0;
    _setStoreForTest(new SessionStore({ enabled: false }));
    setRegistryForTest({});
    const upstream = mockSlowUpstream();
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxy = await startServer(proxyOptions(upstreamPort, maxPreflightMs));
    await once(proxy, "listening");
    const proxyPort = (proxy.address() as { port: number }).port;

    try {
        const resp = await fetch(`http://127.0.0.1:${proxyPort}/bili/http://127.0.0.1:${upstreamPort}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-acp-session": `ceiling-${maxPreflightMs}` },
            body: JSON.stringify({ model: "gpt-test", stream: true, messages: longMessages(COUNT, REPEATS) }),
        });
        const body = await resp.text();
        return { status: resp.status, body, summaries: CALLS.filter((c) => c.summary).length };
    } finally {
        proxy.close();
        await once(proxy, "close");
        upstream.close();
        await once(upstream, "close");
    }
}

test("e2e preflight: a slow upstream is cut short by the wall-clock ceiling, not the call budget", async () => {
    const CEILING = 500;
    const { status, body, summaries } = await runWithCeiling(CEILING);

    assert.equal(status, 502, `the still-over-window payload must be refused: HTTP ${status} ${body.slice(0, 240)}`);
    const json = JSON.parse(body) as { error?: { code?: string; message?: string } };
    assert.equal(json.error?.code, "preflight_compress_failed");
    assert.match(json.error?.message ?? "", /wall-clock ceiling/i, `names the ceiling, not the call budget (got: ${json.error?.message})`);
    assert.match(json.error?.message ?? "", new RegExp(`${CEILING}ms`), `quotes the configured ceiling (got: ${json.error?.message})`);

    // The whole point: fewer calls than the call budget allows, because the clock
    // ran out first. Without the ceiling this fixture spends all 16.
    assert.ok(summaries > 0, `the walk must start before the ceiling bites (got ${summaries})`);
    assert.ok(summaries < MAX_SUMMARY_CALLS_PER_PREFLIGHT, `the ceiling must cut the walk short of the call budget (got ${summaries} vs ${MAX_SUMMARY_CALLS_PER_PREFLIGHT})`);
});

test("e2e preflight: maxPreflightMs 0 disables the ceiling and restores the call budget", async () => {
    const { status, body, summaries } = await runWithCeiling(0);

    assert.equal(status, 502, `beyond the round budget the turn must be refused: HTTP ${status} ${body.slice(0, 240)}`);
    const json = JSON.parse(body) as { error?: { message?: string } };
    assert.doesNotMatch(json.error?.message ?? "", /wall-clock ceiling/i, `a disabled ceiling must never fire (got: ${json.error?.message})`);
    assert.match(json.error?.message ?? "", new RegExp(`exhausted after ${MAX_PREFLIGHT_ROUNDS} rounds`, "i"), `reports the round budget instead (got: ${json.error?.message})`);
    assert.equal(summaries, MAX_SUMMARY_CALLS_PER_PREFLIGHT, `the full call budget is spent when the ceiling is off (got ${summaries})`);
});
