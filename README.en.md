# dsh-restart-button

A small [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a floating **restart** button to the bottom-right corner of the Web GUI. (On older builds it sat just above the desktop-launcher's floating **shutdown** button; the current launcher no longer draws one, so the button now stands alone.)

Click it once → a themed confirm card asks if you're sure → restart the `dsh web` process: the server comes back up and the page reloads itself — no need to close and double-click the desktop icon.

## What it does

| | |
| --- | --- |
| Floating restart button | Pinned to the bottom-right corner |
| Confirm gate | One click → themed "Restart DeepSeek Harness?" card → restart only if confirmed |
| Server route | `POST /api/dsh-restart/restart` (loopback-only) |
| Restart flow | Spawns a detached **node** waiter → waits for the port to free → starts a fresh `dsh web --port <the port it was serving on>` → watches it come up |
| Auto-return | The page watches the server leave and come back, then reloads itself — no dead tab, no duplicate tab |
| Visible failure | The waiter logs success or a concrete failure and captures the new server's output, so a restart that never comes back is diagnosable |

## Install

```bash
dsh plugin --profile web add "dsh-restart-button"
```

Then restart `dsh web`. The restart button appears in the bottom-right corner.

## How it works

- **Server half** (`lib/index.js`): a cordis plugin that registers the loopback-only `POST /api/dsh-restart/restart` route. On request it writes a self-contained **node waiter** and spawns it fully detached, then asks the host to exit gracefully (with a hard `process.exit` fallback so the port always frees).
- **Waiter**: waits for the serving port to be free, then `spawn(node …/dsh/lib/bin.js web --port <port>)` detached, where `<port>` is the port the old server actually listened on (so a `--port 8080` instance comes back on 8080). The entry script is taken from the running install (`process.argv[1]`), falling back to the well-known global layouts. The waiter then watches the port for up to 90 s and records the outcome in `~/dsh-restart-waiter.log`, with the new server's own stdout/stderr appended to `~/dsh-restart-boot.log`.
- **Relaunch command**: `dsh web` is left to open the browser by default. A caller that reconnects itself (the bundled client half) sends `x-dsh-restart-open-browser: 0` and gets `--no-open` instead, so a one-click restart does not leave a second tab behind.
- **Client half** (`lib/client.js`): plain-DOM, no React, no build step. Loaded through `window.__ModuleLoader__`, it appends the floating restart button, shows the confirm card, and after confirming polls the origin until the server is back and then reloads the page itself. The durable `dsh-auth` cookie is what carries the session across the restart, so the reload drops the one-shot `?token=` parameter.

## Security

- The route is **loopback-only** (peer socket + Host header + same-origin fence), matching the DSH plugin family convention.
- The restart uses node's `child_process` with `detached`/`unref` so the new server survives the old process's exit.

## License

MIT

## Repository

https://github.com/hadesybil-hub/dsh-restart-button
