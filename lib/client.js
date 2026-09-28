/**
 * dsh-restart-button — client half.
 *
 * A plain-DOM floating QUIT button in the bottom-right corner. Clicking it opens
 * a themed confirm card; confirming POSTs to the loopback-only
 * /api/dsh-restart/quit route, which exits dsh web and releases its port. The
 * card then reports that DSH is down and how to start it again.
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

		var QUIT_PATH = "/api/dsh-restart/quit";
		/** Poll cadence while waiting for the server to stop answering. */
		var POLL_MS = 500;
		/** Give up claiming success after this long; DSH's own grace is 5 s. */
		var EXIT_TIMEOUT_MS = 15000;

		var CSS = [
			".dsh-restart-float{position:fixed;bottom:76px;right:24px;width:46px;height:46px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#1b1e27);color:var(--dsw-alias-label-secondary,#9ba1b0);box-shadow:var(--dsw-shadow-lv3,0 4px 12px rgba(0,0,0,.4));cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;padding:0;z-index:900;transition:background-color .12s,color .12s,box-shadow .12s}",
			".dsh-restart-float:hover{background:var(--dsw-alias-interactive-bg-hover,#2a2e3a);color:var(--dsw-alias-state-error-primary,#e5484d)}",
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
			".dsh-restart-btn-primary{background:var(--dsw-alias-state-error-primary,#d92d20);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}",
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

		/** Power glyph: an open ring with a stem, the universal "off" mark. */
		function quitIcon(size) {
			var ns = "http://www.w3.org/2000/svg";
			var svg = document.createElementNS(ns, "svg");
			svg.setAttribute("width", size);
			svg.setAttribute("height", size);
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("fill", "none");
			svg.setAttribute("aria-hidden", "true");
			var strokes = ["M18.36 6.64a9 9 0 1 1-12.73 0", "M12 2v10"];
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

		/**
		 * One themed overlay card, shared by the confirm gate and the progress /
		 * result card, so the same box can be re-labelled as the quit moves from
		 * "closing" to "gone".
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
			button.title = "完全退出 DeepSeek Harness";
			button.setAttribute("aria-label", "完全退出 DeepSeek Harness");
			button.appendChild(quitIcon(20));

			var disposed = false;
			var pollTimer = null;
			var card = null;

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

			function showResult(title, text) {
				stopPolling();
				if (card !== null) {
					card.close();
				}
				card = openCard({
					title: title,
					body: text,
					actions: [{ label: "关闭", primary: true, onSelect: function () { card.close(); card = null; } }]
				});
			}

			/**
			 * Watch for the server to stop answering. A rejected fetch is the only
			 * honest "it is really gone" signal available from inside the page.
			 */
			function waitForExit(startedAt) {
				if (disposed) return;
				if (Date.now() - startedAt > EXIT_TIMEOUT_MS) {
					showResult("服务仍在应答",
						"退出请求已经发出，但 15 秒后 3080 还在应答。\n可以用桌面的 DSH 启动器加 -Stop 兜底，或看看 ~/.dsh/dsh-web-boot.err.log。");
					setEnabled(true);
					return;
				}
				fetch("/", { method: "GET", cache: "no-store", credentials: "same-origin" })
					.then(function () {
						pollTimer = setTimeout(function () { waitForExit(startedAt); }, POLL_MS);
					}, function () {
						showResult("DSH 已完全退出",
							"dsh web 已停止，3080 已释放。\n下次双击桌面上的「DSH 启动器」就是冷启动。");
					});
			}

			async function quit() {
				setEnabled(false);
				stopPolling();
				if (card !== null) card.close();
				card = openCard({
					title: "正在退出 DeepSeek Harness",
					body: "正在请求服务退出，稍等…",
					busy: true,
					dismissible: false,
					actions: []
				});
				var response;
				try {
					response = await fetch(QUIT_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: "{}"
					});
				} catch (error) {
					showFailure("退出请求失败", "没能联系上服务：" + messageOf(error));
					return;
				}
				if (!response.ok) {
					showFailure("退出请求被拒绝", "服务返回 HTTP " + String(response.status) + "。");
					return;
				}
				if (card !== null) card.setBody("服务正在退出…", true);
				waitForExit(Date.now());
			}

			button.addEventListener("click", function () {
				if (button.disabled) return;
				card = openCard({
					title: "完全退出 DeepSeek Harness？",
					body: "dsh web 会完全退出，端口随之释放。正在跑的任务会被中断。\n下次启动请双击桌面上的「DSH 启动器」，那是冷启动。",
					actions: [
						{ label: "取消", onSelect: function () { card.close(); card = null; } },
						{ label: "确定退出", primary: true, onSelect: function () { quit(); } }
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
