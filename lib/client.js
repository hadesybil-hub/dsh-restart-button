/**
 * dsh-restart-button — client half.
 *
 * A plain-DOM floating "restart" button pinned at the bottom-right, just above
 * the shutdown power button. Clicking it POSTs to the loopback-only
 * /api/dsh-restart/restart route, which restarts the dsh web process. No React
 * and no build step: DSH loads this file through window.__ModuleLoader__ and
 * calls the exported apply(ctx) once.
 */
window.__ModuleLoader__.load({
	id: "dsh-restart-button",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		/** Services this surface needs (none: plain DOM only). */
		var inject = [];

		var CSS = [
			".dsh-restart-float{position:fixed;bottom:76px;right:24px;width:46px;height:46px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#1b1e27);color:var(--dsw-alias-label-secondary,#9ba1b0);box-shadow:var(--dsw-shadow-lv3,0 4px 12px rgba(0,0,0,.4));cursor:pointer;border:none;display:inline-flex;align-items:center;justify-content:center;padding:0;z-index:900;transition:background-color .12s,color .12s,box-shadow .12s}",
			".dsh-restart-float:hover{background:var(--dsw-alias-interactive-bg-hover,#2a2e3a);color:var(--dsw-alias-label-primary,#e8e8e8)}",
			".dsh-restart-float:active{background:var(--dsw-alias-interactive-bg-active,#23262f)}",
			".dsh-restart-float:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#1b1e27),0 0 0 4px var(--dsw-alias-brand-primary,#4d6bfe);outline:none}",
			".dsh-restart-float svg{pointer-events:none}"
		].join("");

		function ensureCss() {
			var style = document.getElementById("dsh-restart-button-css");
			if (style === null) {
				style = document.createElement("style");
				style.id = "dsh-restart-button-css";
				style.textContent = CSS;
				document.head.appendChild(style);
			}
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

		function apply(ctx) {
			// Defer a tick so the desktop-launcher shutdown button is already in
			// the DOM and our button can be positioned relative to it.
			var host = document.createElement("div");
			host.dataset.dshRestartFloat = "true";
			document.body.appendChild(host);
			ensureCss();

			var btn = document.createElement("button");
			btn.type = "button";
			btn.className = "dsh-restart-float";
			btn.title = "重启 DeepSeek Harness";
			btn.setAttribute("aria-label", "重启 DeepSeek Harness");
			btn.appendChild(restartIcon(20));
			btn.addEventListener("click", async function () {
				if (btn.disabled) return;
				// One-click confirm gate: ask before restarting, like the shutdown button.
				var ok = window.confirm("确定要重启 DeepSeek Harness 吗？\n\n重启会短暂关闭 dsh web，然后自动重新拉起并打开浏览器。");
				if (!ok) return;
				btn.disabled = true;
				btn.setAttribute("disabled", "disabled");
				try {
					var response = await fetch("/api/dsh-restart/restart", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: "{}"
					});
					if (!response.ok) throw new Error("HTTP " + String(response.status));
					// Host exits shortly; the page will drop. Nothing else to do.
				} catch (err) {
					btn.disabled = false;
					btn.removeAttribute("disabled");
					window.alert("重启请求失败：" + (err instanceof Error ? err.message : String(err)));
				}
			});
			host.appendChild(btn);

			return function dispose() {
				if (btn.parentNode !== null) btn.parentNode.removeChild(btn);
				if (host.parentNode !== null) host.parentNode.removeChild(host);
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
