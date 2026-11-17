# @darkthee/dsh-restart-button

A small [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a floating **restart** button to the bottom-right corner of the Web GUI. One click restarts the application; the next window is a cold start.

## What it does

| | |
| --- | --- |
| Floating button | Pinned to the bottom-right corner, refresh glyph, tints on hover |
| Confirm gate | One click → themed "重启 DeepSeek Harness？" card → restarts only if confirmed |
| Desktop app | Restarts the **whole application**: the Electron shell closes (its own quit path disposes the Host and flushes sessions) and the same executable is launched again |
| CLI `dsh web` | Refuses with `501 desktop-only`: there is no shell to restart, and this plugin will not spawn a competing server |
| Route | `POST /api/dsh-restart/restart` (loopback-only) |
| Result | In a browser tab the page watches the server leave and return, then reloads itself |

## Install

```bash
dsh plugin --profile desktop add @darkthee/dsh-restart-button
```

Restart the application once: the Host reads bundle manifests at startup.

## How it works

The Desktop shell spawns the Host as a child process (`<exe> --expose-internals .../dsh-desktop-host/lib/index.js`) and exposes **no restart seam to plugins** — `ctx.appExit` only stops the Host, which leaves the shell showing its recovery dialog. So the restart is owned by a process that can outlive both:

- **Host half** (`lib/index.js`): registers the loopback-only route. On `POST` it starts `lib/restart-helper.mjs` as a **detached, unref'd** child, then answers `202`. It reads the two facts the helper needs from its own process: `process.ppid` (the shell) and `process.execPath` (the executable).
- **Helper** (`lib/restart-helper.mjs`): waits for the response to reach the page, asks the shell to close (`taskkill <pid>` without `/F`, i.e. `WM_CLOSE`; `SIGTERM` elsewhere), then waits for the pid to actually disappear and launches the same executable. Launching only after the pid is gone matters: the shell holds a single-instance lock, so an early second instance would just hand its arguments to the dying first one.
- **It never force-kills.** If the shell is still alive after 25 s — a person answered the shell's own quit confirmation with cancel, or something is wedged — the helper logs it and gives up. Killing there would override a deliberate cancel and could truncate Host writes.
- **Client half** (`lib/client.js`): plain DOM, no React, no build step. Loaded through `window.__ModuleLoader__`; the module id equals the package name, which is how the Host maps a browser bundle to its entry.

## Security

- The route is **loopback-only**: peer socket, `Host` header, and same-origin fence. The Desktop shell forwards `dsh-app://app/*` to the Host after stripping `origin`/`host`/`cookie`, so a Desktop request arrives origin-less and passes the fence; a cross-site browser request cannot.
- Restarting spawns exactly one process (the helper) and writes nothing but a log line.

## Diagnostics

`~/.dsh/dsh-restart-button.log` (or `$DSH_HOME/dsh-restart-button.log`) records each step: the requested restart, the graceful close, the wait, the relaunch, or the reason it gave up.

## License

MIT

## Repository

https://github.com/hadesybil-hub/dsh-restart-button
