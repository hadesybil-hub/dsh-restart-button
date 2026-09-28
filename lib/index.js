/**
 * dsh-restart-button — server half.
 *
 * Adds a loopback-only QUIT route to the DSH Web GUI. POST
 * /api/dsh-restart/quit asks the host to exit gracefully and spawns nothing:
 * once the process is gone its listening socket is closed, so the port is
 * released and the next launch is a cold start.
 *
 * The package keeps its original name; the button it draws used to restart.
 */

/** Stable cordis plugin name. */
export const name = "dsh-restart-button";
/** Services required before this plugin activates. */
export const inject = ["webServer"];
/** The single quit route path. */
export const QUIT_PATH = "/api/dsh-restart/quit";
/**
 * Fallback force-exit delay. Longer than DSH's own 5 s disposal grace, so the
 * plugin tree always gets its turn first; this only catches "tree disposed but
 * the event loop never drained", which would keep the port bound.
 */
export const FORCE_EXIT_AFTER_MS = 8000;

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

function makeQuitRoute(deps) {
	const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
	return {
		kind: "exact",
		path: QUIT_PATH,
		handler: (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
				res.end("method not allowed");
				return;
			}
			if (!deps.fence(req)) {
				writeJson(res, 403, { ok: false, code: "forbidden" });
				return;
			}
			// Answer first, then leave. The client renders its "DSH is down" card
			// from this response; there is no server left to ask afterwards.
			writeJson(res, 200, { ok: true });
			schedule(() => deps.requestExit(0), 200);
		}
	};
}

/** Resolve the loopback fence + exit seam to their concrete implementations. */
function makeDeps(ctx) {
	return {
		fence: isLoopbackRequest,
		requestExit: (code) => {
			const exit = ctx.get("appExit");
			if (exit === void 0) {
				process.exit(code);
				return;
			}
			try {
				exit(code);
			} catch {
				process.exit(code);
				return;
			}
			setTimeout(() => { try { process.exit(code); } catch {} }, FORCE_EXIT_AFTER_MS);
		}
	};
}

/* ---- plugin body ---- */

export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register(makeQuitRoute(makeDeps(ctx))), "dsh-restart-button: quit route");
}
