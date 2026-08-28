# dsh-restart-button

A small [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a **restart** button just above the existing bottom-right **shutdown** button in the Web GUI.

Click it once → a confirm dialog asks if you're sure → restart the `dsh web` process: the server comes back up and the browser reopens — no need to close and double-click the desktop icon.

## What it does

| | |
| --- | --- |
| Floating restart button | Pinned above the shutdown power button |
| Confirm gate | One click → "Restart?" dialog → restart only if confirmed |
| Server route | `POST /api/dsh-restart/restart` (loopback-only) |
| Restart flow | Spawns a detached **node** waiter → waits for the port to free → starts a fresh `dsh web` (which auto-opens the browser) |

## Install

```bash
dsh plugin --profile web add "dsh-restart-button"
```

Then restart `dsh web`. The restart button appears in the bottom-right, above the shutdown button.

## How it works

- **Server half** (`lib/index.js`): a cordis plugin that registers the loopback-only `POST /api/dsh-restart/restart` route. On request it writes a self-contained **node waiter** and spawns it fully detached, then asks the host to exit gracefully (with a hard `process.exit` fallback so the port always frees).
- **Waiter**: waits for port 3080 to be free, then `spawn(node …/dsh/lib/bin.js web)` detached. `dsh web` auto-opens the browser, so no manual browser-open step is needed. It also logs to `~/dsh-restart-waiter.log`.
- **Client half** (`lib/client.js`): plain-DOM, no React, no build step. Loaded through `window.__ModuleLoader__`, it appends the floating restart button with the confirm gate.

## Security

- The route is **loopback-only** (peer socket + Host header + same-origin fence), matching the DSH plugin family convention.
- The restart uses node's `child_process` with `detached`/`unref` so the new server survives the old process's exit.

## License

MIT

## Repository

https://github.com/hadesybil-hub/dsh-restart-button
