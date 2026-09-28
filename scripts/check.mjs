// Syntax + manifest sanity check, plus this plugin's one invariant: quitting is
// terminal. The host half must never spawn a replacement process, the client
// must never try to come back, and both halves must agree on the route.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = ["lib/index.js", "lib/client.js"];
for (const f of files) {
	const r = spawnSync(process.execPath, ["--check", f], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}
JSON.parse(readFileSync("package.json", "utf8"));

const server = readFileSync("lib/index.js", "utf8");
const client = readFileSync("lib/client.js", "utf8");
const ROUTE = '"/api/dsh-restart/quit"';

const faults = [];
if (!server.includes(ROUTE)) faults.push("the host half does not register the quit route");
if (!client.includes(ROUTE)) faults.push("the client half does not call the quit route");
if (/child_process|spawn\(/.test(server)) faults.push("the host half spawns a process: quitting must not relaunch anything");
if (/location\.reload|location\.replace/.test(client)) faults.push("the client half reloads: after a quit there is nothing to come back to");

if (faults.length > 0) {
	for (const fault of faults) console.error("check failed: " + fault);
	process.exit(1);
}
console.log("check ok");
