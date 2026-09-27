/**
 * dsh-restart-button — server half.
 *
 * Adds a loopback-only RESTART route to the DSH Web GUI. POST /
 * /api/dsh-restart/restart spawns a DETACHED node waiter — which waits for the
 * serving port to free, starts a fresh `dsh web --port <that port>`, and watches
 * it come up — then asks the host to exit gracefully a beat later. The detached
 * child survives the parent's exit, so the server comes back up.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Stable cordis plugin name. */
export const name = "dsh-restart-button";
/** Services required before this plugin activates. */
export const inject = ["webServer"];
/** The single restart route path. */
export const RESTART_PATH = "/api/dsh-restart/restart";
/** Request header a self-reconnecting caller sets to "0" to suppress the extra browser handoff. */
export const OPEN_BROWSER_HEADER = "x-dsh-restart-open-browser";

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
 * Resolve the entry script of the RUNNING dsh installation.
 *
 * `dsh web` is started as `node <install>/@deepseek-ai/dsh/lib/bin.js …`, so
 * `process.argv[1]` is the authoritative answer and follows any layout (npm
 * global, pnpm global, a trial copy, a source checkout). The hard-coded global
 * paths are only the fallback for a process that was not started that way.
 */
export function resolveDshBin() {
	const entry = process.argv[1];
	if (typeof entry === "string" && existsSync(entry) && /[\\/]@deepseek-ai[\\/]dsh[\\/].*[\\/]bin\.js$/i.test(entry)) return entry;
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
 * Render a self-contained node waiter.
 *
 * It waits for the serving port to free, spawns `node <dshBin> web --port <port>`
 * DETACHED, then watches the port for up to 90s. Success and failure both land
 * in ~/dsh-restart-waiter.log, and the new server's own stdout/stderr is
 * appended to ~/dsh-restart-boot.log — so a restart that does not come back
 * leaves a reason behind instead of dying silently.
 *
 * argv: 2 = dsh entry script, 3 = the port to free and re-bind,
 *       4 = "noopen" to suppress `dsh web`'s own browser handoff.
 */
export function renderWaiter() {
	return [
		"import { spawn } from \"node:child_process\";",
		"import { connect } from \"node:net\";",
		"import { homedir } from \"node:os\";",
		"import { join } from \"node:path\";",
		"import { appendFileSync, closeSync, openSync } from \"node:fs\";",
		"const log = join(homedir(), \"dsh-restart-waiter.log\");",
		"const boot = join(homedir(), \"dsh-restart-boot.log\");",
		"const L = (m) => { try { appendFileSync(log, new Date().toISOString() + \" \" + m + \"\\n\"); } catch {} };",
		"L(\"waiter: start\");",
		"const nodeBin = process.execPath;",
		"const dshBin = process.argv[2];",
		"const port = Number(process.argv[3]) || 3080;",
		"const openBrowser = process.argv[4] !== \"noopen\";",
		"const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
		"function listening() {",
		"  return new Promise((resolve) => {",
		"    const c = connect({ host: \"127.0.0.1\", port: port });",
		"    let done = false;",
		"    const finish = (up) => { if (done) return; done = true; try { c.destroy(); } catch {} resolve(up); };",
		"    c.on(\"connect\", () => finish(true));",
		"    c.on(\"error\", () => finish(false));",
		"    setTimeout(() => finish(false), 700);",
		"  });",
		"}",
		"(async () => {",
		"  for (let i = 0; i < 120; i++) {",
		"    if (!(await listening())) break;",
		"    await sleep(300);",
		"  }",
		"  const args = [dshBin, \"web\", \"--port\", String(port)];",
		"  if (!openBrowser) args.push(\"--no-open\");",
		"  L(\"waiter: port free, start dsh web on \" + port + (openBrowser ? \"\" : \" (no-open)\") + \"; output -> \" + boot);",
		"  let child;",
		"  try {",
		"    const fd = openSync(boot, \"a\");",
		"    child = spawn(nodeBin, args, { detached: true, stdio: [\"ignore\", fd, fd], windowsHide: true, env: process.env });",
		"    closeSync(fd);",
		"  } catch (error) {",
		"    L(\"waiter: FAILED, could not spawn dsh web: \" + error);",
		"    process.exit(1);",
		"  }",
		"  child.unref();",
		"  for (let i = 0; i < 90; i++) {",
		"    await sleep(1000);",
		"    if (await listening()) {",
		"      L(\"waiter: done, new server listening on \" + port + \" after \" + (i + 1) + \"s\");",
		"      process.exit(0);",
		"    }",
		"    if (child.exitCode !== null) {",
		"      L(\"waiter: FAILED, dsh web exited with code \" + child.exitCode + \" after \" + (i + 1) + \"s; see \" + boot);",
		"      process.exit(1);",
		"    }",
		"  }",
		"  L(\"waiter: FAILED, nothing listening on \" + port + \" after 90s; see \" + boot);",
		"  process.exit(1);",
		"})();"
	].join("\n");
}

/** Write the waiter and spawn it fully detached (survives the parent's exit). */
function scheduleRestart(port, openBrowser) {
	try {
		const path = waiterPath();
		const dshBin = resolveDshBin();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, renderWaiter(), "utf8");
		const child = spawn(process.execPath, [path, dshBin, String(port), openBrowser ? "open" : "noopen"], {
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
			// A caller that reconnects itself says so, and we skip `dsh web`'s own
			// browser handoff so the restart does not leave a duplicate tab behind.
			const openBrowser = req.headers[OPEN_BROWSER_HEADER] !== "0";
			writeJson(res, 200, { ok: true });
			// Spawn the detached restart NOW (it survives our exit), then exit.
			schedule(() => deps.restart(openBrowser), 200);
			schedule(() => deps.requestExit(0), 1200);
		}
	};
}

/** Resolve the loopback fence + exit seam to their concrete implementations. */
function makeDeps(ctx) {
	return {
		fence: isLoopbackRequest,
		restart: (openBrowser) => scheduleRestart(ctx.webServer.port, openBrowser),
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
