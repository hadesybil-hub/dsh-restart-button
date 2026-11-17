/**
 * dsh-restart-button — server half.
 *
 * Adds a loopback-only RESTART route to the DSH Web GUI. POST
 * /api/dsh-restart/restart asks the Desktop application (shell + Host) to
 * restart: the Desktop shell owns the Host as a child process and exposes no
 * restart seam to plugins, so the route starts a detached helper that closes
 * the shell gracefully, waits for it to disappear, and launches the same
 * executable again. The next window is a cold start.
 *
 * DSH 0.2.x: verified against the 0.2.2-rc.3 runtime. The Host is spawned by
 * the Desktop shell as `<exe> --expose-internals .../dsh-desktop-host/lib/index.js`,
 * so `process.ppid` is the shell process and `process.execPath` is the Desktop
 * executable — the two facts the helper needs.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/** Stable cordis plugin name. */
export const name = "dsh-restart-button";
/** Services required before this plugin activates. */
export const inject = ["webServer"];
/** The single restart route path. */
export const RESTART_PATH = "/api/dsh-restart/restart";

const HELPER = join(dirname(fileURLToPath(import.meta.url)), "restart-helper.mjs");

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

/**
 * Accept only a request that came from the machine itself.
 *
 * The Desktop shell forwards `dsh-app://app/*` to the Host through
 * `forwardWebRequest`, which strips `origin`, `host`, `cookie` and
 * `sec-fetch-site` before it re-fetches the Host, so a Desktop request arrives
 * with no Origin at all — the same shape as a same-origin browser request.
 */
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
	// The Desktop page origin is dsh-app://app; a browser tab is same-origin.
	if (origin === "dsh-app://app") return true;
	try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

/* ---- desktop facts ---- */

/**
 * Facts about the process tree the helper needs, or `undefined` when this Host
 * was not started by the Desktop shell (a CLI `dsh web` has no shell to restart).
 * @returns {{ appPid: number, executable: string, logPath: string } | undefined}
 */
export function desktopFacts() {
	const launchedByShell = process.argv.some((argument) => typeof argument === "string" && argument.includes("dsh-desktop-host"));
	if (!launchedByShell) return undefined;
	const appPid = process.ppid;
	if (!Number.isSafeInteger(appPid) || appPid <= 0) return undefined;
	const executable = process.execPath;
	if (typeof executable !== "string" || executable === "") return undefined;
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return {
		appPid,
		executable,
		logPath: join(home === "" ? join(homedir(), ".dsh") : home, "dsh-restart-button.log")
	};
}

/* ---- route ---- */

function writeJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}

/**
 * Start the detached helper that owns the restart.
 *
 * The helper is spawned before the response is written so a client that sees
 * `202` knows a restart is actually under way. It is detached, ignores stdio,
 * and unref'd, so it survives this Host and the shell it is about to close.
 * @param facts - Desktop process facts resolved by {@link desktopFacts}.
 * @returns the spawned helper, already unref'd.
 */
export function spawnHelper(facts) {
	const child = spawn(process.execPath, [HELPER, String(facts.appPid), facts.executable, facts.logPath], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
		cwd: dirname(HELPER),
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
	});
	child.unref();
	return child;
}

export function makeRestartRoute(deps) {
	const spawnHelperImpl = deps.spawnHelper;
	return {
		kind: "exact",
		path: RESTART_PATH,
		handler: (request, res) => {
			if (request.method !== "POST") {
				res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
				res.end("method not allowed");
				return;
			}
			if (!isLoopbackRequest(request)) {
				writeJson(res, 403, { ok: false, code: "forbidden" });
				return;
			}
			const facts = deps.facts();
			if (facts === void 0) {
				writeJson(res, 501, {
					ok: false,
					code: "desktop-only",
					message: "这个按钮只在 DeepSeek Harness 桌面版里可用：当前 Host 不是由桌面 shell 启动的，没有可重启的宿主进程。"
				});
				return;
			}
			let helper;
			try {
				helper = spawnHelperImpl(facts);
			} catch (error) {
				writeJson(res, 500, {
					ok: false,
					code: "helper-failed",
					message: error instanceof Error ? error.message : String(error)
				});
				return;
			}
			// 202: accepted, the restart itself happens outside this process.
			writeJson(res, 202, { ok: true, appPid: facts.appPid, helperPid: helper.pid ?? null });
		}
	};
}

/* ---- plugin body ---- */

export function apply(ctx) {
	const route = makeRestartRoute({ facts: desktopFacts, spawnHelper });
	ctx.effect(() => ctx.webServer.register(route), "dsh-restart-button: restart route");
}
