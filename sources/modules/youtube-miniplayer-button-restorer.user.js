// ==UserScript==
// @name         YouTube Miniplayer Button Restorer
// @namespace    Citizen.youtube.miniplayer-button-restorer
// @version      1.14
// @description  Restores a Miniplayer button to YouTube watch and live player controls, falling back to the native miniplayer shortcut when needed.
// @author       Citizen
// @homepageURL  https://github.com/noswimmingplease/youtube-miniplayer-button-restorer
// @supportURL   https://github.com/noswimmingplease/youtube-miniplayer-button-restorer/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-miniplayer-button-restorer/main/youtube-miniplayer-button-restorer.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-miniplayer-button-restorer/main/youtube-miniplayer-button-restorer.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const BTN_ID = "tmk-miniplayer-button";
  const TOOLTIP_ID = "tmk-miniplayer-tooltip";
  const STYLE_ID = "tmk-miniplayer-style";
  const CONFIG = {
    iconPx: 36,
    pollInterval: 250,
    pollMaxMs: 20000,
    navRetryDelays: [300, 900, 1800, 3500],
  };

  const PLAYER_SELECTORS = ["#movie_player", ".html5-video-player"];
  const RIGHT_CONTROLS_SELECTOR = ".ytp-right-controls";
  const NATIVE_MINIPLAYER_BUTTON_SELECTOR = ".ytp-miniplayer-button";
  const FULLSCREEN_BUTTON_SELECTOR = ".ytp-fullscreen-button";
  const CONTROL_STATE_ATTRIBUTES = [
    "aria-disabled", "aria-hidden", "class", "disabled", "hidden", "style",
  ];
  const WATCH_STATE_ATTRIBUTES = [...CONTROL_STATE_ATTRIBUTES, "video-id"];
  const PLAYER_CONTROL_SELECTOR = [...PLAYER_SELECTORS, RIGHT_CONTROLS_SELECTOR].join(",");
  const PLAYER_TOPOLOGY_SELECTOR = [
    PLAYER_CONTROL_SELECTOR,
    "ytd-watch-flexy", "#ytsmp-player-placeholder",
  ].join(",");

  let observing = false;
  let installedButton = null;
  let tooltip = null;
  let tooltipPlayer = null;
  let tooltipPlayerParent = null;
  let tooltipButtonParent = null;
  let observedControls = null;
  let observedControlTargets = [];

  function isEligiblePath() {
    const p = location.pathname;
    if (p.startsWith("/shorts")) return false;
    return p === "/watch" || p.startsWith("/live/");
  }

  function getRouteKey() {
    return `${location.pathname}${location.search}`;
  }

  function buildCss() {
    const iconPx = CONFIG.iconPx;

    return `
      #${BTN_ID}.ytp-button{
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        padding:0 !important;
        margin:0 !important;
        line-height:0 !important;
      }

      .html5-video-player #${BTN_ID}.ytp-button svg,
      #movie_player #${BTN_ID}.ytp-button svg,
      ytd-player #${BTN_ID}.ytp-button svg{
        width:${iconPx}px !important;
        height:${iconPx}px !important;
        min-width:${iconPx}px !important;
        min-height:${iconPx}px !important;
        max-width:${iconPx}px !important;
        max-height:${iconPx}px !important;
        display:block !important;
        overflow:visible !important;
        pointer-events:none !important;
        shape-rendering:geometricPrecision !important;
      }

      #${TOOLTIP_ID}{
        position:absolute !important;
        z-index:1000 !important;
        display:flex !important;
        align-items:center !important;
        gap:4px !important;
        box-sizing:border-box !important;
        max-width:calc(100% - 16px) !important;
        padding:5px 9px !important;
        border-radius:2px !important;
        background:rgba(0, 0, 0, 0.9) !important;
        color:#eee !important;
        font:500 12px/1.2 Roboto, Arial, sans-serif !important;
        text-shadow:none !important;
        pointer-events:none !important;
      }
      #${TOOLTIP_ID} kbd{
        flex:0 0 auto !important;
        box-sizing:border-box !important;
        min-width:14px !important;
        height:16px !important;
        padding:0 2px !important;
        border:1px solid #555 !important;
        border-radius:3px !important;
        background:transparent !important;
        color:inherit !important;
        font:400 12px/14px Roboto, Arial, sans-serif !important;
        text-align:center !important;
      }
    `;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();
    (document.head || document.documentElement).appendChild(style);
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function isRenderedWatchFlexy(flexy) {
    if (
      !flexy?.isConnected ||
      flexy.hidden ||
      flexy.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    try {
      const style = getComputedStyle(flexy);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return false;
      }
    } catch {
      return false;
    }

    return (
      typeof flexy.getClientRects !== "function" ||
      flexy.getClientRects().length > 0
    );
  }

  function getActiveWatchFlexy() {
    const playerFlexy = document
      .querySelector("#movie_player")
      ?.closest?.("ytd-watch-flexy");
    if (isRenderedWatchFlexy(playerFlexy)) return playerFlexy;

    const placeholderFlexy = document
      .querySelector("#ytsmp-player-placeholder")
      ?.closest?.("ytd-watch-flexy");
    if (isRenderedWatchFlexy(placeholderFlexy)) return placeholderFlexy;

    const flexies = Array.from(document.querySelectorAll("ytd-watch-flexy"));
    return (
      flexies.find(isRenderedWatchFlexy) ||
      flexies.find((flexy) => flexy.isConnected) ||
      null
    );
  }

  function getPlayerEl() {
    const floatedPlayer = document.body?.classList.contains(
      "ytsmp-scroll-miniplayer-active",
    )
      ? Array.from(document.body.children).find((child) =>
          PLAYER_SELECTORS.some((selector) => child.matches?.(selector)),
        )
      : null;
    if (floatedPlayer) return floatedPlayer;

    const activeFlexy = getActiveWatchFlexy();
    return (
      (activeFlexy && queryFirst(PLAYER_SELECTORS, activeFlexy)) ||
      queryFirst(PLAYER_SELECTORS)
    );
  }

  function getRightControls() {
    const roots = [getPlayerEl(), document.querySelector("ytd-player"), document].filter(Boolean);
    for (const r of roots) {
      const c = r.querySelector(RIGHT_CONTROLS_SELECTOR);
      if (c) return c;
    }
    return null;
  }

  function clickNativeMiniplayerIfPresent() {
    const player = getPlayerEl();
    if (!player) return false;

    const nativeBtn = Array.from(player.querySelectorAll(NATIVE_MINIPLAYER_BUTTON_SELECTOR))
      .find((btn) => (
        btn.id !== BTN_ID &&
        !btn.disabled &&
        btn.getAttribute("aria-disabled") !== "true"
      ));

    if (nativeBtn) {
      nativeBtn.click();
      return true;
    }
    return false;
  }

  function hasUsableNativeMiniplayer(controls) {
    // Autohide affects the whole toolbar. Only a separately suppressed native
    // control needs restoring; do not replace it merely while controls fade out.
    const toolbarVisibility = getComputedStyle(controls).visibility;
    return Array.from(controls.querySelectorAll(NATIVE_MINIPLAYER_BUTTON_SELECTOR))
      .some((button) => {
        if (
          button.id === BTN_ID || button.disabled ||
          button.getAttribute("aria-disabled") === "true"
        ) return false;

        for (let element = button; element && element !== controls; element = element.parentElement) {
          if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
          const style = getComputedStyle(element);
          if (
            style.display === "none" ||
            Number(style.opacity) === 0 ||
            ((style.visibility === "hidden" || style.visibility === "collapse") &&
              style.visibility !== toolbarVisibility)
          ) return false;
        }
        return true;
      });
  }

  function synthKeyToPlayer(key = "i", code = "KeyI") {
    const player = getPlayerEl();
    if (!player) return false;

    try { player.focus(); } catch {}

    const init = {
      key, code, keyCode: 73, which: 73,
      bubbles: true, cancelable: true, composed: true
    };

    const ok1 = player.dispatchEvent(new KeyboardEvent("keydown", init));
    const ok2 = player.dispatchEvent(new KeyboardEvent("keyup", init));

    return ok1 || ok2;
  }

  function triggerMiniplayer() {
    hideTooltip();
    if (clickNativeMiniplayerIfPresent()) return;
    synthKeyToPlayer("i", "KeyI");
  }

  function hideTooltip() {
    document.removeEventListener("pointermove", onTooltipPointerMove, true);
    document.removeEventListener("pointerdown", hideTooltip, true);
    document.removeEventListener("pointercancel", hideTooltip, true);
    document.removeEventListener("scroll", hideTooltip, true);
    document.removeEventListener("visibilitychange", hideTooltip);
    tooltip?.remove();
    tooltip = null;
    tooltipPlayer = null;
    tooltipPlayerParent = null;
    tooltipButtonParent = null;
    installedButton?.removeAttribute("aria-describedby");
  }

  function onTooltipPointerMove(event) {
    if (!installedButton?.contains(event.target)) hideTooltip();
  }

  function isTooltipAnchorVisible(player) {
    if (
      document.visibilityState === "hidden" || !isEligiblePath() ||
      installedButton?.disabled || installedButton?.getAttribute("aria-disabled") === "true" ||
      !isRenderedWatchFlexy(player) || !isRenderedWatchFlexy(installedButton) ||
      !player.contains(installedButton) ||
      player.classList.contains("ytp-autohide") ||
      player.closest("ytd-miniplayer, ytd-video-preview, ytd-reel-video-renderer")
    ) return false;

    // The toolbar can fade independently of the button. Reuse the existing
    // control observer to dismiss the tooltip when any control ancestor hides.
    for (let element = installedButton; element; element = element.parentElement) {
      if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(element);
      if (
        style.display === "none" || Number(style.opacity) === 0 ||
        style.visibility === "hidden" || style.visibility === "collapse"
      ) return false;
      if (element === player) break;
    }
    return true;
  }

  function positionTooltip() {
    if (!tooltip) return;
    const playerRect = tooltipPlayer.getBoundingClientRect();
    const buttonRect = installedButton.getBoundingClientRect();
    if (!playerRect.width || !playerRect.height || !buttonRect.width || !buttonRect.height) {
      hideTooltip();
      return;
    }
    const width = tooltipPlayer.offsetWidth || playerRect.width;
    const height = tooltipPlayer.offsetHeight || playerRect.height;
    const scaleX = playerRect.width / width;
    const scaleY = playerRect.height / height;
    const left = (buttonRect.left + buttonRect.width / 2 - playerRect.left) / scaleX -
      tooltip.offsetWidth / 2;
    const progress = tooltipPlayer.querySelector(".ytp-progress-bar-container");
    const progressRect = isRenderedWatchFlexy(progress) ? progress.getBoundingClientRect() : null;
    const progressAboveControls = progressRect?.width > 0 && progressRect.height > 0 &&
      progressRect.top >= playerRect.top && progressRect.bottom <= buttonRect.top + 1 &&
      progressRect.left >= playerRect.left - 1 && progressRect.right <= playerRect.right + 1;
    // Match the mirror tooltip's seek-bar clearance, including scaled players.
    const tooltipBottom = progressAboveControls
      ? (progressRect.top - playerRect.top) / scaleY - 8
      : (buttonRect.top - playerRect.top) / scaleY - 20;
    const nextLeft = `${Math.round(Math.max(8, Math.min(left, width - tooltip.offsetWidth - 8)))}px`;
    const nextTop = `${Math.round(Math.max(8, tooltipBottom - tooltip.offsetHeight))}px`;
    if (tooltip.style.left !== nextLeft) tooltip.style.left = nextLeft;
    if (tooltip.style.top !== nextTop) tooltip.style.top = nextTop;
  }

  function showTooltip(event) {
    hideTooltipForMutations([]);
    if (event.currentTarget !== installedButton || !isEligiblePath()) return;
    if (event.type === "focus" && !installedButton.matches(":focus-visible")) return;
    const player = getPlayerEl();
    if (!isTooltipAnchorVisible(player)) return;
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = TOOLTIP_ID;
      tooltip.setAttribute("role", "tooltip");
      const label = document.createElement("span");
      label.textContent = "Miniplayer";
      const key = document.createElement("kbd");
      key.textContent = "I";
      tooltip.appendChild(label);
      tooltip.appendChild(key);
      tooltipPlayer = player;
      tooltipPlayerParent = player.parentElement;
      tooltipButtonParent = installedButton.parentElement;
      player.appendChild(tooltip);
      installedButton.setAttribute("aria-describedby", TOOLTIP_ID);
      // Catch missed mouseleave events when the player or controls move. These
      // listeners exist only for a visible tooltip, with no background polling.
      document.addEventListener("pointermove", onTooltipPointerMove, true);
      document.addEventListener("pointerdown", hideTooltip, true);
      document.addEventListener("pointercancel", hideTooltip, true);
      document.addEventListener("scroll", hideTooltip, true);
      document.addEventListener("visibilitychange", hideTooltip);
    }
    positionTooltip();
  }

  function hideTooltipForMutations(mutations) {
    if (!tooltip) return;
    if (
      !isTooltipAnchorVisible(tooltipPlayer) || getPlayerEl() !== tooltipPlayer ||
      !tooltipPlayer.contains(installedButton) || tooltip.parentElement !== tooltipPlayer ||
      tooltipPlayer.parentElement !== tooltipPlayerParent ||
      installedButton.parentElement !== tooltipButtonParent ||
      mutations.some((mutation) => Array.from(mutation.removedNodes || []).some((node) =>
        node === tooltip || node.contains?.(installedButton) || node.contains?.(tooltipPlayer),
      ))
    ) hideTooltip();
  }

  function onTooltipResize() {
    hideTooltipForMutations([]);
    if (!tooltip) return;
    if (
      !installedButton.matches(":hover") &&
      !(document.activeElement === installedButton && installedButton.matches(":focus-visible"))
    ) {
      hideTooltip();
      return;
    }
    positionTooltip();
  }

  function buildIcon() {
    const SVG_NS = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("aria-hidden", "true");

    function roundedRectPath(x, y, w, h, r) {
      const x2 = x + w;
      const y2 = y + h;
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      return [
        `M ${x + rr} ${y}`,
        `H ${x2 - rr}`,
        `A ${rr} ${rr} 0 0 1 ${x2} ${y + rr}`,
        `V ${y2 - rr}`,
        `A ${rr} ${rr} 0 0 1 ${x2 - rr} ${y2}`,
        `H ${x + rr}`,
        `A ${rr} ${rr} 0 0 1 ${x} ${y2 - rr}`,
        `V ${y + rr}`,
        `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
        "Z"
      ].join(" ");
    }

    // Screen outline as a filled ring. Keeping this as fill paths lets YouTube's
    // existing .ytp-svg-fill/.ytp-svg-shadow styling handle hover and contrast.
    const outer = roundedRectPath(5.5, 9.5, 25, 17, 2.2);
    const inner = roundedRectPath(8, 12, 20, 12, 1.2);
    const borderD = `${outer} ${inner}`;

    const miniD = roundedRectPath(17, 17, 11, 7, 1.1);

    function makePath(cls, d, evenodd = false) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("class", cls);
      p.setAttribute("d", d);
      if (evenodd) {
        p.setAttribute("fill-rule", "evenodd");
        p.setAttribute("clip-rule", "evenodd");
      }
      return p;
    }

    // Shadow + fill (native icon pattern)
    svg.appendChild(makePath("ytp-svg-shadow", borderD, true));
    svg.appendChild(makePath("ytp-svg-fill", borderD, true));
    svg.appendChild(makePath("ytp-svg-shadow", miniD, false));
    svg.appendChild(makePath("ytp-svg-fill", miniD, false));

    return svg;
  }

  function makeButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.className = "ytp-button";
    btn.setAttribute("aria-label", "Miniplayer");
    btn.setAttribute("aria-keyshortcuts", "i");
    btn.appendChild(buildIcon());
    btn.addEventListener("click", triggerMiniplayer);
    btn.addEventListener("mouseenter", showTooltip);
    btn.addEventListener("focus", showTooltip);
    btn.addEventListener("mouseleave", hideTooltip);
    btn.addEventListener("blur", hideTooltip);
    return btn;
  }

  function removeButton() {
    hideTooltip();
    const btn = installedButton?.isConnected
      ? installedButton
      : document.getElementById(BTN_ID);
    if (btn) btn.remove();
    installedButton = null;
  }

  function stopControlObservation() {
    hideTooltip();
    controlObserver.disconnect();
    observedControls = null;
    observedControlTargets = [];
  }

  function syncControlObservation(controls) {
    const targets = [];
    const player = getPlayerEl();
    for (let element = controls; element; element = element.parentElement) {
      targets.push(element);
      if (element === player) break;
    }
    const watchRoot = player?.closest?.("ytd-watch-flexy") || document
      .querySelector("#ytsmp-player-placeholder")?.closest?.("ytd-watch-flexy");
    if (watchRoot && !targets.includes(watchRoot)) targets.push(watchRoot);
    if (
      observedControls === controls &&
      targets.length === observedControlTargets.length &&
      targets.every((target, index) => target === observedControlTargets[index])
    ) return;

    const registrations = targets.map((target) => [target, {
      attributes: true,
      attributeFilter: target === watchRoot ? WATCH_STATE_ATTRIBUTES : CONTROL_STATE_ATTRIBUTES,
      childList: target === controls,
      subtree: target === controls,
    }]);
    if (typeof controlObserver.replaceRegistrations === "function") {
      controlObserver.replaceRegistrations(registrations);
    } else {
      controlObserver.disconnect();
      registrations.forEach(([target, options]) => controlObserver.observe(target, options));
    }
    observedControls = controls;
    observedControlTargets = targets;
  }

  function installOnce() {
    if (!isEligiblePath()) {
      stopControlObservation();
      removeButton();
      return true;
    }

    const controls = getRightControls();
    if (!controls) {
      stopControlObservation();
      return false;
    }
    syncControlObservation(controls);
    if (hasUsableNativeMiniplayer(controls)) {
      removeButton();
      return true;
    }

    const existing = document.getElementById(BTN_ID);
    if (existing && existing.parentElement === controls) {
      installedButton = existing;
      return true;
    }

    const fullscreenBtn = controls.querySelector(FULLSCREEN_BUTTON_SELECTOR);
    const btn = existing || makeButton();
    hideTooltip();

    if (fullscreenBtn && fullscreenBtn.parentElement === controls) {
      controls.insertBefore(btn, fullscreenBtn);
    } else {
      controls.appendChild(btn);
    }
    installedButton = btn;
    return true;
  }

  let pollTimer = 0;
  let installAttemptRoute = "";
  const installAttemptTimers = new Set();

  function clearInstallAttempts() {
    installAttemptTimers.forEach((timer) => clearTimeout(timer));
    installAttemptTimers.clear();
    installAttemptRoute = "";
  }

  function clearPoll() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = 0;
  }

  function pollUntilInstalled(maxMs = CONFIG.pollMaxMs) {
    if (pollTimer) return;

    const start = Date.now();
    pollTimer = setInterval(() => {
      if (installOnce()) {
        clearPoll();
        return;
      }
      if (Date.now() - start > maxMs) clearPoll();
    }, CONFIG.pollInterval);
  }

  let debTimer = 0;
  function runInstall() {
    clearTimeout(debTimer);
    debTimer = 0;
    ensureStyles();
    if (installOnce()) {
      clearPoll();
      clearInstallAttempts();
      return;
    }
    pollUntilInstalled();
  }

  function debounceInstall(delay = 300) {
    clearTimeout(debTimer);
    debTimer = setTimeout(runInstall, delay);
  }

  function scheduleInstallAttempts(delays) {
    const routeKey = getRouteKey();
    if (routeKey === installAttemptRoute && installAttemptTimers.size) return;

    clearInstallAttempts();
    installAttemptRoute = routeKey;

    delays.forEach((delay) => {
      const timer = setTimeout(() => {
        installAttemptTimers.delete(timer);
        if (getRouteKey() !== routeKey) {
          clearInstallAttempts();
          return;
        }
        runInstall();
        if (!installAttemptTimers.size && installAttemptRoute === routeKey) {
          installAttemptRoute = "";
        }
      }, delay);
      installAttemptTimers.add(timer);
    });
  }

  const controlObserver = new MutationObserver((mutations) => {
    hideTooltipForMutations(mutations);
    if (isEligiblePath()) debounceInstall(150);
  });

  function isCommentContentMutation(mutation) {
    const target = mutation.target?.closest
      ? mutation.target
      : mutation.target?.parentElement;
    if (
      mutation.type !== "childList" || !target?.closest?.("ytd-comments") ||
      target.closest(PLAYER_CONTROL_SELECTOR)
    ) return false;

    return [...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
      !node.matches?.(PLAYER_TOPOLOGY_SELECTOR) &&
      !node.querySelector?.(PLAYER_TOPOLOGY_SELECTOR),
    );
  }

  function isSuiteDialogContentMutation(mutation) {
    if (mutation.type !== "childList") return false;
    const target = mutation.target?.closest ? mutation.target : mutation.target?.parentElement;
    const dialog = target?.closest?.("dialog");
    if (
      typeof HTMLDialogElement !== "function" || !(dialog instanceof HTMLDialogElement) ||
      !dialog.isConnected || dialog.parentElement !== document.body ||
      !["ytms-settings-dialog", "ytms-age-dialog"].includes(dialog.id) ||
      target.closest(PLAYER_TOPOLOGY_SELECTOR)
    ) return false;

    return [...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
      !node.matches?.(PLAYER_TOPOLOGY_SELECTOR) &&
      !node.querySelector?.(PLAYER_TOPOLOGY_SELECTOR),
    );
  }

  const mo = new MutationObserver((muts) => {
    hideTooltipForMutations(muts);
    // These native dialogues contain only Suite controls, not the watch player.
    // Their mounting/removal and any mixed/native topology batch still fall through.
    if (muts.length && muts.every(isSuiteDialogContentMutation)) return;
    // Ordinary comment updates cannot replace the installed toolbar. Keep the
    // existing discovery path for unknown/structural batches and detached owners.
    if (observedControls?.isConnected && muts.length && muts.every(isCommentContentMutation)) return;
    // The narrow observer owns changes inside the current toolbar. This broad
    // child-list observer only discovers its initial creation or replacement.
    if (observedControls?.isConnected && getPlayerEl()?.contains(observedControls)) return;

    for (const m of muts) {
      if (
        (m.addedNodes && m.addedNodes.length) ||
        (m.removedNodes && m.removedNodes.length)
      ) {
        debounceInstall(150);
        break;
      }
    }
  });

  function beginObserve() {
    if (observing || !isEligiblePath()) return;

    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
      observing = true;
    } catch {}
  }

  function stopObserve() {
    stopControlObservation();
    if (!observing) return;

    mo.disconnect();
    observing = false;
  }

  function onNavigate() {
    hideTooltip();
    if (!isEligiblePath()) {
      clearTimeout(debTimer);
      debTimer = 0;
      clearInstallAttempts();
      stopObserve();
      clearPoll();
      removeButton();
      return;
    }

    beginObserve();
    scheduleInstallAttempts(CONFIG.navRetryDelays);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTooltip();
  });
  document.addEventListener("fullscreenchange", hideTooltip, true);
  window.addEventListener("blur", hideTooltip, true);
  window.addEventListener("resize", onTooltipResize, true);
  window.addEventListener("yt-navigate-start", hideTooltip);
  window.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("yt-page-data-updated", onNavigate);
  window.addEventListener("pagehide", () => {
    clearTimeout(debTimer);
    debTimer = 0;
    clearInstallAttempts();
    clearPoll();
    stopObserve();
  });
  window.addEventListener("pageshow", onNavigate);

  ensureStyles();
  runInstall();
  beginObserve();
})();
