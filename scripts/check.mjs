// Syntax + manifest sanity check, plus the behavioural guards for the two
// things that decide whether a restart comes back: the waiter must carry the
// port it was launched with (never a hard-coded 3080) and must report what
// happened, and the entry script must be taken from the running install rather
// than guessed from a global path.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderWaiter, resolveDshBin } from "../lib/index.js";

const files = ["lib/index.js", "lib/client.js"];
for (const f of files) {
	const r = spawnSync(process.execPath, ["--check", f], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}
JSON.parse(readFileSync("package.json", "utf8"));

const faults = [];

const waiter = renderWaiter();
if (!waiter.includes("const port = Number(process.argv[3])")) faults.push("waiter does not read the port from argv");
if (!waiter.includes('[dshBin, "web", "--port", String(port)]')) faults.push("waiter does not pass --port to the new dsh web");
if (waiter.includes("port: 3080")) faults.push("waiter still hard-codes port 3080");
if (!waiter.includes("new server listening on")) faults.push("waiter does not confirm the new server came up");
if (!waiter.includes("nothing listening on")) faults.push("waiter does not report that the new server never came up");
if (!waiter.includes('openSync(boot, "a")') || !waiter.includes('stdio: ["ignore", fd, fd]')) {
	faults.push("waiter does not capture the new server's output for a failure to be diagnosable");
}

const fakeRoot = mkdtempSync(join(tmpdir(), "dsh-restart-button-"));
const fakeBin = join(fakeRoot, "@deepseek-ai", "dsh", "lib", "bin.js");
mkdirSync(dirname(fakeBin), { recursive: true });
writeFileSync(fakeBin, "");
const previousEntry = process.argv[1];
try {
	process.argv[1] = fakeBin;
	const resolved = resolveDshBin();
	if (resolved !== fakeBin) faults.push(`resolveDshBin ignored the running entry script (got ${String(resolved)})`);
} finally {
	process.argv[1] = previousEntry;
	rmSync(fakeRoot, { recursive: true, force: true });
}

if (faults.length > 0) {
	for (const fault of faults) console.error("check failed: " + fault);
	process.exit(1);
}
console.log("check ok");
