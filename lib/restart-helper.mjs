/**
 * dsh-restart-button — detached restart helper.
 *
 * Runs outside the Desktop application so it can outlive the process it closes.
 * Started by the Host route with `<appPid> <executable> <logPath>`.
 *
 * Sequence:
 *  1. wait for the HTTP response that triggered this helper to reach the page;
 *  2. close the Desktop shell gracefully (WM_CLOSE on Windows, SIGTERM
 *     elsewhere) so its own shutdown path disposes the Host and flushes sessions;
 *  3. if it is still alive after the grace window, terminate it hard;
 *  4. wait until the process is really gone, then launch the same executable.
 *
 * Launching only after the pid disappears matters: the Desktop shell holds a
 * single-instance lock, so a new instance started too early would hand its
 * arguments to the dying first instance and exit.
 */

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";

const RESPONSE_SETTLE_MS = 1500;
/** Wide enough for the shell's own quit confirmation to be read and answered by a person. */
const GRACEFUL_CLOSE_MS = 25000;
const LAUNCH_SETTLE_MS = 600;

const [appPidArgument, executable, logPath] = process.argv.slice(2);
const appPid = Number(appPidArgument);

const sleep = (milliseconds) => new Promise((resolve) => {
	setTimeout(resolve, milliseconds);
});

function log(message) {
	if (typeof logPath !== "string" || logPath === "") return;
	try {
		appendFileSync(logPath, `${new Date().toISOString()} [helper pid ${process.pid}] ${message}\n`);
	} catch {
		// Logging is diagnostic only; a failed write must not stop the restart.
	}
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to someone else.
		return error?.code === "EPERM";
	}
}

async function waitGone(pid, budgetMs) {
	const deadline = Date.now() + budgetMs;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return true;
		await sleep(250);
	}
	return !isAlive(pid);
}

/**
 * Ask the shell to close. A taskkill without `/F` posts WM_CLOSE to its
 * top-level windows, which Electron turns into a normal quit: the shell then
 * disposes the Host itself and flushes sessions.
 */
function requestClose(pid) {
	if (process.platform === "win32") {
		spawn("taskkill", ["/PID", String(pid)], { stdio: "ignore", windowsHide: true });
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		log(`SIGTERM failed: ${String(error)}`);
	}
}

async function main() {
	log(`restart requested for ${String(executable)} (shell pid ${String(appPid)})`);
	if (!Number.isSafeInteger(appPid) || appPid <= 0 || typeof executable !== "string" || executable === "") {
		log("invalid arguments; nothing to do");
		return;
	}
	// Let the 202 response and the client card reach the page first.
	await sleep(RESPONSE_SETTLE_MS);

	if (isAlive(appPid)) {
		log("requesting a graceful close");
		requestClose(appPid);
		if (!await waitGone(appPid, GRACEFUL_CLOSE_MS)) {
			// Never force this: the remaining possibilities are a person answering
			// the shell's own quit confirmation, or a deliberate cancel. Killing
			// here would override that decision and could truncate Host writes.
			log("shell is still running after the graceful window; abandoning relaunch");
			return;
		}
		log("shell exited");
	} else {
		log("shell already gone; relaunching only");
	}

	await sleep(LAUNCH_SETTLE_MS);
	try {
		const child = spawn(executable, [], {
			detached: true,
			stdio: "ignore",
			windowsHide: false,
			cwd: dirname(executable)
		});
		child.unref();
		log(`relaunched (pid ${String(child.pid)})`);
	} catch (error) {
		log(`relaunch failed: ${String(error)}`);
	}
}

await main();
