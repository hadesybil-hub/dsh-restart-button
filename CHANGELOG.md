# Changelog
All notable changes to this project are documented in this file.

## [0.1.0] - 2026-08-29
- Initial release: restart button above the bottom-right shutdown button.
- Confirm gate before restarting.
- Loopback-only `POST /api/dsh-restart/restart` route.
- Node-waiter restart: waits for the port to free, starts a fresh `dsh web`, auto-reopens the browser.
