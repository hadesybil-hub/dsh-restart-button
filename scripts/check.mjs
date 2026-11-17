// Syntax + manifest sanity check, plus this plugin's invariants: the button
// restarts, both halves agree on the route, the helper exists, and the helper
// launches nothing before the shell it is replacing has actually exited.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = ["lib/index.js", "lib/client.js", "lib/restart-helper.mjs"];
for (const f of files) {
	const r = spawnSync(process.execPath, ["--check", f], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}
JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("package.json", "utf8"));

const server = readFileSync("lib/index.js", "utf8");
const client = readFileSync("lib/client.js", "utf8");
const helper = readFileSync("lib/restart-helper.mjs", "utf8");
const ROUTE = '"/api/dsh-restart/restart"';

const faults = [];
if (!server.includes(ROUTE)) faults.push("the host half does not register the restart route");
if (!client.includes(ROUTE)) faults.push("the client half does not call the restart route");
if (!existsSync("lib/restart-helper.mjs")) faults.push("the restart helper is missing");
if (!/spawn\(process\.execPath/.test(server)) faults.push("the host half no longer spawns the detached helper");
if (!/waitGone\(appPid/.test(helper)) faults.push("the helper does not wait for the shell to exit");
if (!/executable, \[\]/.test(helper)) faults.push("the helper does not relaunch the executable");
if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") faults.push("the bundle patch is not declared");
if (manifest.dsh?.client?.platform !== "web") faults.push("the client platform is not web");
if (manifest.dsh?.engines?.dsh === undefined) faults.push("engines.dsh is not declared");

if (faults.length > 0) {
	for (const fault of faults) console.error("check failed: " + fault);
	process.exit(1);
}
console.log("check ok");
