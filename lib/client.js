/**
 * dsh-restart-button — client half.
 *
 * A plain-DOM floating RESTART button in the bottom-right corner. Clicking it
 * opens a themed confirm card; confirming POSTs to the loopback-only
 * /api/dsh-restart/restart route, which starts a detached helper that restarts
 * the Desktop application. The page then watches the server leave and come
 * back: in a browser tab it reloads itself; in the Desktop app the window is
 * replaced by the freshly launched one.
 *
 * No React and no build step: DSH loads this file through
 * window.__ModuleLoader__ and calls the exported apply(ctx) once.
 */
window.__ModuleLoader__.load({
	// Must equal the package name: the Host maps bundle modules to entries by it.
	id: "@darkthee/dsh-restart-button",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		/** Services this surface needs (none: plain DOM only). */
		var inject = [];

		var RESTART_PATH = "/api/dsh-restart/restart";
		/** How often to probe while waiting for the server to leave or return. */
		var POLL_MS = 700;
		/** Consecutive consistent probes required before believing a transition. */
		var CONFIRM_PROBES = 2;
		/** Give up claiming success after this long. A cold Desktop start can be slow. */
		var RESTART_TIMEOUT_MS = 180000;

		var CSS = [
			".dsh-restart-float{position:fixed;bottom:76px;right:24px;width:46px;height:46px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#1b1e27);color:var(--dsw-alias-label-secondary,#9ba1b0);box-shadow:var(--dsw-shadow-lv3,0 4px 12px rgba(0,0,0,.4));cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;padding:0;z-index:900;transition:background-color .12s,color .12s,box-shadow .12s}",
			".dsh-restart-float:hover{background:var(--dsw-alias-interactive-bg-hover,#2a2e3a);color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
			".dsh-restart-float:active{background:var(--dsw-alias-interactive-bg-active,#23262f)}",
			".dsh-restart-float:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#1b1e27),0 0 0 4px var(--dsw-alias-brand-primary,#4d6bfe);outline:none}",
			".dsh-restart-float svg{pointer-events:none}",
			".dsh-restart-float[data-spinning='true'] svg{animation:dsh-restart-spin 1s linear infinite}",
			".dsh-restart-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}",
			".dsh-restart-card{min-width:340px;max-width:460px;background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.08));border-radius:12px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.28)}",
			".dsh-restart-title{font-size:16px;font-weight:600;margin:0 0 8px}",
			".dsh-restart-body{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);margin:0;white-space:pre-wrap;word-break:break-word}",
			".dsh-restart-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}",
			".dsh-restart-btn{min-width:76px;height:30px;padding:0 12px;border-radius:8px;font-size:13px;cursor:pointer;border:1px solid var(--dsw-alias-border-l,rgba(9,9,11,.2));background:transparent;color:inherit}",
			".dsh-restart-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}",
			".dsh-restart-btn-primary{background:var(--dsw-alias-state-business-primary,#2f6fed);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}",
			".dsh-restart-spinner{display:inline-block;width:12px;height:12px;margin-right:8px;vertical-align:-1px;border-radius:50%;border:2px solid var(--dsw-alias-border-l,rgba(0,0,0,.2));border-top-color:var(--dsw-alias-state-business-primary,#2f6fed);animation:dsh-restart-spin .8s linear infinite}",
			"@keyframes dsh-restart-spin{to{transform:rotate(360deg)}}"
		].join("");

		function ensureCss() {
			var style = document.getElementById("dsh-restart-button-css");
			if (style === null) {
				style = document.createElement("style");
				style.id = "dsh-restart-button-css";
				style.textContent = CSS;
				document.head.appendChild(style);
			}
			return style;
		}

		/** Refresh glyph: a circular arrow, the universal "start over" mark. */
		function restartIcon(size) {
			var ns = "http://www.w3.org/2000/svg";
			var svg = document.createElementNS(ns, "svg");
			svg.setAttribute("width", size);
			svg.setAttribute("height", size);
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("fill", "none");
			svg.setAttribute("aria-hidden", "true");
			var strokes = ["M21 12a9 9 0 1 1-2.64-6.36", "M21 3v6h-6"];
			for (var i = 0; i < strokes.length; i++) {
				var path = document.createElementNS(ns, "path");
				path.setAttribute("d", strokes[i]);
				path.setAttribute("stroke", "currentColor");
				path.setAttribute("strokeWidth", "2.2");
				path.setAttribute("strokeLinecap", "round");
				path.setAttribute("strokeLinejoin", "round");
				svg.appendChild(path);
			}
			return svg;
		}

		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/** One themed overlay card, re-labelled as the restart moves through its phases. */
		function openCard(options) {
			var overlay = document.createElement("div");
			overlay.className = "dsh-restart-overlay";
			var card = document.createElement("div");
			card.className = "dsh-restart-card";
			card.setAttribute("role", "dialog");
			card.setAttribute("aria-modal", "true");
			card.setAttribute("tabindex", "-1");
			var title = document.createElement("div");
			title.className = "dsh-restart-title";
			title.textContent = options.title;
			var body = document.createElement("div");
			body.className = "dsh-restart-body";
			var footer = document.createElement("div");
			footer.className = "dsh-restart-footer";
			card.appendChild(title);
			card.appendChild(body);
			card.appendChild(footer);
			overlay.appendChild(card);

			var closed = false;
			function close() {
				if (closed) return;
				closed = true;
				document.removeEventListener("keydown", onKey, true);
				if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
			}
			function onKey(event) {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				close();
			}
			var api = {
				close: close,
				setTitle: function (text) {
					title.textContent = text;
				},
				setBody: function (text, busy) {
					body.textContent = "";
					if (busy === true) {
						var spinner = document.createElement("span");
						spinner.className = "dsh-restart-spinner";
						spinner.setAttribute("aria-hidden", "true");
						body.appendChild(spinner);
					}
					body.appendChild(document.createTextNode(text));
				},
				setActions: function (actions) {
					while (footer.firstChild !== null) footer.removeChild(footer.firstChild);
					var first = null;
					for (var i = 0; i < actions.length; i++) {
						var action = actions[i];
						var button = document.createElement("button");
						button.type = "button";
						button.className = "dsh-restart-btn" + (action.primary === true ? " dsh-restart-btn-primary" : "");
						button.textContent = action.label;
						button.addEventListener("click", action.onSelect);
						footer.appendChild(button);
						if (first === null) first = button;
						if (action.primary === true) first = button;
					}
					if (first !== null) first.focus();
				}
			};
			api.setBody(options.body, options.busy);
			api.setActions(options.actions);
			if (options.dismissible !== false) {
				document.addEventListener("keydown", onKey, true);
				overlay.addEventListener("click", function (event) {
					if (event.target === overlay) close();
				});
			}
			document.body.appendChild(overlay);
			if (options.dismissible === false) card.focus();
			return api;
		}

		/**
		 * One probe of the server.
		 * @returns "up" (200), "down" (no answer, or the shell answered 5xx because
		 * its Host is gone), or "unknown" for anything else.
		 */
		async function probe() {
			try {
				var response = await fetch("/", { method: "GET", cache: "no-store", credentials: "same-origin" });
				if (response.status === 200) return "up";
				if (response.status >= 500) return "down";
				return "unknown";
			} catch {
				return "down";
			}
		}

		var sleep = function (milliseconds) {
			return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
		};

		/** Wait until the server reports the expected state for CONFIRM_PROBES probes in a row. */
		async function waitForState(expected, deadline) {
			var hits = 0;
			while (Date.now() < deadline) {
				var state = await probe();
				if (state === expected) {
					hits += 1;
					if (hits >= CONFIRM_PROBES) return true;
				} else {
					hits = 0;
				}
				await sleep(POLL_MS);
			}
			return false;
		}

		function apply(ctx) {
			var styleTag = ensureCss();
			var host = document.createElement("div");
			host.dataset.dshRestartFloat = "true";
			document.body.appendChild(host);

			var button = document.createElement("button");
			button.type = "button";
			button.className = "dsh-restart-float";
			button.title = "重启 DeepSeek Harness";
			button.setAttribute("aria-label", "重启 DeepSeek Harness");
			button.appendChild(restartIcon(20));

			var disposed = false;
			var card = null;

			function setSpinning(spinning) {
				button.dataset.spinning = spinning ? "true" : "false";
			}

			function setEnabled(enabled) {
				button.disabled = !enabled;
				if (enabled) button.removeAttribute("disabled");
				else button.setAttribute("disabled", "disabled");
			}

			function showFailure(title, text) {
				setEnabled(true);
				setSpinning(false);
				if (card !== null) {
					card.setTitle(title);
					card.setBody(text, false);
					card.setActions([{ label: "关闭", primary: true, onSelect: function () { card.close(); card = null; } }]);
				}
			}

			async function restart() {
				setEnabled(false);
				setSpinning(true);
				if (card !== null) card.close();
				card = openCard({
					title: "正在重启 DeepSeek Harness",
					body: "正在发送重启请求…",
					busy: true,
					dismissible: false,
					actions: []
				});
				var response;
				try {
					response = await fetch(RESTART_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: "{}"
					});
				} catch (error) {
					showFailure("重启请求失败", "没能联系上服务：" + messageOf(error));
					return;
				}
				if (!response.ok) {
					var detail = "";
					try {
						var payload = await response.json();
						if (typeof payload.message === "string") detail = payload.message;
					} catch {
						// A non-JSON body leaves the status line as the only explanation.
					}
					showFailure("重启请求被拒绝", "服务返回 HTTP " + String(response.status) + (detail === "" ? "。" : "：" + detail));
					return;
				}
				var deadline = Date.now() + RESTART_TIMEOUT_MS;
				if (card !== null) card.setBody("服务正在关闭，稍等…", true);
				if (!await waitForState("down", deadline)) {
					showFailure("重启没有完成", "重启请求已经发出，但服务在 3 分钟内一直没有停下。\n可以查看 " + "~/.dsh/dsh-restart-button.log 了解助手进程停在哪里，或手动关闭应用再打开。");
					return;
				}
				if (disposed) return;
				if (card !== null) card.setBody("服务已关闭，正在启动新的会话…", true);
				if (!await waitForState("up", deadline)) {
					showFailure("重启没有完成", "服务已经关闭，但 3 分钟内没有重新应答。\n桌面版会自己弹出新窗口；如果没出现，请手动打开应用，并查看 ~/.dsh/dsh-restart-button.log。");
					return;
				}
				if (disposed) return;
				window.location.reload();
			}

			button.addEventListener("click", function () {
				if (button.disabled) return;
				card = openCard({
					title: "重启 DeepSeek Harness？",
					body: "桌面版会重启整个应用（界面与 Host 都重启），正在跑的任务会被中断。\n如果系统弹出退出确认，请点「退出」；新窗口会自动出现，这个页面不会回来。",
					actions: [
						{ label: "取消", onSelect: function () { card.close(); card = null; } },
						{ label: "确定重启", primary: true, onSelect: function () { restart(); } }
					]
				});
			});
			host.appendChild(button);

			return function dispose() {
				disposed = true;
				if (card !== null) {
					card.close();
					card = null;
				}
				if (button.parentNode !== null) button.parentNode.removeChild(button);
				if (host.parentNode !== null) host.parentNode.removeChild(host);
				if (styleTag.parentNode !== null) styleTag.parentNode.removeChild(styleTag);
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
