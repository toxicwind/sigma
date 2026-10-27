#!/usr/bin/env bun
// sigma-guard — ONE shared MCP entry for BOTH tau and kappa.
//
// Sigma is a provider proxy: it MITMs a client's model traffic, compresses
// it, and exposes the plugin's ACP tools. Its MCP surface is a stdio
// server (src/mcp.ts) that fetches the proxy's tool manifest and forwards
// executes to it.
//
// The problem this solves: sigma had no home in the estate. The
// SIGMA_GUARD_URL keyring entry pointed at 127.0.0.1:25210/mcp, which is
// GRAFANA's backend port (and /mcp there is a 404) — a stale value from
// a service that was never actually deployed. So "the guard" existed in
// the keyring but nothing served it.
//
// The unification: one proxy, ONE stdio entry, registered in BOTH client
// configs. A client that speaks MCP stdio (tau extensions, kappa plugins)
// gets the same guard tools and the same proxy state. There is no second
// proxy, no second manifest, no schema drift.
//
// Usage:
//   sigma-guard                     # stdio MCP server (the client entry)
//   sigma-guard --manifest          # print the proxy's tool manifest as JSON
//   sigma-guard --status            # print proxy/instance status as JSON
//
// Env:
//   SIGMA_MCP_PROXY   proxy origin (default http://127.0.0.1:8787)
//   SIGMA_GUARD_FAIL  when the proxy is unreachable: "degraded" (default,
//                     serve a stub so the client still starts) or "fail"

import { forwardTool, resolveProxyOrigin } from "./mcp.js";
import { fetchManifest } from "./agent/shared.js";

function proxyOrigin(): string {
	return resolveProxyOrigin();
}

/// A CLI flag's presence. `process.argv.indexOf(name)` finds the flag,
/// but a boolean flag at the END of argv has no following value — reading
/// argv[i+1] then yields undefined and the flag looks absent.
function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

/// A CLI flag's value (the token after it), if any.
function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	if (i < 0) return undefined;
	const next = process.argv[i + 1];
	return next && !next.startsWith("--") ? next : undefined;
}

async function manifest(): Promise<unknown> {
	// The shared manifest helper returns the Anthropic-wire tool list
	// (name/description/inputSchema) - the MCP-compatible schema source.
	const tools = await fetchManifest(proxyOrigin(), "anthropic");
	return { tools };
}

async function status(): Promise<unknown> {
	const origin = proxyOrigin();
	// The proxy's plugin status endpoint requires a conversationId; without
	// one it answers 400. A bare liveness probe plus the instance record
	// is what a caller actually wants here.
	try {
		const res = await fetch(`${origin}/__bili/stats`, {
			signal: AbortSignal.timeout(5000),
		});
		return {
			ok: res.ok,
			origin,
			stats: res.ok ? await res.json() : null,
		};
	} catch (e) {
		return { ok: false, origin, error: String(e) };
	}
}

// --- stdio MCP server -------------------------------------------------------
// Minimal JSON-RPC over stdio: initialize / tools/list / tools/call.
// Deliberately dependency-free so the same entry runs under tau's bun
// runtime and under kappa's plugin loader without a build step.

type Rpc = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };

function send(msg: Record<string, unknown>): void {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

async function toolsList(): Promise<unknown> {
	try {
		const m = (await manifest()) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] };
		return m?.tools ?? [];
	} catch (e) {
		if ((process.env.SIGMA_GUARD_FAIL ?? "degraded") === "fail") throw e;
		process.stderr.write(`[sigma-guard] manifest unavailable (${e}); serving an empty tool list\n`);
		return [];
	}
}

async function toolsCall(name: string, args: unknown): Promise<string> {
	return forwardTool(name, args);
}

async function handle(msg: Rpc): Promise<void> {
	const { id, method, params } = msg;
	switch (method) {
		case "initialize":
			send({
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: { listChanged: true } },
					serverInfo: { name: "sigma-guard", version: "1.0.0" },
				},
			});
			return;
		case "notifications/initialized":
			return;
		case "ping":
			send({ jsonrpc: "2.0", id, result: {} });
			return;
		case "tools/list": {
			let tools: Record<string, unknown>[] = [];
			try {
				tools = (await toolsList()) as Record<string, unknown>[];
			} catch (e) {
				if ((process.env.SIGMA_GUARD_FAIL ?? "degraded") === "fail") {
					send({
						jsonrpc: "2.0",
						id,
						error: { code: -32000, message: String(e) },
					});
					return;
				}
				process.stderr.write(`[sigma-guard] tools/list degraded: ${e}\n`);
			}
			send({ jsonrpc: "2.0", id, result: { tools } });
			return;
		}
		case "tools/call": {
			const p = (params ?? {}) as { name?: string; arguments?: unknown };
			try {
				const text = await toolsCall(p.name ?? "", p.arguments);
				send({
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text }], isError: false },
				});
			} catch (e) {
				send({
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text: String(e) }], isError: true },
				});
			}
			return;
		}
		default:
			if (id !== undefined)
				send({
					jsonrpc: "2.0",
					id,
					error: { code: -32601, message: `method ${method} not supported` },
				});
	}
}

async function main(): Promise<void> {
	if (hasFlag("--manifest")) {
		process.stdout.write(JSON.stringify(await manifest(), null, 2) + "\n");
		return;
	}
	if (hasFlag("--status")) {
		// The status probe must never take the process down with it.
		const st = await status().catch((e) => ({ ok: false, origin: proxyOrigin(), error: String(e) }));
		process.stdout.write(JSON.stringify(st, null, 2) + "\n");
		return;
	}

	// Requests are handled SEQUENTIALLY: the client may pipeline, and the
	// response order must match the request order. A promise chain keeps
	// the process alive until every reply is written.
	let queue: Promise<void> = Promise.resolve();
	let buffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk: string) => {
		buffer += chunk;
		let idx: number;
		while ((idx = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, idx).trim();
			buffer = buffer.slice(idx + 1);
			if (!line) continue;
			queue = queue.then(async () => {
				try {
					const msg = JSON.parse(line) as Rpc;
					await handle(msg);
				} catch (e) {
					process.stderr.write(`[sigma-guard] bad input: ${e}\n`);
				}
			});
		}
	});
	process.stdin.on("end", () => {
		// Flush the queue before exiting, or the last reply is lost.
		void queue.then(() => process.exit(0));
	});
}

// `void main()` lets the process exit before an async CLI branch writes
// its output, so the CLI paths are awaited explicitly and the stdio
// server keeps the event loop alive on its own.
main().catch((e) => {
	process.stderr.write(`[sigma-guard] fatal: ${e}\n`);
	process.exit(1);
});
