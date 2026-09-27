# Changelog
All notable changes to this project are documented in this file.

## [0.1.1] - 2026-09-28
- Verified against DSH 0.1.7-rc.2: the host route still registers and the client half still loads through `window.__ModuleLoader__`. No API break was found.
- Fix: the restart waiter no longer hard-codes port 3080. It reads `ctx.webServer.port` and starts the new server with `dsh web --port <that port>`, so a non-default-port instance no longer comes back bound to 3080 (where it would fail to listen).
- Fix: drop the unused `systemPrompt` from `inject`. It was never used, and a missing injected service silently prevents the whole plugin from activating.
- Docs: the floating shutdown button it used to sit above is no longer drawn by the current launcher; the button now stands alone in the bottom-right corner.

## [0.1.0] - 2026-08-29
- Initial release: restart button above the bottom-right shutdown button.
- Confirm gate before restarting.
- Loopback-only `POST /api/dsh-restart/restart` route.
- Node-waiter restart: waits for the port to free, starts a fresh `dsh web`, auto-reopens the browser.
