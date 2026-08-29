/**
 * dsh-restart-button — server half.
 *
 * Adds a loopback-only RESTART route next to the shutdown control. POST /
 * /api/dsh-restart/restart spawns a DETACHED restart script (which waits for
 * the port to free, starts a fresh `dsh web`, re-injects User env vars, and
 * opens the browser), then asks the host to exit gracefully a beat later.
 * The detached child survives the parent's exit, so the server comes back up.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Stable cordis plugin name. */
export const name = "dsh-restart-button";
/** Services required before this plugin activates. */
export const inject = ["webServer", "systemPrompt"];
/** The single restart route path. */
export const RESTART_PATH = "/api/dsh-restart/restart";

/* ---- loopback fence (same shape as the dsh-desktop-launcher family) ---- */

function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}

function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}

function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try { hostUrl = new URL("http://" + host); } catch { return false; }
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

/* ---- restart waiter ---- */

/**
 * Resolve the dsh web entry script (`node_modules/@deepseek-ai/dsh/lib/bin.js`).
 * Tries the npm-global and pnpm-global layouts; falls back to the first.
 */
function resolveDshBin() {
	const cands = [
		join(process.env.APPDATA ?? "", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
		join(process.env.LOCALAPPDATA ?? "", "pnpm", "dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
	];
	for (const c of cands) if (existsSync(c)) return c;
	return cands[0];
}

/** Where the generated node waiter lives (next to the desktop-launcher scripts). */
function waiterPath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "desktop-launcher", "dsh-restart-waiter.mjs");
}

/**
 * Render a self-contained node waiter. It waits for the port to free, then
 * spawns `node <dshBin> web` DETACHED (dsh web auto-opens the browser), and
 * exits. All node — no PowerShell indirection, so the spawn is reliable.
 */
function renderWaiter() {
	return [
		"import { spawn } from \"node:child_process\";",
		"import { connect } from \"node:net\";",
		"import { homedir } from \"node:os\";",
		"import { join } from \"node:path\";",
		"import { appendFileSync } from \"node:fs\";",
		"const log = join(homedir(), \"dsh-restart-waiter.log\");",
		"const L = (m) => { try { appendFileSync(log, new Date().toISOString() + \" \" + m + \"\\n\"); } catch {} };",
		"L(\"waiter: start\");",
		"const nodeBin = process.execPath;",
		"const dshBin = process.argv[2];",
		"function portFree() {",
		"  return new Promise((resolve) => {",
		"    const c = connect({ host: \"127.0.0.1\", port: 3080 });",
		"    let done = false;",
		"    const finish = (free) => { if (done) return; done = true; try { c.destroy(); } catch {} resolve(free); };",
		"    c.on(\"connect\", () => finish(false));",
		"    c.on(\"error\", () => finish(true));",
		"    setTimeout(() => finish(true), 700);",
		"  });",
		"}",
		"(async () => {",
		"  for (let i = 0; i < 120; i++) {",
		"    if (await portFree()) break;",
		"    await new Promise((r) => setTimeout(r, 300));",
		"  }",
		"  L(\"waiter: port free, start dsh web\");",
		"  const child = spawn(nodeBin, [dshBin, \"web\"], { detached: true, stdio: \"ignore\", windowsHide: true, env: process.env });",
		"  child.unref();",
		"  L(\"waiter: done\");",
		"  process.exit(0);",
		"})();"
	].join("\n");
}

/** Write the waiter and spawn it fully detached (survives the parent's exit). */
function scheduleRestart() {
	try {
		const path = waiterPath();
		const dshBin = resolveDshBin();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, renderWaiter(), "utf8");
		const child = spawn(process.execPath, [path, dshBin], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			env: process.env
		});
		child.unref();
	} catch {
		/* best-effort: the host still exits below */
	}
}

/* ---- route ---- */

function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store"
	});
	res.end(payload);
}

function makeRestartRoute(deps) {
	const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
	return {
		kind: "exact",
		path: RESTART_PATH,
		handler: async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
				res.end("method not allowed");
				return;
			}
			if (!deps.fence(req)) {
				writeJson(res, 403, { ok: false, code: "forbidden" });
				return;
			}
			writeJson(res, 200, { ok: true });
			// Spawn the detached restart NOW (it survives our exit), then exit.
			schedule(() => deps.restart(), 200);
			schedule(() => deps.requestExit(0), 1200);
		}
	};
}

/** Resolve the loopback fence + exit seam to their concrete implementations. */
function makeDeps(ctx) {
	return {
		fence: isLoopbackRequest,
		restart: scheduleRestart,
		requestExit: (code) => {
			const exit = ctx.get("appExit");
			if (exit !== void 0) {
				try { exit(code); } catch {}
				// Hard fallback: if graceful teardown hangs, force-exit so the
				// port frees and the restart script can bind it.
				setTimeout(() => { try { process.exit(code); } catch {} }, 4000);
			} else {
				process.exit(code);
			}
		}
	};
}

/* ---- plugin body ---- */

export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register(makeRestartRoute(makeDeps(ctx))), "dsh-restart-button: restart route");
}
