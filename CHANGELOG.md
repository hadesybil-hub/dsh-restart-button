# Changelog
All notable changes to this project are documented in this file.

## [0.2.0] - 2026-09-28
- **The page comes back on its own.** After a restart the client watches the server leave and return, then reloads itself — so one click restarts DSH and returns you to the session instead of leaving a dead tab behind. It reloads into the same URL minus the one-shot `?token=` handshake; the durable `dsh-auth` cookie is what carries the session across the restart.
- **No more duplicate tab.** A caller that reconnects itself asks the server to skip `dsh web`'s own browser handoff, via the `x-dsh-restart-open-browser: 0` request header. A plain `curl` POST still gets the browser handoff.
- **Themed confirm card replaces `window.confirm()`.** Follows the DSH theme variables; Esc and backdrop dismissal apply to the confirm gate only. The same card is re-used as the progress and failure card.
- **The entry script is taken from the running install.** `resolveDshBin()` now prefers `process.argv[1]`, so any install layout works (npm global, pnpm global, a trial copy, a source checkout); the two hard-coded global paths remain only as a fallback.
- **A restart that fails is no longer silent.** The waiter watches the new server for up to 90s, logs success or a concrete failure, and appends the new server's stdout/stderr to `~/.dsh/dsh-restart-boot.log`.
- `scripts/check.mjs` now guards the entry-script resolution and the waiter's port/watchdog/reporting plumbing.

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
