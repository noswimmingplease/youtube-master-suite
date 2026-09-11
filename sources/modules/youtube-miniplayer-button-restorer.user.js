// ==UserScript==
// @name         YouTube Miniplayer Button Restorer
// @namespace    Citizen.youtube.miniplayer-button-restorer
// @version      1.7
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

  let observing = false;
  let installedButton = null;

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
    if (playerFlexy?.isConnected) return playerFlexy;

    const placeholderFlexy = document
      .querySelector("#ytsmp-player-placeholder")
      ?.closest?.("ytd-watch-flexy");
    if (placeholderFlexy?.isConnected) return placeholderFlexy;

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
    if (clickNativeMiniplayerIfPresent()) return;
    synthKeyToPlayer("i", "KeyI");
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
    btn.title = "Miniplayer (i)";
    btn.setAttribute("aria-label", "Miniplayer");
    btn.setAttribute("aria-keyshortcuts", "i");
    btn.appendChild(buildIcon());
    btn.addEventListener("click", triggerMiniplayer);
    return btn;
  }

  function removeButton() {
    const btn = installedButton?.isConnected
      ? installedButton
      : document.getElementById(BTN_ID);
    if (btn) btn.remove();
    installedButton = null;
  }

  function isButtonInstalled() {
    const button = installedButton;
    if (!button?.isConnected) return false;

    const controls = button.parentElement;
    const player = getPlayerEl();
    return Boolean(
      player &&
      controls?.matches(RIGHT_CONTROLS_SELECTOR) &&
      player.contains(controls)
    );
  }

  function installOnce() {
    if (!isEligiblePath()) {
      removeButton();
      return true;
    }

    const controls = getRightControls();
    if (!controls) return false;

    const existing = document.getElementById(BTN_ID);
    if (existing && existing.parentElement === controls) {
      installedButton = existing;
      return true;
    }

    const fullscreenBtn = controls.querySelector(FULLSCREEN_BUTTON_SELECTOR);
    const btn = existing || makeButton();

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

  const mo = new MutationObserver((muts) => {
    if (isButtonInstalled()) return;

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
    if (!observing) return;

    mo.disconnect();
    observing = false;
  }

  function onNavigate() {
    if (!isEligiblePath()) {
      clearInstallAttempts();
      stopObserve();
      clearPoll();
      removeButton();
      return;
    }

    beginObserve();
    scheduleInstallAttempts(CONFIG.navRetryDelays);
  }

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
