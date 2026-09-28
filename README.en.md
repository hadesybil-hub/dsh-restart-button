# dsh-restart-button

A small [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a floating **quit** button to the bottom-right corner of the Web GUI. (It used to restart; v0.3.0 changed it to a full exit. The package keeps its original name.)

Click it once → a themed confirm card asks if you're sure → `dsh web` fully exits and its port is released. The next launch is a cold start.

## What it does

| | |
| --- | --- |
| Floating quit button | Pinned to the bottom-right corner, power glyph, tints red on hover |
| Confirm gate | One click → themed "Quit DeepSeek Harness?" card → quits only if confirmed |
| Server route | `POST /api/dsh-restart/quit` (loopback-only) |
| Quit flow | Answers the request, then asks the host to exit gracefully. **Spawns nothing.** |
| Port release | The listening socket dies with the process, so the port frees on its own |
| Result card | The page watches for the server to stop answering, then says so and how to start again |

## Install

```bash
dsh plugin --profile web add "dsh-restart-button"
```

Then restart `dsh web`. The quit button appears in the bottom-right corner.

## How it works

- **Server half** (`lib/index.js`): a cordis plugin that registers the loopback-only `POST /api/dsh-restart/quit` route. It writes the `200` first — the client renders its result card from that response, because there is no server left to ask afterwards — then calls the host's `ctx.appExit` seam.
- **Exit**: `ctx.appExit` runs DSH's own bounded shutdown — the plugin tree is disposed, then a hard exit after 5 s if disposal hangs. The plugin adds its own force-exit fallback at **8 s**, deliberately *after* that grace, so the tree always gets its turn and the fallback only catches "disposed but the event loop never drained".
- **Client half** (`lib/client.js`): plain-DOM, no React, no build step. Loaded through `window.__ModuleLoader__`, it appends the floating button, shows the confirm card, and after confirming polls the origin until requests stop being answered — a rejected `fetch` is the only honest "it is really gone" signal available from inside the page.

## Security

- The route is **loopback-only** (peer socket + Host header + same-origin fence), matching the DSH plugin family convention.
- Quitting spawns no process and writes no file. `scripts/check.mjs` fails the build if the host half ever grows a `spawn` again.

## License

MIT

## Repository

https://github.com/hadesybil-hub/dsh-restart-button
