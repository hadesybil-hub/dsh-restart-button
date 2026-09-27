/**
 * dsh-restart-button — client half.
 *
 * A plain-DOM floating "restart" button in the bottom-right corner. Clicking it
 * opens a themed confirm card; confirming POSTs to the loopback-only
 * /api/dsh-restart/restart route, then watches the server go away and come back
 * and reloads this page on its own once it does — so one click restarts DSH and
 * returns you to the session instead of leaving a dead tab behind.
 *
 * No React and no build step: DSH loads this file through
 * window.__ModuleLoader__ and calls the exported apply(ctx) once.
 */
window.__ModuleLoader__.load({
	id: "dsh-restart-button",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		/** Services this surface needs (none: plain DOM only). */
		var inject = [];

		var RESTART_PATH = "/api/dsh-restart/restart";
		/** Poll cadence while watching the server go down and come back. */
		var POLL_MS = 1000;
		/** Give up waiting after this long (> the waiter's own 36s + 90s budget). */
		var RETURN_TIMEOUT_MS = 180000;

		var CSS = [
			".dsh-restart-float{position:fixed;bottom:76px;right:24px;width:46px;height:46px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#1b1e27);color:var(--dsw-alias-label-secondary,#9ba1b0);box-shadow:var(--dsw-shadow-lv3,0 4px 12px rgba(0,0,0,.4));cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;padding:0;z-index:900;transition:background-color .12s,color .12s,box-shadow .12s}",
			".dsh-restart-float:hover{background:var(--dsw-alias-interactive-bg-hover,#2a2e3a);color:var(--dsw-alias-label-primary,#e8e8e8)}",
			".dsh-restart-float:active{background:var(--dsw-alias-interactive-bg-active,#23262f)}",
			".dsh-restart-float:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#1b1e27),0 0 0 4px var(--dsw-alias-brand-primary,#4d6bfe);outline:none}",
			".dsh-restart-float svg{pointer-events:none}",
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

		function restartIcon(size) {
			var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", size);
			svg.setAttribute("height", size);
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("fill", "none");
			svg.setAttribute("aria-hidden", "true");
			var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", "M12 5a7 7 0 1 0 7 7m-7-10v4m0 0h4");
			path.setAttribute("stroke", "currentColor");
			path.setAttribute("strokeWidth", "2.2");
			path.setAttribute("strokeLinecap", "round");
			path.setAttribute("strokeLinejoin", "round");
			svg.appendChild(path);
			return svg;
		}

		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/**
		 * One themed overlay card, shared by the confirm gate and the progress /
		 * failure card, so the same box can be re-labelled as the restart moves
		 * from "closing" to "waiting" to "it did not come back".
		 */
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
			var pollTimer = null;
			var card = null;
			/** True once a poll has failed, proving the old server is gone. */
			var sawDown = false;
			/** When the POST succeeded; bounds how long we wait for it to return. */
			var startedAt = 0;

			function setEnabled(enabled) {
				button.disabled = !enabled;
				if (enabled) button.removeAttribute("disabled");
				else button.setAttribute("disabled", "disabled");
			}

			function stopPolling() {
				if (pollTimer !== null) {
					clearTimeout(pollTimer);
					pollTimer = null;
				}
			}

			function showFailure(title, text) {
				stopPolling();
				if (card !== null) {
					card.setBody(text, false);
					card.setActions([{ label: "关闭", primary: true, onSelect: function () { card.close(); card = null; } }]);
				}
				setEnabled(true);
			}

			/**
			 * Reload into the same page without the one-shot ?token= handshake
			 * parameter. The durable dsh-auth cookie is what carries the session
			 * across the restart, and a stale token in a non-root URL would be
			 * rejected outright.
			 */
			function reloadClean() {
				var url = new URL(location.href);
				url.searchParams.delete("token");
				location.replace(url.href);
			}

			function poll() {
				if (disposed) return;
				if (Date.now() - startedAt > RETURN_TIMEOUT_MS) {
					showFailure("没能自动回来",
						"服务在 3 分钟内没有重新应答。\n重启日志：~/.dsh/dsh-restart-waiter.log\n新实例输出：~/.dsh/dsh-restart-boot.log\n可以手动刷新这个页面，或者双击桌面上的 DSH 启动器。");
					return;
				}
				fetch("/", { method: "GET", cache: "no-store", credentials: "same-origin" })
					.then(function (response) {
						if (sawDown && response.status < 500) {
							reloadClean();
							return;
						}
						schedulePoll();
					}, function () {
						sawDown = true;
						if (card !== null) card.setBody("服务已停止，正在等它重新起来…", true);
						schedulePoll();
					});
			}

			function schedulePoll() {
				pollTimer = setTimeout(poll, POLL_MS);
			}

			async function restart() {
				setEnabled(false);
				stopPolling();
				if (card !== null) card.close();
				card = openCard({
					title: "正在重启 DeepSeek Harness",
					body: "正在请求服务退出，稍等…",
					busy: true,
					dismissible: false,
					actions: []
				});
				var response;
				try {
					response = await fetch(RESTART_PATH, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							// We reload this page ourselves once the server is back,
							// so skip dsh web's own browser handoff (no duplicate tab).
							"x-dsh-restart-open-browser": "0"
						},
						body: "{}"
					});
				} catch (error) {
					showFailure("重启请求失败", "没能联系上服务：" + messageOf(error));
					return;
				}
				if (!response.ok) {
					showFailure("重启请求被拒绝", "服务返回 HTTP " + String(response.status) + "。");
					return;
				}
				sawDown = false;
				startedAt = Date.now();
				if (card !== null) card.setBody("服务正在关闭…", true);
				schedulePoll();
			}

			button.addEventListener("click", function () {
				if (button.disabled) return;
				card = openCard({
					title: "重启 DeepSeek Harness？",
					body: "dsh web 会先退出，然后自动重新拉起，并自己回到这个页面。期间页面大约断开 30 秒。",
					actions: [
						{ label: "取消", onSelect: function () { card.close(); card = null; } },
						{ label: "确定重启", primary: true, onSelect: function () { restart(); } }
					]
				});
			});
			host.appendChild(button);

			return function dispose() {
				disposed = true;
				stopPolling();
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
