// Syntax + manifest sanity check, plus the one behavioural guard for the
// restart waiter: it must carry the port it was launched with, never a
// hard-coded 3080.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { renderWaiter } from "../lib/index.js";

const files = ["lib/index.js", "lib/client.js"];
for (const f of files) {
	const r = spawnSync(process.execPath, ["--check", f], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}
JSON.parse(readFileSync("package.json", "utf8"));

const waiter = renderWaiter();
const faults = [];
if (!waiter.includes("const port = Number(process.argv[3])")) faults.push("waiter does not read the port from argv");
if (!waiter.includes('"web", "--port", String(port)')) faults.push("waiter does not pass --port to the new dsh web");
if (waiter.includes("port: 3080")) faults.push("waiter still hard-codes port 3080");
if (faults.length > 0) {
	for (const fault of faults) console.error("check failed: " + fault);
	process.exit(1);
}
console.log("check ok");
