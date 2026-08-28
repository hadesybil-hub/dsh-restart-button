// Syntax + manifest sanity check for dsh-restart-button.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = ["lib/index.js", "lib/client.js"];
for (const f of files) {
	const r = spawnSync(process.execPath, ["--check", f], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}
JSON.parse(readFileSync("package.json", "utf8"));
console.log("check ok");
