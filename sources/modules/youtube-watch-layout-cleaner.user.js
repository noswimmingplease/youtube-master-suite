// ==UserScript==
// @name         YouTube Watch Layout Cleaner
// @namespace    Citizen.youtube.watch-layout-cleaner
// @version      1.61
// @description  Expands YouTube watch pages, keeps the right rail fixed at SponsorBlock-friendly width, preserves its visible popup, and widens metadata/comments.
// @author       Citizen
// @homepageURL  https://github.com/noswimmingplease/youtube-watch-layout-cleaner
// @supportURL   https://github.com/noswimmingplease/youtube-watch-layout-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-watch-layout-cleaner/main/youtube-watch-layout-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-watch-layout-cleaner/main/youtube-watch-layout-cleaner.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    sidebarWidthPx: 374,
    queueLayoutBreakpointPx: 1000,
    relatedVideosHideBreakpointPx: 1400,
    showDeArrowQueueButton: true,
  };

  const STYLE_ID = "tm-youtube-watch-layout-cleaner";
  const PLAYLIST_PANEL_SELECTORS = [
    "ytd-playlist-panel-renderer",
    "yt-playlist-panel-renderer",
  ];
  const PLAYLIST_PANEL_SELECTOR = PLAYLIST_PANEL_SELECTORS.join(",");
  const QUEUE_THUMBNAIL_FALLBACK_DELAYS_MS = [750, 1500];
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer",
    "yt-playlist-panel-video-renderer",
  ].join(",");
  const QUEUE_THUMBNAIL_TARGET_SELECTOR = [
    "a#thumbnail",
    "ytd-thumbnail",
    "yt-thumbnail-view-model",
    ".ytThumbnailViewModelHost",
  ].join(",");
  const QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE =
    "data-ywlc-thumbnail-fallback";
  const QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY =
    "--ywlc-thumbnail-fallback-image";
  const QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN = "200px 0px";
  const QUEUE_THUMBNAIL_FALLBACK_STYLE_SELECTOR = PLAYLIST_PANEL_SELECTORS.map(
    (panelSelector) =>
      `${panelSelector} [${QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE}="1"]`,
  ).join(",\n");
  const EMPTY_SECONDARY_RAIL_ATTRIBUTE = "data-ywlc-empty-secondary-rail";
  const MANAGED_LIVE_CHAT_ATTRIBUTE = "data-ywlc-managed-chat";
  const AUXILIARY_RAIL_SURFACE_SELECTOR = [
    "#sponsorBlockPopupContainer",
    "#sponsorBlockPopupContainer iframe",
  ].join(",");
  const CHAT_SURFACE_SELECTOR = [
    "ytd-live-chat-frame#chat",
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-live-chat"]',
    "ytd-engagement-panel-section-list-renderer:has(yt-live-chat-app)",
  ].join(",");
  const ENGAGEMENT_PANEL_SELECTOR =
    "ytd-engagement-panel-section-list-renderer";
  const RAIL_MUTATION_TARGET_SELECTOR = [
    PLAYLIST_PANEL_SELECTOR,
    CHAT_SURFACE_SELECTOR,
    ENGAGEMENT_PANEL_SELECTOR,
    "#chat-container",
    "#panels",
    "#related",
    "#secondary",
    "#secondary-inner",
    AUXILIARY_RAIL_SURFACE_SELECTOR,
  ].join(",");
  const QUEUE_ITEM_MUTATION_ATTRIBUTES = [
    "aria-current",
    "aria-selected",
    "href",
    "selected",
    "src",
  ];
  const SURFACE_STATE_MUTATION_ATTRIBUTES = [
    "aria-current",
    "aria-hidden",
    "aria-selected",
    "class",
    "collapsed",
    "hidden",
    "selected",
    "style",
    "visibility",
    "data-ytppl-live-chat-panel",
  ];
  const DISCOVERY_MUTATION_ATTRIBUTES = [
    ...new Set([
      ...QUEUE_ITEM_MUTATION_ATTRIBUTES,
      ...SURFACE_STATE_MUTATION_ATTRIBUTES,
    ]),
  ];
  const PANEL_MUTATION_ATTRIBUTES = DISCOVERY_MUTATION_ATTRIBUTES;
  const WATCH_FLEXY_SELECTORS = [
    "ytd-watch-flexy[flexy]",
    "ytd-watch-flexy[flexy_]",
    "ytd-watch-flexy[is-two-columns]",
    "ytd-watch-flexy[is-two-columns_]",
    "ytd-watch-flexy[theater]",
    "ytd-watch-flexy[theatre]",
    "ytd-watch-flexy[is-watch-wide]",
  ];
  const WATCH_FLEXY_SELECTOR = WATCH_FLEXY_SELECTORS.join(",\n");
  const TWO_COLUMN_WATCH_FLEXY_SELECTORS = [
    "ytd-watch-flexy[is-two-columns]",
    "ytd-watch-flexy[is-two-columns_]",
  ];
  const TWO_COLUMN_WATCH_FLEXY_SELECTOR =
    TWO_COLUMN_WATCH_FLEXY_SELECTORS.join(",\n");
  const EMPTY_SECONDARY_RAIL_SELECTOR =
    TWO_COLUMN_WATCH_FLEXY_SELECTORS.map(
      (watchSelector) =>
        `${watchSelector}[${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"]:not([${MANAGED_LIVE_CHAT_ATTRIBUTE}="open"])`,
    ).join(",\n");
  let queueThumbnailFallbackTimers = [];
  let queueThumbnailFallbackObserver = null;
  let observedRailMutationTargets = new Set();
  let queueThumbnailMutationFrame = 0;
  let railStateReconciliationFrame = 0;
  const pendingQueueThumbnailItems = new Set();

  function px(value) {
    return `${value}px`;
  }

  function watchFlexyChildSelector(...childSelectors) {
    return WATCH_FLEXY_SELECTORS.flatMap((watchSelector) =>
      childSelectors.map(
        (childSelector) => `${watchSelector} ${childSelector}`,
      ),
    ).join(",\n");
  }

  function buildQueueCompatibilityCss() {
    const titleParentSelector =
      ":is(ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer) " +
      ":has(> #video-title.cbCustomTitle)";
    if (!CONFIG.showDeArrowQueueButton) {
      return `
/* Hide only DeArrow's original-title button in queue rows, not its replacements. */
${titleParentSelector} > .cbShowOriginal {
  display: none !important;
}
`;
    }

    return `
/* Reserve the slot before DeArrow inserts its button so hover cannot reflow titles.
   Keep DeArrow's original/custom title and button visibility rules untouched. */
${titleParentSelector} {
  position: relative !important;
  box-sizing: border-box !important;
  padding-inline-end: 25px !important;
}

${titleParentSelector} > .cbShowOriginal {
  position: absolute !important;
  inset-inline-end: 0 !important;
  top: 0 !important;
  width: 20px !important;
  height: 20px !important;
  max-width: 20px !important;
  max-height: 20px !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
}
`;
  }

  function buildCss() {
    return `
/* Watch pages only. Keeps the right rail while allowing the player column to use wide screens. */
${WATCH_FLEXY_SELECTOR}{
  --ytd-watch-flexy-max-player-width: none !important;
  --ytd-watch-flexy-max-player-width-wide-screen: none !important;
}

@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {
  ${TWO_COLUMN_WATCH_FLEXY_SELECTOR}{
    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;
  }
}

/* Preserve the native video/chat reservation while managed chat is open. */
@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {
  ${EMPTY_SECONDARY_RAIL_SELECTOR}{
    --ytd-watch-flexy-sidebar-width: 0px !important;
  }
}

/* YouTube shares its sidebar variable between the video and lower content.
   Capture the native reserve before zeroing only the otherwise-empty columns. */
ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}="open"] {
  --ywlc-live-chat-reserve: var(--ytd-watch-flexy-sidebar-width, ${px(CONFIG.sidebarWidthPx)}) !important;
}

ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}][${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"] #columns.ytd-watch-flexy {
  --ytd-watch-flexy-sidebar-width: 0px !important;
}

/* Explicitly hiding chat must release video space even when a real queue or
   SponsorBlock widget still needs its separate, below-video rail. */
ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}="hidden"] #full-bleed-container,
ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}="hidden"] #columns #primary #player.ytd-watch-flexy,
ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}="open"] #columns #primary #player.ytd-watch-flexy {
  --ytd-watch-flexy-sidebar-width: 0px !important;
}

/* Legacy/default view nests the video inside the full-width primary column.
   Reserve once on its wrapper, never on the player or video element itself. */
@media (min-width: 768px) {
  :root:not(:fullscreen) ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}="open"][${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"] #columns #primary #player.ytd-watch-flexy {
    width: calc(100% - var(--ywlc-live-chat-reserve, ${px(CONFIG.sidebarWidthPx)})) !important;
  }
}

/* Retain the existing responsive overlay when both panes cannot fit. */
@media (max-width: 767px) {
  ytd-watch-flexy[${MANAGED_LIVE_CHAT_ATTRIBUTE}="open"] {
    --ytd-watch-flexy-sidebar-width: 0px !important;
  }
}

${watchFlexyChildSelector("#columns.ytd-watch-flexy")}{
  max-width: none !important;
  box-sizing: border-box !important;
}

${watchFlexyChildSelector("#primary.ytd-watch-flexy")}{
  flex: 1 1 auto !important;
  min-width: 0 !important;
  max-width: none !important;
}

${watchFlexyChildSelector(
  "#primary-inner.ytd-watch-flexy",
  "#above-the-fold",
  "#description",
  "#top-row",
  "#player.ytd-watch-flexy",
  "#player-container-outer.ytd-watch-flexy",
)}{
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: none !important;
}

ytd-comments #sections {
  margin-right: 0 !important;
}

ytd-comments,
ytd-comments ytd-item-section-renderer,
ytd-comments ytd-comment-thread-renderer {
  max-width: 100% !important;
}

${QUEUE_THUMBNAIL_FALLBACK_STYLE_SELECTOR} {
  background-image: var(${QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY}) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
}

/* Leave only comments below the video once YouTube switches to its narrow layout. */
@media (max-width: ${px(CONFIG.relatedVideosHideBreakpointPx)}) {
  #related {
    display: none !important;
  }
}

${buildQueueCompatibilityCss()}
`;
  }

  function isWatchPath() {
    return location.pathname === "/watch" || location.pathname.startsWith("/live/");
  }

  function ensureStyle() {
    const css = isWatchPath() ? buildCss() : buildQueueCompatibilityCss();
    if (!css) {
      removeStyle();
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    if (style.textContent !== css) style.textContent = css;
  }

  function removeStyle() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function getQueueItemVideoId(item) {
    const links = item.querySelectorAll('a[href*="/watch"]');

    for (const link of links) {
      let videoId = "";
      try {
        videoId = new URL(link.href || link.getAttribute("href"), location.origin)
          .searchParams.get("v") || "";
      } catch {
        continue;
      }

      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return videoId;
    }

    return "";
  }

  function hasLoadedQueueThumbnail(item) {
    return Array.from(item.querySelectorAll("img")).some((image) => {
      if (!image.complete || image.naturalWidth <= 0) return false;

      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0
      );
    });
  }

  function clearQueueThumbnailFallback(item) {
    item.querySelectorAll(
      `[${QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE}="1"]`,
    ).forEach((target) => {
      target.removeAttribute(QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE);
      target.style.removeProperty(QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY);
    });
  }

  function applyQueueThumbnailFallback(item) {
    if (hasLoadedQueueThumbnail(item)) {
      clearQueueThumbnailFallback(item);
      return;
    }

    const videoId = getQueueItemVideoId(item);
    if (!videoId) return;

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    item.querySelectorAll(QUEUE_THUMBNAIL_TARGET_SELECTOR).forEach(
      (target) => {
        target.setAttribute(QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE, "1");
        target.style.setProperty(
          QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY,
          `url("${thumbnailUrl}")`,
        );
      },
    );
  }

  function getQueueThumbnailFallbackObserver() {
    if (
      queueThumbnailFallbackObserver ||
      typeof IntersectionObserver !== "function"
    ) {
      return queueThumbnailFallbackObserver;
    }

    queueThumbnailFallbackObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (
            !entry.target.isConnected ||
            !entry.target.closest(PLAYLIST_PANEL_SELECTOR) ||
            !isWatchPath()
          ) {
            observer.unobserve(entry.target);
            pendingQueueThumbnailItems.delete(entry.target);
            return;
          }
          if (!entry.isIntersecting) return;

          observer.unobserve(entry.target);
          applyQueueThumbnailFallback(entry.target);
        });
      },
      { rootMargin: QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN },
    );

    return queueThumbnailFallbackObserver;
  }

  function addQueueItemsFromNode(items, node) {
    const element =
      node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element) return;

    const closestItem = element.closest?.(QUEUE_ITEM_SELECTOR);
    if (closestItem?.closest(PLAYLIST_PANEL_SELECTOR)) {
      items.add(closestItem);
    }
    element.querySelectorAll?.(QUEUE_ITEM_SELECTOR).forEach((item) => {
      if (item.closest(PLAYLIST_PANEL_SELECTOR)) items.add(item);
    });
  }

  function unobserveRemovedQueueItems(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) return;

    const items = new Set(node.querySelectorAll(QUEUE_ITEM_SELECTOR));
    if (node.matches(QUEUE_ITEM_SELECTOR)) items.add(node);
    items.forEach((item) => {
      if (item.isConnected && item.closest(PLAYLIST_PANEL_SELECTOR)) return;
      queueThumbnailFallbackObserver?.unobserve(item);
      pendingQueueThumbnailItems.delete(item);
    });
  }

  function flushPendingQueueThumbnailItems() {
    queueThumbnailMutationFrame = 0;
    const items = Array.from(pendingQueueThumbnailItems);
    pendingQueueThumbnailItems.clear();
    if (!isWatchPath()) return;

    const observer = getQueueThumbnailFallbackObserver();
    items.forEach((item) => {
      if (!item.isConnected || !item.closest(PLAYLIST_PANEL_SELECTOR)) return;
      if (observer) {
        observer.observe(item);
      } else {
        applyQueueThumbnailFallback(item);
      }
    });
  }

  function scheduleQueueThumbnailItems(items) {
    items.forEach((item) => pendingQueueThumbnailItems.add(item));
    if (!pendingQueueThumbnailItems.size || queueThumbnailMutationFrame) return;

    queueThumbnailMutationFrame = requestAnimationFrame(
      flushPendingQueueThumbnailItems,
    );
  }

  function canRenderSurface(element) {
    if (
      !element?.isConnected ||
      element.hidden ||
      element.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    const style = getComputedStyle(element);
    return style.display !== "none" && !["hidden", "collapse"].includes(
      style.visibility,
    );
  }

  function isElementOrAncestorHidden(element, boundary) {
    if (!element?.isConnected) return true;

    let current = element;
    while (current) {
      if (!canRenderSurface(current)) return true;
      if (current === boundary) return false;
      current = current.parentElement;
    }
    return true;
  }

  function isFloatingChatSurface(surface) {
    const selector = 'ytd-live-chat-frame#chat[data-ytppl-live-chat-panel="1"]';
    try {
      const frame = surface.matches?.(selector) ? surface :
        surface.matches?.(CHAT_SURFACE_SELECTOR) ? surface.querySelector?.(selector) : null;
      // The marker alone is insufficient during native presentation changes.
      // Only our actually open, out-of-flow chat releases its former column.
      return Boolean(frame?.matches?.(":popover-open"));
    } catch {
      return false; // Unsupported selectors retain the native rail safely.
    }
  }

  function isActiveChatSurface(surface) {
    return (
      !isFloatingChatSurface(surface) &&
      !surface.hasAttribute("collapsed") &&
      !isElementOrAncestorHidden(surface, surface.closest("ytd-watch-flexy"))
    );
  }

  function getManagedLiveChatState(chatSurfaces) {
    if (chatSurfaces.some(isFloatingChatSurface)) return "open";
    return chatSurfaces.some(surface =>
      surface.tagName?.toLowerCase() === "ytd-live-chat-frame" && surface.id === "chat" &&
      surface.classList?.contains("ytppl-live-chat-hidden"),
    ) ? "hidden" : "";
  }

  function isActiveQueuePanel(panel) {
    return (
      Boolean(panel.querySelector(QUEUE_ITEM_SELECTOR)) &&
      !isElementOrAncestorHidden(panel, panel.closest("ytd-watch-flexy"))
    );
  }

  function isActiveEngagementPanel(panel) {
    const visibility = panel.getAttribute("visibility");
    return (
      !isFloatingChatSurface(panel) &&
      (!visibility || visibility === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED") &&
      !panel.hasAttribute("collapsed") &&
      !isElementOrAncestorHidden(panel, panel.closest("ytd-watch-flexy"))
    );
  }

  function isActiveAuxiliaryRailSurface(surface) {
    if (
      isElementOrAncestorHidden(surface, surface.closest("ytd-watch-flexy"))
    ) {
      return false;
    }

    const bounds = surface.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  function reconcileSecondaryRailState() {
    railStateReconciliationFrame = 0;
    const watchRoute = isWatchPath();
    let layoutChanged = false;
    document.querySelectorAll("ytd-watch-flexy").forEach((watchFlexy) => {
      const chatSurfaces = Array.from(watchFlexy.querySelectorAll(CHAT_SURFACE_SELECTOR));
      const managedChatState = watchRoute ? getManagedLiveChatState(chatSurfaces) : "";
      if (managedChatState) {
        if (watchFlexy.getAttribute(MANAGED_LIVE_CHAT_ATTRIBUTE) !== managedChatState) {
          watchFlexy.setAttribute(MANAGED_LIVE_CHAT_ATTRIBUTE, managedChatState);
          layoutChanged = true;
        }
      } else if (watchFlexy.hasAttribute(MANAGED_LIVE_CHAT_ATTRIBUTE)) {
        watchFlexy.removeAttribute(MANAGED_LIVE_CHAT_ATTRIBUTE);
        layoutChanged = true;
      }
      const eligible =
        watchRoute && (watchFlexy.matches(TWO_COLUMN_WATCH_FLEXY_SELECTOR) || Boolean(managedChatState));
      const related = eligible ? watchFlexy.querySelector("#related") : null;
      const relatedHidden =
        eligible &&
        (!related || isElementOrAncestorHidden(related, watchFlexy));
      const chatVisible =
        eligible && chatSurfaces.some(isActiveChatSurface);
      const queueVisible =
        eligible &&
        Array.from(
          watchFlexy.querySelectorAll(PLAYLIST_PANEL_SELECTOR),
        ).some(isActiveQueuePanel);
      const auxiliarySurfaceVisible =
        eligible &&
        Array.from(
          watchFlexy.querySelectorAll(AUXILIARY_RAIL_SURFACE_SELECTOR),
        ).some(isActiveAuxiliaryRailSurface);
      const engagementPanelVisible =
        eligible &&
        Array.from(
          watchFlexy.querySelectorAll(`#secondary ${ENGAGEMENT_PANEL_SELECTOR}`),
        ).some(isActiveEngagementPanel);
      const railIsEmpty =
        eligible &&
        relatedHidden &&
        !chatVisible &&
        !queueVisible &&
        !auxiliarySurfaceVisible &&
        !engagementPanelVisible;

      if (railIsEmpty) {
        if (watchFlexy.getAttribute(EMPTY_SECONDARY_RAIL_ATTRIBUTE) !== "1") {
          watchFlexy.setAttribute(EMPTY_SECONDARY_RAIL_ATTRIBUTE, "1");
          layoutChanged = true;
        }
      } else if (watchFlexy.hasAttribute(EMPTY_SECONDARY_RAIL_ATTRIBUTE)) {
        watchFlexy.removeAttribute(EMPTY_SECONDARY_RAIL_ATTRIBUTE);
        layoutChanged = true;
      }
    });
    // Native inline player dimensions must follow the scoped CSS variables.
    // Notify once per actual state transition; stable reconciliation is silent.
    if (watchRoute && layoutChanged) window.dispatchEvent(new Event("resize"));
  }

  function scheduleSecondaryRailStateReconciliation() {
    if (railStateReconciliationFrame) return;
    railStateReconciliationFrame = requestAnimationFrame(
      reconcileSecondaryRailState,
    );
  }

  function getRailMutationTargets() {
    if (!isWatchPath()) return [];

    const targets = new Set();
    document.querySelectorAll("ytd-watch-flexy").forEach((watchFlexy) => {
      watchFlexy
        .querySelectorAll(RAIL_MUTATION_TARGET_SELECTOR)
        .forEach((target) => targets.add(target));
      const secondary = watchFlexy.querySelector("#secondary");
      targets.add(secondary || watchFlexy);
      if (secondary?.parentElement) {
        targets.add(secondary.parentElement);
      }
    });
    return Array.from(targets);
  }

  function getNodeElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function nodeContainsRailMutationTarget(node) {
    const element = getNodeElement(node);
    return Boolean(
      element &&
        (element.matches(RAIL_MUTATION_TARGET_SELECTOR) ||
          element.querySelector(RAIL_MUTATION_TARGET_SELECTOR)),
    );
  }

  function nodeContainsQueueItem(node) {
    const element = getNodeElement(node);
    return Boolean(
      element &&
        (element.matches(QUEUE_ITEM_SELECTOR) ||
          element.querySelector(QUEUE_ITEM_SELECTOR)),
    );
  }

  function isDiscoveryMutationTarget(target) {
    return target.matches("ytd-watch-flexy, #secondary");
  }

  function isSecondaryRailMutationAnchor(target) {
    return Array.from(target.children || []).some(
      (child) =>
        child.matches?.("#secondary") &&
        child.closest("ytd-watch-flexy") === target.closest("ytd-watch-flexy"),
    );
  }

  function mutationAffectsRailState(mutation) {
    const element = getNodeElement(mutation.target);
    if (!element) return false;

    if (mutation.type === "attributes") {
      if (
        ["aria-current", "aria-selected", "selected"].includes(
          mutation.attributeName,
        ) &&
        element.closest(QUEUE_ITEM_SELECTOR)
      ) {
        return true;
      }
      return (
        SURFACE_STATE_MUTATION_ATTRIBUTES.includes(mutation.attributeName) &&
        (element.matches(RAIL_MUTATION_TARGET_SELECTOR) ||
          isDiscoveryMutationTarget(element))
      );
    }

    if (mutation.type !== "childList") return false;
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (element.closest(AUXILIARY_RAIL_SURFACE_SELECTOR)) {
      return true;
    }
    if (element.closest(`${CHAT_SURFACE_SELECTOR}, #chat-container`)) {
      return true;
    }
    if (element.closest(PLAYLIST_PANEL_SELECTOR)) {
      return changedNodes.some(nodeContainsQueueItem);
    }
    return changedNodes.some(
      (node) =>
        nodeContainsRailMutationTarget(node) || nodeContainsQueueItem(node),
    );
  }

  function refreshRailMutationObserver() {
    const nextTargets = new Set(getRailMutationTargets());
    if (
      nextTargets.size === observedRailMutationTargets.size &&
      [...nextTargets].every((target) =>
        observedRailMutationTargets.has(target),
      )
    ) {
      return;
    }

    const registrations = [...nextTargets].map((target) => {
      const isSecondaryRailAnchor =
        isSecondaryRailMutationAnchor(target);
      const isDiscoveryTarget = isDiscoveryMutationTarget(target);
      const isPlaylistPanel = target.matches(PLAYLIST_PANEL_SELECTOR);
      const isAuxiliaryRailSurface = target.matches(
        AUXILIARY_RAIL_SURFACE_SELECTOR,
      );
      return [
        target,
        isSecondaryRailAnchor
          ? {
              childList: true,
            }
          : isDiscoveryTarget
          ? {
              attributeFilter: DISCOVERY_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: true,
              subtree: true,
            }
          : isPlaylistPanel
          ? {
              attributeFilter: PANEL_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: true,
              subtree: true,
            }
          : isAuxiliaryRailSurface
          ? {
              attributeFilter: SURFACE_STATE_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: true,
              subtree: true,
            }
          : {
              attributeFilter: SURFACE_STATE_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: target.matches(
                "#chat-container, ytd-engagement-panel-section-list-renderer",
              ),
            },
      ];
    });
    replaceObserverRegistrations(railMutationObserver, registrations);
    observedRailMutationTargets = nextTargets;
  }

  function replaceObserverRegistrations(targetObserver, registrations) {
    if (typeof targetObserver.replaceRegistrations === "function") {
      targetObserver.replaceRegistrations(registrations);
      return;
    }

    targetObserver.disconnect();
    registrations.forEach(([target, options]) =>
      targetObserver.observe(target, options),
    );
  }

  const railMutationObserver = new MutationObserver((mutations) => {
    if (!isWatchPath()) return;

    const items = new Set();
    let railStateMayHaveChanged = false;
    let targetsMayHaveChanged = false;
    mutations.forEach((mutation) => {
      railStateMayHaveChanged ||= mutationAffectsRailState(mutation);
      if (mutation.type === "attributes") {
        if (QUEUE_ITEM_MUTATION_ATTRIBUTES.includes(mutation.attributeName)) {
          addQueueItemsFromNode(items, mutation.target);
        }
        return;
      }
      if (mutation.type !== "childList") return;

      addQueueItemsFromNode(items, mutation.target);
      mutation.addedNodes?.forEach((node) => addQueueItemsFromNode(items, node));
      mutation.removedNodes?.forEach(unobserveRemovedQueueItems);
      targetsMayHaveChanged ||=
        Array.from(mutation.addedNodes || []).some(
          nodeContainsRailMutationTarget,
        ) ||
        Array.from(mutation.removedNodes || []).some(
          nodeContainsRailMutationTarget,
        );
    });
    scheduleQueueThumbnailItems(items);
    if (railStateMayHaveChanged) {
      scheduleSecondaryRailStateReconciliation();
      scheduleQueuePlayingMarkerReconciliation();
    }
    if (targetsMayHaveChanged) refreshRailMutationObserver();
  });

  function applyQueueThumbnailFallbacks() {
    const panels = isWatchPath()
      ? Array.from(document.querySelectorAll(PLAYLIST_PANEL_SELECTOR))
      : [];
    refreshRailMutationObserver();
    scheduleSecondaryRailStateReconciliation();
    if (!panels.length) return;

    const observer = getQueueThumbnailFallbackObserver();
    panels.forEach((panel) => {
      panel.querySelectorAll(QUEUE_ITEM_SELECTOR).forEach((item) => {
        if (observer) {
          observer.observe(item);
        } else {
          applyQueueThumbnailFallback(item);
        }
      });
    });
  }

  function scheduleQueueThumbnailFallbacks() {
    if (queueThumbnailFallbackObserver) {
      queueThumbnailFallbackObserver.disconnect();
      queueThumbnailFallbackObserver.takeRecords();
    }
    queueThumbnailFallbackTimers.forEach((timerId) => clearTimeout(timerId));
    refreshRailMutationObserver();
    scheduleSecondaryRailStateReconciliation();
    queueThumbnailFallbackTimers = QUEUE_THUMBNAIL_FALLBACK_DELAYS_MS.map(
      (delay) => setTimeout(applyQueueThumbnailFallbacks, delay),
    );
  }

  function installQueuePlayingMarkerReconciliation() {
    const panelSelector = "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector = "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    const controller = element => element?.polymerController || element?.getPolymerController?.() || element;
    const attempted = new WeakMap();
    let frame = 0;
    let navigating = false;

    function reconcile() {
      frame = 0;
      if (navigating) return;
      const players = [...document.querySelectorAll('#movie_player')].filter(player =>
        player.isConnected && player.getClientRects().length);
      if (players.length !== 1 || players[0].classList.contains('ad-showing') ||
          players[0].classList.contains('ad-interrupting')) return;
      const player = players[0];
      let videoId, listId;
      try {
        videoId = player.getVideoData?.()?.video_id;
        listId = player.getPlaylistId?.();
      } catch { return; }
      if (typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId) ||
          typeof listId !== 'string' || !listId.startsWith('TLPQ')) return;
      for (const panel of document.querySelectorAll(panelSelector)) {
        try {
          const owner = controller(panel), data = owner?.data;
          if (!panel.isConnected || data?.playlistId !== listId || !Array.isArray(data.contents) ||
              !data.contents.length || data.contents.length > 1000 ||
              !Number.isInteger(data.currentIndex) ||
              (Number.isInteger(data.totalVideos) && data.totalVideos !== data.contents.length)) continue;
          const videos = data.contents.map(item => item.playlistPanelVideoRenderer);
          const index = data.currentIndex;
          if (videos.some(video => !video || typeof video.videoId !== 'string' || !/^[\w-]{11}$/.test(video.videoId)) ||
              videos[index]?.videoId !== videoId || videos.filter(video => video.videoId === videoId).length !== 1) continue;
          const items = panel.querySelector('#items');
          const rows = items ? [...items.children] : [];
          // Do not touch a partially stamped panel or a DOM move awaiting commit.
          if (rows.length !== videos.length || rows.some((row, i) => !row.matches(rowSelector) ||
              controller(row)?.data?.videoId !== videos[i].videoId ||
              !videos[i].playlistSetVideoId || controller(row)?.data?.playlistSetVideoId !== videos[i].playlistSetVideoId)) continue;
          const reorder = owner.ytReorderableController;
          if (reorder && Object.getOwnPropertyNames(reorder).some(name =>
            name.endsWith('dragListGroup') && reorder[name]?.isDragging?.())) continue;
          const modelMismatch = videos.some((video, i) => Boolean(video.selected) !== (i === index));
          const rowMismatch = (row, i) => {
            const rowOwner = controller(row), selected = i === index;
            return Boolean(rowOwner.data.selected) !== selected ||
              (typeof rowOwner.selected === 'boolean' && rowOwner.selected !== selected) ||
              row.hasAttribute('selected') !== selected;
          };
          if (!modelMismatch && !rows.some(rowMismatch)) { attempted.delete(panel); continue; }
          const signature = JSON.stringify([listId, videoId, index, videos.map((video, i) =>
            [video.playlistSetVideoId, Boolean(video.selected), Boolean(controller(rows[i]).data.selected),
              controller(rows[i]).selected, rows[i].hasAttribute('selected')])]);
          if (attempted.get(panel) === signature) continue; // A native no-op must not create a restamping loop.
          if (modelMismatch) {
            if (typeof owner.set !== 'function') continue;
            attempted.set(panel, signature);
            // Rebind only the panel's display model. The native playlist manager,
            // queue order, endpoints and playback are deliberately left alone.
            owner.set('data', { ...data, contents: data.contents.map((item, i) =>
              Boolean(videos[i].selected) === (i === index) ? item :
                { ...item, playlistPanelVideoRenderer: { ...videos[i], selected: i === index } }) });
            continue; // Let the native stamper finish before checking reused rows.
          }
          rows.forEach((row, i) => {
            const rowOwner = controller(row), selected = i === index;
            if (typeof rowOwner.set !== 'function') return;
            if (rowMismatch(row, i)) {
              attempted.set(panel, signature);
              // selected is a native computed property of data; rebind data rather
              // than overriding that property or hiding its arrow with CSS.
              rowOwner.set('data', { ...rowOwner.data, selected });
            }
          });
        } catch { /* Unknown native bindings are left untouched. */ }
      }
    }

    function schedule() {
      if (!navigating && !frame) frame = requestAnimationFrame(reconcile);
    }
    ['yt-playlist-data-updated', 'yt-page-data-updated'].forEach(type => window.addEventListener(type, schedule, true));
    window.addEventListener('yt-rendererstamper-finished', event => {
      if (event.target?.closest?.(panelSelector)) schedule();
    }, true);
    window.addEventListener('yt-navigate-start', () => {
      navigating = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }, true);
    ['yt-navigate-finish', 'pageshow'].forEach(type => window.addEventListener(type, () => {
      navigating = false;
      schedule();
    }, true));
    window.addEventListener('pagehide', () => {
      navigating = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }, true);
    schedule();
    return schedule;
  }

  function installQueuePlayNext() {
    const marker = "ytMasterPlayNext";
    const panelSelector = "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector = "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    let entries = new WeakMap();
    let sheets = new WeakMap();
    let pending = null;
    let toast = null;
    let toastTimer = 0;
    let menuFrame = 0;

    const controller = (element) => element?.polymerController || element?.getPolymerController?.() || element;
    const validId = (value) => typeof value === "string" && /^[\w-]{11}$/.test(value);

    function sheetData(popup) {
      // Current view-model wrappers deliberately return a Symbol from .data.
      // Their native reactive getter and external .data setter remain separate.
      const read = popup?.componentProps?.data;
      try { return typeof read === "function" ? read() : null; }
      catch { return null; } // A dismissed native sheet may already be disposed.
    }

    function queueCommand(item) {
      const data = item?.menuServiceItemRenderer || item?.listItemViewModel;
      const endpoint = data?.serviceEndpoint || data?.rendererContext?.commandContext?.onTap?.innertubeCommand;
      const actions = endpoint?.signalServiceEndpoint?.actions;
      if (!Array.isArray(actions) || actions.length !== 1) return null;
      const command = actions[0]?.addToPlaylistCommand;
      if (command?.listType !== "PLAYLIST_EDIT_LIST_TYPE_QUEUE") return null;
      const ids = command.videoIds || [command.videoId];
      if (!Array.isArray(ids) || ids.length !== 1 || !validId(ids[0]) ||
          (command.videoId !== undefined && command.videoId !== ids[0])) return null;
      return { endpoint, command, videoId: ids[0] };
    }

    function activeVideoId() {
      const ids = new Set();
      let visible = 0;
      for (const player of document.querySelectorAll('#movie_player')) {
        if (!player.isConnected || !player.getClientRects().length) continue;
        visible++;
        const id = player.getVideoData?.()?.video_id;
        if (validId(id)) ids.add(id);
      }
      return visible === 1 && ids.size === 1 ? [...ids][0] : visible ? undefined : null;
    }

    function activePlayer(anchor) {
      return [...document.querySelectorAll('#movie_player')].find(player =>
        player.isConnected && player.getClientRects().length &&
        player.getVideoData?.()?.video_id === anchor);
    }

    const sameIds = (left, right) => left.length === right.length && left.every((id, i) => id === right[i]);

    function miniplayerQueue(player, anchor) {
      const mini = player?.closest("ytd-miniplayer");
      if (!mini) return null;
      const ids = player.getPlaylist?.();
      if (Array.isArray(ids) && !ids.length) return null; // A standalone video has no existing queue.
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !validId(id)) ||
          ids.filter(id => id === anchor).length !== 1) return { unavailable: true };
      return { mini, ids: [...ids] };
    }

    function queueState(anchor) {
      const queues = [];
      const player = activePlayer(anchor);
      const activeListId = player?.getPlaylistId?.();
      const missingListId = activeListId == null || activeListId === "";
      if (!missingListId && typeof activeListId !== "string") return { unavailable: true };
      const mini = player?.closest("ytd-miniplayer");
      const miniQueue = miniplayerQueue(player, anchor);
      if (missingListId && miniQueue?.unavailable) return { unavailable: true };
      for (const panel of document.querySelectorAll(panelSelector)) {
        if (!panel.isConnected) continue;
        const owner = controller(panel);
        const data = owner?.data;
        if (typeof data?.playlistId !== "string" || !data.playlistId.startsWith("TLPQ")) continue;
        const ownedMini = mini && panel.closest("ytd-miniplayer") === mini;
        if (missingListId && ownedMini && !miniQueue?.mini) return { unavailable: true };
        if (!panel.getClientRects().length && data.playlistId !== activeListId && !ownedMini) continue;
        // Visible panels can also belong to a previous queue during navigation.
        // On Home the native miniplayer reports no playlist ID. Only its own
        // panel, with the player's exact ordered video IDs, can identify it.
        if (data.playlistId !== activeListId && !(missingListId && ownedMini)) return { unavailable: true };
        if (!Array.isArray(data.contents) || data.contents.length > 1000 || owner.canReorder === false) {
          return { unavailable: true };
        }
        const videos = data.contents.map(item => item.playlistPanelVideoRenderer);
        if (!videos.length || videos.some(video => !validId(video?.videoId))) return { unavailable: true };
        if (missingListId && !sameIds(videos.map(video => video.videoId), miniQueue.ids)) return { unavailable: true };
        // Native display selection can retain the previous playing marker,
        // especially on Home where the miniplayer reports no playlist ID.
        // Prefer the independently verified index and unique playing video;
        // only older models without an index use the strict selection fallback.
        let currentIndex = data.currentIndex;
        if (!("currentIndex" in data)) {
          const selected = videos.filter(video => video.selected === true);
          if (selected.length !== 1 || selected[0].videoId !== anchor) return { unavailable: true };
          currentIndex = videos.indexOf(selected[0]);
        }
        if (!Number.isInteger(currentIndex) || videos[currentIndex]?.videoId !== anchor ||
            videos.filter(video => video.videoId === anchor).length !== 1 ||
            (Number.isInteger(data.totalVideos) && data.totalVideos > videos.length)) return { unavailable: true };
        queues.push({ panel, owner, data, videos, currentIndex, listId: data.playlistId, mini: ownedMini ? mini : null });
      }
      // A collapsed Home queue may not have stamped a panel yet. Never mistake
      // its existing playlist for no queue and send an append-only command.
      if (!queues.length && miniQueue?.mini && (missingListId || activeListId?.startsWith("TLPQ"))) {
        return { awaitingPanel: true, ...miniQueue };
      }
      // A known queue ID still identifies an existing queue when its player
      // playlist API is unavailable or temporarily empty. Without a verified
      // panel there is no safe reorder path, so never fall through to append.
      if (!queues.length && mini && activeListId?.startsWith("TLPQ")) return { unavailable: true };
      return queues.length > 1 ? { unavailable: true } : queues[0] || null;
    }

    function reorderRows(queue) {
      const items = queue.panel.querySelector("#items");
      const rows = items ? [...items.children].filter(row => row.matches(rowSelector)) : [];
      if (typeof queue.owner.handleDrop !== "function" || rows.length !== queue.videos.length ||
          rows.some((row, i) => {
            const data = controller(row)?.data;
            return items.childNodes[i] !== row || data?.videoId !== queue.videos[i].videoId ||
              !data?.playlistSetVideoId || data.playlistSetVideoId !== queue.videos[i].playlistSetVideoId;
          })) return null;
      const reorder = queue.owner.ytReorderableController;
      if (reorder && Object.getOwnPropertyNames(reorder).some(name =>
        name.endsWith("dragListGroup") && reorder[name]?.isDragging?.())) return null;
      return { items, rows };
    }

    function notify(message) {
      clearTimeout(toastTimer);
      toast?.remove();
      toast = document.createElement("div");
      toast.setAttribute("role", "status");
      toast.setAttribute("data-yt-master-queue-status", "");
      toast.textContent = message;
      Object.assign(toast.style, {
        position: "fixed", bottom: "24px", left: "24px", zIndex: "2202",
        padding: "14px 20px", borderRadius: "8px", font: "14px Roboto, Arial, sans-serif",
        background: "var(--yt-spec-raised-background, #212121)",
        color: "var(--yt-spec-text-primary, #fff)", boxShadow: "0 4px 16px #0005",
        maxWidth: "calc(100vw - 48px)", pointerEvents: "none",
      });
      document.body?.appendChild(toast);
      toastTimer = setTimeout(() => { toast?.remove(); toast = null; toastTimer = 0; }, 4000);
    }

    function finish(message) {
      if (pending) {
        pending.observer.disconnect();
        clearTimeout(pending.timer);
        if (pending.frame) cancelAnimationFrame(pending.frame);
        pending = null;
      }
      if (message) notify(message);
    }

    function tryMoveNext() {
      if (!pending) return;
      const operation = pending;
      try {
        if (activeVideoId() !== operation.anchor) {
          finish("Playback changed; the queue was not reordered.");
          return;
        }
        const player = activePlayer(operation.anchor);
        const activeListId = player?.getPlaylistId?.();
        if (operation.listId && activeListId !== operation.listId &&
            !((activeListId == null || activeListId === "") && operation.mini &&
              player?.closest("ytd-miniplayer") === operation.mini)) {
          finish("The queue changed; no item was moved.");
          return;
        }
        const queue = queueState(operation.anchor);
        if (operation.preparing) {
          const current = miniplayerQueue(player, operation.anchor);
          if (!current?.mini || current.mini !== operation.mini || !sameIds(current.ids, operation.ids)) {
            finish("The queue changed; no video was added.");
            return;
          }
          if (!queue || queue.unavailable || queue.awaitingPanel || !reorderRows(queue)) return;
          const { entry, popup } = operation;
          finish();
          begin(entry, popup);
          return;
        }
        if (!queue || queue.unavailable || queue.awaitingPanel) return;
        if (operation.listId && queue.listId !== operation.listId) {
          finish("The queue changed; no item was moved.");
          return;
        }
        const index = queue.videos.findIndex(video => video.videoId === operation.videoId);
        if (index < 0) return;
        const currentIndex = queue.currentIndex;
        if (index === currentIndex || index === currentIndex + 1) { finish("Playing next in queue"); return; }
        if (operation.committed) return; // Wait for native data to confirm, never commit twice.
        const binding = reorderRows(queue);
        if (!binding) return;
        const { items, rows } = binding;
        const row = rows[index];
        // This is the same DOM move + controller commit used by native dragging.
        // Never change the queue model, call a private network API or reload playback.
        items.insertBefore(row, rows[currentIndex].nextSibling);
        operation.committed = true;
        try {
          queue.owner.handleDrop({ currDragItem: row });
          scheduleMove();
        } catch {
          // The native commit may have partially completed. Do not retry it or
          // overwrite native state with a speculative rollback.
          finish("Could not confirm Play next. Please check the queue.");
        }
      } catch {
        finish("Could not move the video next. Please check the queue.");
      }
    }

    function scheduleMove() {
      if (!pending) return;
      const operation = pending;
      // Native stamping can finish inside an animation frame. Waiting for a
      // second frame paints the temporary tail position before moving it next.
      // Coalesce after the native stack, but before paint; readiness and commit
      // guards in tryMoveNext still own every move and confirmation attempt.
      if (!operation.moveQueued) {
        operation.moveQueued = true;
        queueMicrotask(() => {
          if (pending !== operation) return;
          operation.moveQueued = false;
          tryMoveNext();
        });
      }
      // A native row/model binding may settle in a later microtask without
      // another observable mutation. Retain one coalesced frame as a backstop,
      // not a polling loop; an unready attempt waits for the next native signal.
      if (!operation.frame) operation.frame = requestAnimationFrame(() => {
        if (pending !== operation) return;
        operation.frame = 0;
        tryMoveNext();
      });
    }

    function queueDispatcher(popup) {
      const app = document.querySelector("ytd-app");
      // Some older clients expose this method on the host, others only on its
      // controller. Preserve the callable receiver rather than choosing blindly.
      const targets = popup.matches("yt-sheet-view-model") ? [app, popup] : [popup, app];
      for (const target of targets) {
        for (const owner of [target, controller(target)]) {
          if (typeof owner?.resolveCommand === "function") return endpoint => owner.resolveCommand(endpoint);
        }
      }
      if (!app?.isConnected) return null;
      // Current clients no longer expose resolveCommand on elements. This is
      // YouTube's native action-router contract; its handler invokes the internal
      // command service and appends an acknowledgement to returnValue.
      return endpoint => {
        const action = { actionName: "yt-command-executor-command", optionalAction: false,
          args: [endpoint, popup], returnValue: [] };
        app.dispatchEvent(new CustomEvent("yt-action", { detail: action, bubbles: true, composed: true }));
        return action.returnValue.length > 0;
      };
    }

    function observeQueue() {
      const observer = new MutationObserver(records => {
        if (records.some(record => record.target.closest?.(panelSelector) ||
            [...record.addedNodes].some(node => node.matches?.(panelSelector) || node.querySelector?.(panelSelector)))) scheduleMove();
      });
      observer.observe(document.querySelector("ytd-app") || document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["selected", "aria-selected", "href"],
      });
      return observer;
    }

    function prepareMiniplayer(entry, popup, anchor) {
      const queue = miniplayerQueue(activePlayer(anchor), anchor);
      const toggles = queue?.mini ? [...queue.mini.querySelectorAll("ytd-miniplayer-info-bar button[aria-expanded]")]
        .filter(button => button.closest("ytd-miniplayer") === queue.mini && button.getClientRects().length) : [];
      if (toggles.length !== 1 || !["true", "false"].includes(toggles[0].getAttribute("aria-expanded"))) {
        notify("Could not prepare Play next. Open the miniplayer queue and try again. Nothing was added.");
        return;
      }
      pending = { anchor, videoId: entry.videoId, entry, popup, preparing: true,
        mini: queue.mini, ids: queue.ids, observer: observeQueue(), moveQueued: false, frame: 0, timer: 0 };
      pending.timer = setTimeout(() => finish("Could not prepare Play next. Nothing was added; please try again."), 2000);
      // The native queue header is outside the player's unrelated expand controls.
      if (toggles[0].getAttribute("aria-expanded") === "false") toggles[0].click();
      scheduleMove();
    }

    function begin(entry, popup) {
      if (entry.used) return;
      if (pending) { notify("Please wait for the queue to update, then try again."); return; }
      const anchor = activeVideoId();
      if (anchor === undefined) { notify("Could not identify the playing video. Please try again."); return; }
      const queue = anchor ? queueState(anchor) : null;
      if (queue?.unavailable) { notify("The queue is still updating. Please try again."); return; }
      if (anchor === entry.videoId) { notify("This video is already playing."); return; }
      if (queue?.awaitingPanel || (queue?.mini && !reorderRows(queue))) {
        prepareMiniplayer(entry, popup, anchor);
        return;
      }
      const playlist = anchor && activePlayer(anchor)?.getPlaylist?.();
      const existing = queue?.videos.some(video => video.videoId === entry.videoId) ||
        (Array.isArray(playlist) && playlist.includes(entry.videoId));
      if (queue && !existing && !reorderRows(queue)) {
        notify("The queue is still updating. Nothing was added; please try again.");
        return;
      }
      const dispatch = existing ? null : queueDispatcher(popup);
      if (!existing && !dispatch) { notify("Play next is unavailable in this menu."); return; }
      entry.used = true; // Only consume a selection once a native operation can start.
      if (anchor) {
        pending = { anchor, videoId: entry.videoId, listId: queue?.listId, mini: queue?.mini,
          observer: observeQueue(), moveQueued: false, frame: 0, timer: 0 };
        pending.timer = setTimeout(() => finish(pending.committed
          ? "Could not confirm Play next. Please check the queue."
          : existing ? "Could not move the queued video next. Please try again."
            : "Added to queue, but could not move it next. Please check the queue."), 8000);
      }
      if (!existing) {
        const command = { ...entry.command, openMiniplayer: anchor ? false : entry.command.openMiniplayer };
        const endpoint = {
          ...entry.endpoint,
          signalServiceEndpoint: { ...entry.endpoint.signalServiceEndpoint,
            actions: [{ ...entry.endpoint.signalServiceEndpoint.actions[0], addToPlaylistCommand: command }] },
        };
        // Keep the original native creation command and metadata. Do not retry:
        // an ambiguous resolver result can still mean the video was added.
        if (dispatch(endpoint) === false) {
          finish("YouTube could not accept Play next. Please check the queue.");
          return;
        }
      }
      scheduleMove();
    }

    function dismissMenu(popup) {
      const dropdown = popup.closest("tp-yt-iron-dropdown");
      for (const owner of new Set([dropdown, controller(dropdown)])) {
        if (typeof owner?.close !== "function") continue;
        owner.close();
        return; // A throwing native close is not retried through another route.
      }
      // Current sheet hosts can omit the dropdown method. Ask YouTube's popup
      // owner to close this renderer, without hiding DOM or clicking elsewhere.
      popup.dispatchEvent(new CustomEvent("yt-action", { bubbles: true, composed: true,
        detail: { actionName: "yt-close-popup-action", optionalAction: false,
          args: [popup.localName], returnValue: [] } }));
    }

    function openMenu(event) {
      const popup = event.target;
      if (!popup?.matches?.("ytd-menu-popup-renderer, yt-sheet-view-model")) return;
      try {
        const sheet = popup.matches("yt-sheet-view-model");
        sheets.delete(popup);
        const owner = controller(popup);
        const data = sheet ? sheetData(popup) : owner?.data;
        const list = data?.content?.listViewModel;
        const sourceItems = sheet ? list?.listItems : data?.items;
        if (!Array.isArray(sourceItems) || sourceItems.length > 60 ||
            (sheet ? typeof popup.setters?.data !== "function" : typeof owner.set !== "function")) return;
        const items = sourceItems.filter(item =>
          (item?.menuServiceItemRenderer || item?.listItemViewModel)?.[marker] !== true);
        if (items.some(item => {
          const icon = item?.menuServiceItemRenderer?.icon?.iconType ||
            item?.listItemViewModel?.leadingImage?.sources?.[0]?.clientResource?.imageName;
          return ["QUEUE_PLAY_NEXT", "ADD_TO_QUEUE_HEAD"].includes(icon?.toUpperCase());
        })) return;
        const index = items.findIndex(item => queueCommand(item));
        if (index < 0 || (sheet && !items[index].listItemViewModel)) return;
        const entry = queueCommand(items[index]);
        const endpoint = { signalServiceEndpoint: { signal: "CLIENT_SIGNAL", actions: [] } };
        if (sheet) {
          const record = {
            ...items[index].listItemViewModel,
            title: { content: "Play next in queue" },
            leadingImage: { sources: [{ clientResource: { imageName: "QUEUE_PLAY_NEXT" } }] },
            rendererContext: { accessibilityContext: { label: "Play next in queue" },
              commandContext: { onTap: { innertubeCommand: endpoint } } },
            targetId: "yt-master-play-next", [marker]: true,
          };
          items.splice(index, 0, { listItemViewModel: record });
          const updated = { ...data, content: { ...data.content, listViewModel: { ...list, listItems: items } } };
          // Native view-model rows do not expose .data. Bind activation to the
          // owned sheet's exact model and native target ID, not text or position.
          sheets.set(popup, { data: updated, entry });
          popup.data = updated;
        } else {
          const record = {
            text: { simpleText: "Play next in queue" }, icon: { iconType: "QUEUE_PLAY_NEXT" },
            serviceEndpoint: endpoint, [marker]: true,
          };
          entries.set(record, entry);
          items.splice(index, 0, { menuServiceItemRenderer: record });
          owner.set("data", { ...data, items });
        }
        // Stamp through the native menu, then let its dropdown fit the extra row.
        if (menuFrame) cancelAnimationFrame(menuFrame);
        menuFrame = requestAnimationFrame(() => {
          menuFrame = 0;
          if (popup.isConnected) popup.closest("tp-yt-iron-dropdown")?.refit?.();
        });
      } catch { /* An unrecognised menu keeps its native Add to queue action. */ }
    }

    function activate(event) {
      const source = event.detail?.sourceEvent;
      if (!event.isTrusted && !(source instanceof Event && source.isTrusted)) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      const row = event.target?.closest?.("ytd-menu-service-item-renderer, yt-list-item-view-model");
      const popup = row?.closest("ytd-menu-popup-renderer, yt-sheet-view-model");
      const sheet = sheets.get(popup);
      const entry = row?.matches('yt-list-item-view-model[data-target-id="yt-master-play-next"]')
        ? sheet && sheetData(popup) === sheet.data && sheet.entry
        : row && entries.get(controller(row)?.data);
      if (!entry) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { begin(entry, popup); }
      catch { finish("Play next could not be completed. Please check the queue."); }
      finally {
        // Native activation is suppressed above, so dismiss rejected and
        // preparing selections too. Resolve/dispatch before native teardown.
        try { dismissMenu(popup); }
        catch { /* Closing an already disposed native popup is harmless. */ }
      }
    }

    function reset() {
      finish();
      entries = new WeakMap();
      sheets = new WeakMap();
      if (menuFrame) cancelAnimationFrame(menuFrame);
      menuFrame = 0;
      clearTimeout(toastTimer);
      toastTimer = 0;
      toast?.remove();
      toast = null;
    }
    window.addEventListener("yt-popup-opened", openMenu, true);
    ["click", "tap", "keydown"].forEach(type => document.addEventListener(type, activate, true));
    ["yt-playlist-data-updated", "yt-page-data-updated"].forEach(type => window.addEventListener(type, scheduleMove, true));
    ["yt-navigate-start", "pagehide"].forEach(type => window.addEventListener(type, reset, true));
    return reset;
  }

  function installQueueStepControls() {
    const panelSelector = "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector = "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    const controlSelector = 'button[data-ywlc-queue-step]';
    const arrowPaths = { up: 'M0 16 8 0l8 16z', down: 'M0 0l8 16 8-16z' };
    const records = new Map();
    const listeners = [];
    const controller = node => node?.polymerController || node?.getPolymerController?.() || node;
    const validId = value => typeof value === "string" && /^[\w-]{11}$/.test(value);
    const same = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
    let frame = 0, pending = null, focusRequest = null, navigating = false, disposed = false;
    let toast = null, toastTimer = 0;
    const sharedStyle = typeof suite !== 'undefined' && typeof suite.setStyle === 'function' && typeof suite.removeStyle === 'function';
    const stepCss = `
      [data-ywlc-queue-step-controls] { position: relative !important; overflow: visible !important; }
      [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step] {
        position: absolute; left: 50%; transform: translate(-50%, -50%); display: flex;
        align-items: center; justify-content: center; width: 24px; height: 24px;
        min-width: 0; padding: 0; margin: 0; border: 0; border-radius: 3px;
        background: transparent; color: var(--yt-spec-icon-inactive, var(--yt-spec-text-secondary, #aaa)); cursor: pointer; line-height: 0;
        opacity: 0; pointer-events: none;
      }
      [data-ywlc-queue-step="up"] { top: calc(50% - 18px); }
      [data-ywlc-queue-step="down"] { top: calc(50% + 18px); }
      :is(ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer):hover [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step],
      [data-ywlc-queue-step-controls]:has(> button[data-ywlc-queue-step]:focus-visible) > button[data-ywlc-queue-step] {
        opacity: 1; pointer-events: auto;
      }
      [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step]:hover:not(:disabled) {
        background: var(--yt-spec-10-percent-layer, #ffffff1a);
      }
      [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step]:disabled { color: color-mix(in srgb, var(--yt-spec-icon-inactive, var(--yt-spec-text-secondary, #aaa)) 25%, transparent); cursor: default; }
      [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step]:focus-visible { opacity: 1; pointer-events: auto; outline: 2px solid currentColor; outline-offset: 1px; }
      [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step] svg { width: 14px; height: 14px; fill: currentColor; pointer-events: none; }
      .dragging [data-ywlc-queue-step-controls] > button[data-ywlc-queue-step] { visibility: hidden; }
      [data-ywlc-queue-presentation="1"] > #container,
      [data-ywlc-queue-presentation="1"] > a > #container { align-items: center !important; }
      [data-ywlc-queue-presentation="1"] :is(.playlist-drag-handle, a#thumbnail, ytd-thumbnail, yt-thumbnail-view-model, .ytThumbnailViewModelHost) {
        align-self: center !important;
      }
      [data-ywlc-queue-presentation="1"] #meta { min-width: 0; }
      #video-title[data-ywlc-queue-title="1"]:not([hidden]):not([aria-hidden="true"]) {
        display: -webkit-box;
        -webkit-box-orient: vertical !important; -webkit-line-clamp: 2 !important; line-clamp: 2 !important;
        overflow: hidden !important;
        text-overflow: ellipsis; white-space: normal; overflow-wrap: anywhere;
      }
      [data-ywlc-queue-title-tooltip] {
        position: fixed; z-index: 2203; box-sizing: border-box; width: max-content;
        max-width: min(320px, calc(100vw - 16px)); max-height: calc(100vh - 16px);
        padding: 8px; border-radius: 4px; background: #212121; color: #fff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, .24);
        font: 400 13px/1.4 Roboto, Arial, sans-serif; text-shadow: none;
        white-space: normal; overflow-wrap: anywhere; overflow: hidden; pointer-events: none;
      }
    `;
    let style = null;
    if (sharedStyle) suite.setStyle('watchLayoutCleanerQueueSteps', stepCss);
    else {
      style = document.createElement('style'); style.id = 'ywlc-queue-step-style'; style.textContent = stepCss;
      (document.head || document.documentElement).append(style);
    }
    const titlePresentation = installTitlePresentation();

    function installTitlePresentation() {
      const titleAttribute = 'data-ywlc-queue-title', rowAttribute = 'data-ywlc-queue-presentation';
      const tooltipId = 'ywlc-queue-title-tooltip';
      let active = null;
      const setAttribute = (node, name, value) => value === null ? node.removeAttribute(name) : node.setAttribute(name, value);
      function hideTooltip(current) {
        current.tooltip?.remove();
        current.tooltip = null;
        if (current.description) {
          const { node, before, owned } = current.description, value = node.getAttribute('aria-describedby');
          if (value === owned) setAttribute(node, 'aria-describedby', before);
          else if (value?.split(/\s+/).includes(tooltipId)) {
            const remaining = value.split(/\s+/).filter(id => id && id !== tooltipId).join(' ');
            setAttribute(node, 'aria-describedby', remaining || null);
          }
          current.description = null;
        }
      }
      function dismiss() {
        const current = active; active = null; if (!current) return;
        clearTimeout(current.timer); current.observer?.disconnect();
        for (const [node, type, callback] of current.listeners) node.removeEventListener(type, callback, true);
        hideTooltip(current);
        for (const { node, value } of current.nativeTitles) if (node.getAttribute('title') === '') setAttribute(node, 'title', value);
      }
      function cancel(target = null) {
        const current = active; if (!current) return;
        if (target && !current.title.contains(target)) { dismiss(); return; }
        clearTimeout(current.timer); current.timer = 0; current.silenced = true;
        // Closing our tooltip must not re-enable the browser's tooltip while
        // the same title remains hovered or keyboard-focused.
        hideTooltip(current);
      }
      function ownTitle(target) {
        const title = target?.closest?.(`[${titleAttribute}="1"]`), row = title?.closest(rowSelector);
        const panel = row?.closest(panelSelector), record = records.get(panel);
        if (!record?.titles?.has(title) || record.titles.get(title).row !== row) return null;
        return { title, row, panel, record, listId: record.owner.data?.playlistId,
          key: controller(row)?.data?.playlistSetVideoId };
      }
      function rendered(current) {
        if (disposed || navigating || document.hidden || pending || !current.title.isConnected ||
            current.title.getAttribute(titleAttribute) !== '1' || current.row.getAttribute(rowAttribute) !== '1' ||
            records.get(current.panel) !== current.record || controller(current.panel) !== current.record.owner ||
            typeof current.listId !== 'string' || !current.listId.startsWith('TLPQ') ||
            current.record.owner.data?.playlistId !== current.listId ||
            controller(current.row)?.data?.playlistSetVideoId !== current.key || dragging(current.record.owner) ||
            current.row.parentElement !== current.record.items || !current.record.titles.has(current.title)) return false;
        for (let node = current.title; node; node = node.parentElement) {
          if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
          const css = getComputedStyle(node);
          if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.opacity === '0') return false;
        }
        const box = current.title.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
      }
      function truncated(title) {
        return title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1;
      }
      function text(title) { return (title.innerText || title.textContent || '').replace(/\s+/g, ' ').trim(); }
      function pointerInside(current) {
        const box = current.title.getBoundingClientRect(), point = current.pointer;
        return point && point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom;
      }
      function position(current) {
        const anchor = current.title.getBoundingClientRect(), box = current.tooltip.getBoundingClientRect();
        const left = Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8));
        const below = anchor.bottom + 8;
        const top = below + box.height <= innerHeight - 8 ? below : Math.max(8, anchor.top - box.height - 8);
        const nextLeft = `${Math.round(left)}px`, nextTop = `${Math.round(top)}px`;
        if (current.tooltip.style.left !== nextLeft) current.tooltip.style.left = nextLeft;
        if (current.tooltip.style.top !== nextTop) current.tooltip.style.top = nextTop;
      }
      function refresh() {
        const current = active; if (!current) return;
        if (!rendered(current) || (current.tooltip && current.tooltip.parentElement !== document.body) ||
            current.nativeTitles.some(({ node }) => node.getAttribute('title') !== '') ||
            [...current.title.querySelectorAll('[title]')].some(node => !current.nativeTitles.some(entry => entry.node === node)) ||
            (!current.focus && (!current.title.matches(':hover') || !pointerInside(current))) ||
            (current.focus && (document.activeElement !== current.focus || !current.focus.matches(':focus-visible')))) { dismiss(); return; }
        if (!current.ready || current.silenced || !truncated(current.title)) { hideTooltip(current); return; }
        const label = text(current.title); if (!label) { dismiss(); return; }
        if (!current.tooltip) {
          if (!document.body || document.getElementById(tooltipId)) { dismiss(); return; }
          const tooltip = document.createElement('div'); tooltip.id = tooltipId;
          tooltip.setAttribute('data-ywlc-queue-title-tooltip', ''); tooltip.setAttribute('role', 'tooltip');
          tooltip.textContent = label; current.tooltip = tooltip; document.body.append(tooltip);
          const node = current.focus || current.title, before = node.getAttribute('aria-describedby');
          const owned = [before, tooltipId].filter(Boolean).join(' ');
          current.description = { node, before, owned }; node.setAttribute('aria-describedby', owned);
        }
        if (current.tooltip.textContent !== label) current.tooltip.textContent = label;
        position(current);
      }
      function show(current) {
        if (active !== current) return;
        current.timer = 0; current.ready = true; refresh();
      }
      function start(found, focus = null, pointer = null) {
        if (active?.title === found.title && active.focus === focus) return;
        dismiss();
        const current = { ...found, focus, pointer, viewportWidth: innerWidth, viewportHeight: innerHeight,
          timer: 0, ready: false, silenced: false, tooltip: null, observer: null, listeners: [], nativeTitles: [], description: null };
        if (!rendered(current) || !text(current.title)) return;
        active = current;
        const nativeNodes = new Set([current.title, ...current.title.querySelectorAll('[title]')]);
        if (focus) nativeNodes.add(focus);
        for (let node = current.title.parentElement; node; node = node.parentElement) {
          if (node.hasAttribute('title')) nativeNodes.add(node); if (node === current.row) break;
        }
        // Empty title blocks inherited browser tooltips too. Preserve absence,
        // empty values and third-party updates rather than deleting attributes.
        for (const node of nativeNodes) {
          current.nativeTitles.push({ node, value: node.getAttribute('title') }); node.setAttribute('title', '');
        }
        const on = (node, type, callback) => { node.addEventListener(type, callback, true); current.listeners.push([node, type, callback]); };
        const exit = event => {
          if (current.focus) return;
          if (!current.title.contains(event.target)) { dismiss(); return; }
          const box = current.title.getBoundingClientRect();
          if (event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom) dismiss();
          else if (event.isTrusted) current.pointer = { x: event.clientX, y: event.clientY };
        };
        on(document, 'pointermove', exit);
        on(current.title, 'pointerleave', () => { if (!current.focus) dismiss(); });
        on(document, 'mouseleave', event => { if (event.target === document || event.target === document.documentElement) dismiss(); });
        on(document, 'focusout', event => { if (event.target === current.focus) dismiss(); });
        on(document, 'scroll', dismiss); on(document, 'pointercancel', dismiss);
        on(document, 'visibilitychange', () => { if (document.hidden) dismiss(); });
        on(window, 'blur', dismiss);
        on(window, 'resize', event => {
          if (event.isTrusted || innerWidth !== current.viewportWidth || innerHeight !== current.viewportHeight) dismiss();
          else refresh(); // Native Suite layout hints are not viewport changes.
        });
        current.observer = new MutationObserver(refresh);
        current.observer.observe(current.title, { childList: true, subtree: true, characterData: true, attributes: true,
          attributeFilter: ['title', 'class', 'style', 'hidden', 'aria-hidden'] });
        for (let node = current.title.parentElement; node; node = node.parentElement) current.observer.observe(node, {
          attributes: true, attributeFilter: ['title', 'class', 'style', 'hidden', 'aria-hidden'] });
        if (focus) show(current); else current.timer = setTimeout(() => show(current), 500);
      }
      function clear(record) {
        if (active?.record === record) dismiss();
        for (const [title, entry] of record.titles || []) if (title.getAttribute(titleAttribute) === '1') setAttribute(title, titleAttribute, entry.before);
        for (const [row, before] of record.titleRows || []) if (row.getAttribute(rowAttribute) === '1') setAttribute(row, rowAttribute, before);
        record.titles?.clear(); record.titleRows?.clear();
      }
      function removeClonedDescription(node) {
        if (active?.description?.node === node) return;
        const value = node.getAttribute('aria-describedby');
        if (!value?.split(/\s+/).includes(tooltipId)) return;
        const remaining = value.split(/\s+/).filter(id => id && id !== tooltipId).join(' ');
        setAttribute(node, 'aria-describedby', remaining || null);
      }
      function cleanClonedPresentation(row, record) {
        const current = active;
        if (current?.record === record && current.row !== row && !current.row.isConnected &&
            controller(row)?.data?.playlistSetVideoId === current.key) {
          const counterpart = original => {
            const path = []; let node = original;
            while (node && node !== current.row) {
              const parent = node.parentNode; if (!parent) return null;
              path.push([...parent.childNodes].indexOf(node)); node = parent;
            }
            if (node !== current.row) return null;
            let candidate = row;
            for (const index of path.reverse()) candidate = candidate?.childNodes[index];
            return candidate?.isEqualNode(original) ? candidate : null;
          };
          // Read all counterparts before restoring any attributes. Recover a
          // suppressed value only from a proven clone of the same native row.
          const titles = current.nativeTitles.map(entry => ({ ...entry, clone: counterpart(entry.node) }));
          const description = current.description && { ...current.description, clone: counterpart(current.description.node) };
          for (const { clone, value } of titles) if (clone?.getAttribute('title') === '') setAttribute(clone, 'title', value);
          if (description?.clone?.getAttribute('aria-describedby') === description.owned) {
            setAttribute(description.clone, 'aria-describedby', description.before);
          }
        }
        // Unknown restamps still must not reference a tooltip owned by an old
        // element. Leave their other attributes untouched rather than guessing.
        for (const node of [row, ...row.querySelectorAll('[aria-describedby]')]) removeClonedDescription(node);
      }
      function sync(state, record) {
        record.titles ||= new Map(); record.titleRows ||= new Map();
        const rows = new Set(state.rows), titles = new Set();
        for (const row of state.rows) {
          if (!record.titleRows.has(row)) {
            cleanClonedPresentation(row, record);
            const before = row.getAttribute(rowAttribute);
            record.titleRows.set(row, before === '1' ? null : before); row.setAttribute(rowAttribute, '1');
          }
          for (const title of row.querySelectorAll('#video-title')) {
            if (title.closest(rowSelector) !== row) continue;
            titles.add(title);
            if (!record.titles.has(title)) {
              if (active?.record === record && active.row === row && !active.title.isConnected && title.isEqualNode(active.title)) {
                const original = active.nativeTitles.find(entry => entry.node === active.title);
                if (original && title.getAttribute('title') === '') setAttribute(title, 'title', original.value);
              }
              for (const node of title.querySelectorAll('[aria-describedby]')) removeClonedDescription(node);
              for (let node = title; node; node = node.parentElement) { removeClonedDescription(node); if (node === row) break; }
              const before = title.getAttribute(titleAttribute);
              record.titles.set(title, { row, before: before === '1' ? null : before }); title.setAttribute(titleAttribute, '1');
            }
          }
        }
        for (const [title, entry] of record.titles) if (!titles.has(title)) {
          if (title.getAttribute(titleAttribute) === '1') setAttribute(title, titleAttribute, entry.before); record.titles.delete(title);
        }
        for (const [row, before] of record.titleRows) if (!rows.has(row)) {
          if (row.getAttribute(rowAttribute) === '1') setAttribute(row, rowAttribute, before); record.titleRows.delete(row);
        }
        refresh();
      }
      return { sync, clear, dismiss, cancel,
        hover(event) {
          if (!event.isTrusted) return;
          const found = ownTitle(event.target); if (found) start(found, null, { x: event.clientX, y: event.clientY });
        },
        focus(event) {
          if (!event.target?.matches?.(':focus-visible') || event.target.closest('button, .playlist-drag-handle')) return;
          const found = ownTitle(event.target) || [...(records.get(event.target.closest(panelSelector))?.titles?.keys() || [])]
            .filter(title => event.target.contains(title)).map(ownTitle).find(item => item && rendered(item));
          if (found) start(found, event.target);
        },
      };
    }

    function listen(target, type, callback) {
      target.addEventListener(type, callback, true); listeners.push([target, type, callback]);
    }
    function visible(node) {
      return Boolean(node?.isConnected && !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length);
    }
    function activePlayer() {
      const players = [...document.querySelectorAll('#movie_player')].filter(visible);
      if (players.length !== 1 || players[0].classList.contains('ad-showing') || players[0].classList.contains('ad-interrupting')) return null;
      return players[0];
    }
    function dragging(owner) {
      const reorder = owner?.ytReorderableController;
      return Boolean(reorder && Object.getOwnPropertyNames(reorder).some(name =>
        name.endsWith('dragListGroup') && reorder[name]?.isDragging?.()));
    }
    function nativeGroups(owner) {
      const reorder = owner?.ytReorderableController;
      return (reorder ? Object.getOwnPropertyNames(reorder) : []).filter(name => name.endsWith('dragListGroup'))
        .map(name => reorder[name]).filter(group => group?.addEventListener && group?.removeEventListener);
    }
    function snapshot(panel) {
      try {
        if (!visible(panel)) return null;
        const owner = controller(panel), data = owner?.data, player = activePlayer();
        if (!player || typeof data?.playlistId !== 'string' || !data.playlistId.startsWith('TLPQ') ||
            typeof owner.handleDrop !== 'function' || owner.canReorder === false ||
            !(owner.canReorder === true || panel.hasAttribute('can-reorder')) || dragging(owner) ||
            !Array.isArray(data.contents) || !data.contents.length || data.contents.length > 1000 ||
            (Number.isInteger(data.totalVideos) && data.totalVideos !== data.contents.length)) return null;
        const videos = data.contents.map(item => item.playlistPanelVideoRenderer);
        if (videos.some(video => !validId(video?.videoId) || typeof video.playlistSetVideoId !== 'string' || !video.playlistSetVideoId) ||
            new Set(videos.map(video => video.playlistSetVideoId)).size !== videos.length) return null;
        const anchor = player.getVideoData?.()?.video_id, listId = player.getPlaylistId?.();
        if (!validId(anchor) || videos.filter(video => video.videoId === anchor).length !== 1) return null;
        const ids = videos.map(video => video.videoId), playlist = player.getPlaylist?.();
        if (playlist != null && !Array.isArray(playlist)) return null;
        const mini = player.closest('ytd-miniplayer');
        if (listId !== data.playlistId && !((listId == null || listId === '') && mini && panel.closest('ytd-miniplayer') === mini &&
            Array.isArray(playlist) && same(playlist, ids))) return null;
        if (Array.isArray(playlist) && !same(playlist, ids)) return null;
        let currentIndex = data.currentIndex;
        if (!('currentIndex' in data)) {
          const selected = videos.filter(video => video.selected === true);
          if (selected.length !== 1 || selected[0].videoId !== anchor) return null;
          currentIndex = videos.indexOf(selected[0]);
        }
        if (!Number.isInteger(currentIndex) || videos[currentIndex]?.videoId !== anchor) return null;
        const items = panel.querySelector('#items'), rows = items ? [...items.children] : [];
        if (rows.length !== videos.length || rows.some((row, index) => !row.matches(rowSelector) ||
            items.childNodes[index] !== row || controller(row)?.data?.videoId !== videos[index].videoId ||
            controller(row)?.data?.playlistSetVideoId !== videos[index].playlistSetVideoId)) return null;
        return { panel, owner, player, anchor, listId: data.playlistId, videos, items, rows,
          playerListId: listId, playerPlaylist: Array.isArray(playlist) ? [...playlist] : playlist,
          keys: videos.map(video => video.playlistSetVideoId) };
      } catch { return null; }
    }
    function notify(message) {
      clearTimeout(toastTimer); toast?.remove();
      toast = document.createElement('div'); toast.setAttribute('role', 'status');
      toast.setAttribute('data-ywlc-queue-step-status', ''); toast.textContent = message;
      Object.assign(toast.style, { position: 'fixed', bottom: '24px', left: '24px', zIndex: '2202',
        padding: '12px 16px', borderRadius: '8px', background: 'var(--yt-spec-raised-background, #212121)',
        color: 'var(--yt-spec-text-primary, #fff)', font: '14px Roboto, Arial, sans-serif',
        maxWidth: 'calc(100vw - 48px)', pointerEvents: 'none' });
      document.body?.append(toast);
      toastTimer = setTimeout(() => { toast?.remove(); toast = null; toastTimer = 0; }, 3000);
    }
    function disableAll() {
      for (const record of records.values()) for (const entry of record.controls.values()) {
        if (!entry.up.disabled) entry.up.disabled = true;
        if (!entry.down.disabled) entry.down.disabled = true;
      }
    }
    function currentControls(row, entry) {
      if (!entry || row.querySelector('.playlist-drag-handle') !== entry.handle ||
          !entry.handle.hasAttribute('data-ywlc-queue-step-controls') ||
          entry.handle.querySelectorAll(controlSelector).length !== 2) return false;
      return [['up', entry.up], ['down', entry.down]].every(([direction, button]) =>
        button.parentElement === entry.handle && button.getAttribute('data-ywlc-queue-step') === direction &&
        button.querySelector('svg path')?.getAttribute('d') === arrowPaths[direction]);
    }
    function removeControls(entry) {
      entry.up.remove(); entry.down.remove(); entry.handle.removeAttribute('data-ywlc-queue-step-controls');
    }
    function clearRecord(panel) {
      const record = records.get(panel); if (!record) return;
      record.observer.disconnect();
      titlePresentation.clear(record);
      for (const [group, type, callback] of record.groups) { try { group.removeEventListener(type, callback); } catch { /* Native disposal may already have run. */ } }
      for (const entry of record.controls.values()) removeControls(entry);
      records.delete(panel);
    }
    function finish(message) {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      if (message) notify(message);
      schedule();
    }
    function rollbackOwned(operation) {
      try {
        const { panel, owner, player, anchor, listId, playerListId, playerPlaylist, items, rows, row, expected, keys, from } = operation;
        if (!panel.isConnected || controller(panel) !== owner || activePlayer() !== player ||
            player.getVideoData?.()?.video_id !== anchor || owner.data?.playlistId !== listId || dragging(owner) ||
            panel.querySelector('#items') !== items || !same(owner.data.contents.map(item => item.playlistPanelVideoRenderer?.playlistSetVideoId), keys)) return false;
        // Native dispatch can change the player before its renderer catches up.
        // Restore only while both original player bindings remain provable.
        const playlist = player.getPlaylist?.();
        if (player.getPlaylistId?.() !== playerListId || (Array.isArray(playerPlaylist)
          ? !Array.isArray(playlist) || !same(playlist, playerPlaylist)
          : playerPlaylist != null || playlist !== playerPlaylist)) return false;
        const current = [...items.children];
        if (current.length !== rows.length || !same(current.map(item => controller(item)?.data?.playlistSetVideoId), expected) ||
            current.some(item => !rows.includes(item))) return false;
        items.insertBefore(row, rows[from + 1] || null);
        return true;
      } catch { return false; }
    }
    function confirmPending() {
      if (!pending) return;
      const operation = pending;
      try {
        const player = activePlayer();
        if (!operation.panel.isConnected || player !== operation.player || player.getVideoData?.()?.video_id !== operation.anchor) {
          finish('Playback or queue changed; no further queue move was made.'); return;
        }
        const current = snapshot(operation.panel);
        if (current && current.owner === operation.owner && current.listId === operation.listId && same(current.keys, operation.expected)) {
          if (document.activeElement === document.body || operation.panel.contains(document.activeElement)) {
            focusRequest = { panel: current.panel, key: operation.keys[operation.from], direction: operation.direction };
          }
          finish();
        }
      } catch { /* Wait only until the bounded timeout for native confirmation. */ }
    }
    function ensureRecord(state) {
      let record = records.get(state.panel);
      const groups = nativeGroups(state.owner);
      if (record && (record.items !== state.items || record.owner !== state.owner || !same(record.groupRefs, groups))) {
        clearRecord(state.panel); record = null;
      }
      if (record) return record;
      record = { items: state.items, owner: state.owner, controls: new Map(), groups: [], groupRefs: groups, nativeDragging: false, observer: null };
      record.observer = new MutationObserver(mutations => {
        // Native Like/Dislike SVG animations are unrelated to our two glyphs.
        if (!record.nativeDragging && mutations.some(mutation => mutation.attributeName !== 'd' ||
            mutation.target.closest?.(controlSelector))) schedule();
      });
      record.observer.observe(state.panel, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['selected', 'can-reorder', 'hidden', 'aria-hidden',
          'data-ywlc-queue-step-controls', 'data-ywlc-queue-step', 'd'] });
      if (state.panel.parentElement) record.observer.observe(state.panel.parentElement, { childList: true });
      for (const group of groups) {
        const start = () => { titlePresentation.dismiss(); record.nativeDragging = true; disableAll(); };
        const end = () => { record.nativeDragging = false; schedule(); };
        for (const [type, callback] of [['dragstart', start], ['dragend', end], ['e', end]]) {
          group.addEventListener(type, callback); record.groups.push([group, type, callback]);
        }
      }
      records.set(state.panel, record); return record;
    }
    function createButton(direction) {
      const button = document.createElement('button'); button.type = 'button';
      button.setAttribute('data-ywlc-queue-step', direction);
      button.setAttribute('aria-label', direction === 'up' ? 'Move up in queue' : 'Move down in queue');
      button.title = direction === 'up' ? 'Move up in queue' : 'Move down in queue';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', arrowPaths[direction]);
      svg.append(path); button.append(svg); return button;
    }
    function reconcile() {
      frame = 0; if (disposed || navigating) return;
      confirmPending();
      if (pending) { disableAll(); return; }
      // Keep the native handle and listeners stable throughout native dragging.
      if ([...records.keys()].some(panel => {
        try { return panel.isConnected && dragging(controller(panel)); } catch { return false; }
      })) { disableAll(); return; }
      const states = [...document.querySelectorAll(panelSelector)].map(snapshot).filter(Boolean);
      // Two native panels for the active queue are ambiguous during transitions.
      const state = states.length === 1 ? states[0] : null;
      for (const panel of records.keys()) if (!state || panel !== state.panel) clearRecord(panel);
      if (!state) return;
      const record = ensureRecord(state);
      titlePresentation.sync(state, record);
      const rowSet = new Set(state.rows);
      for (const [row, entry] of record.controls) if (!rowSet.has(row) || !currentControls(row, entry)) {
        removeControls(entry); record.controls.delete(row);
      }
      state.rows.forEach((row, index) => {
        let entry = record.controls.get(row);
        if (!entry) {
          const handle = row.querySelector('.playlist-drag-handle');
          if (!handle || handle.closest('button')) return;
          // Native restamping may clone our previous light-DOM controls. They
          // carry no live ownership; replace only those marked copies.
          for (const child of handle.querySelectorAll(controlSelector)) child.remove();
          handle.removeAttribute('data-ywlc-queue-step-controls');
          entry = { handle, up: createButton('up'), down: createButton('down') };
          handle.setAttribute('data-ywlc-queue-step-controls', ''); handle.prepend(entry.up); handle.append(entry.down);
          record.controls.set(row, entry);
        }
        const atStart = index === 0, atEnd = index === state.rows.length - 1;
        if (entry.up.disabled !== atStart) entry.up.disabled = atStart;
        if (entry.down.disabled !== atEnd) entry.down.disabled = atEnd;
      });
      if (focusRequest?.panel === state.panel) {
        const request = focusRequest; focusRequest = null;
        const entry = record.controls.get(state.rows[state.keys.indexOf(request.key)]);
        const preferred = request.direction === 'up' ? entry?.up : entry?.down;
        const fallback = request.direction === 'up' ? entry?.down : entry?.up;
        const target = preferred && !preferred.disabled ? preferred : fallback;
        if (target && !target.disabled) queueMicrotask(() => {
          if (target.isConnected && !target.disabled && (document.activeElement === document.body || state.panel.contains(document.activeElement))) target.focus({ preventScroll: true });
        });
      }
    }
    function schedule() {
      if (!disposed && !navigating && !frame) frame = requestAnimationFrame(reconcile);
    }
    function activate(event) {
      const button = event.target?.closest?.(controlSelector); if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.isTrusted || button.disabled || pending || navigating || disposed) return;
      const panel = button.closest(panelSelector), row = button.closest(rowSelector);
      const entry = records.get(panel)?.controls.get(row), state = panel && snapshot(panel);
      if (!entry || !state || !currentControls(row, entry) || (button !== entry.up && button !== entry.down)) { schedule(); return; }
      const from = state.rows.indexOf(row), direction = button === entry.up ? 'up' : 'down';
      const to = from + (direction === 'up' ? -1 : 1);
      if (from < 0 || to < 0 || to >= state.rows.length) { schedule(); return; }
      const expected = [...state.keys]; expected.splice(to, 0, expected.splice(from, 1)[0]);
      const operation = pending = { ...state, row, from, direction, expected, timer: 0 };
      disableAll();
      operation.timer = setTimeout(() => {
        if (pending !== operation) return;
        confirmPending();
        if (pending === operation) {
          const restored = rollbackOwned(operation);
          finish(restored ? 'The queue did not confirm the move. Please try again.' : 'The queue changed. Check its order before trying again.');
        }
      }, 3000);
      try {
        state.items.insertBefore(row, direction === 'up' ? state.rows[to] : state.rows[to].nextSibling);
        state.owner.handleDrop({ currDragItem: row }); confirmPending();
      }
      catch {
        const restored = rollbackOwned(operation);
        finish(restored ? 'Could not move this queue item. Please try again.' : 'The queue changed. Check its order before trying again.');
      }
      schedule();
    }
    function guardPointer(event) {
      titlePresentation.cancel(event.target);
      const button = event.target?.closest?.(controlSelector);
      if (button) { event.stopImmediatePropagation(); return; }
      if (pending && event.target?.closest?.('.playlist-drag-handle')?.closest(panelSelector) === pending.panel) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }
    function suspend() {
      navigating = true;
      titlePresentation.dismiss();
      if (frame) cancelAnimationFrame(frame); frame = 0;
      if (pending) { rollbackOwned(pending); clearTimeout(pending.timer); }
      pending = null;
      focusRequest = null;
      for (const panel of records.keys()) clearRecord(panel);
      clearTimeout(toastTimer); toast?.remove(); toast = null; toastTimer = 0;
    }
    listen(document, 'pointerdown', guardPointer); listen(document, 'mousedown', guardPointer);
    listen(document, 'click', activate);
    listen(document, 'keydown', event => {
      if (event.key === 'Escape') titlePresentation.cancel();
      if (event.target?.closest?.(controlSelector) && (event.key === 'Enter' || event.key === ' ')) event.stopImmediatePropagation();
    });
    for (const type of ['pointerover', 'focusin']) listen(document, type, event => {
      const panel = event.target?.closest?.(panelSelector);
      // Most tracked panels reconcile through scoped mutations. Also repair
      // only the hovered/focused row if native stamping invalidated its owned
      // controls without an observed event; ordinary hover does no queue scan.
      const record = panel && records.get(panel), row = event.target?.closest?.(rowSelector);
      if (panel && (!record || (row && !currentControls(row, record.controls.get(row))))) schedule();
      if (panel && records.has(panel)) {
        if (event.type === 'pointerover') titlePresentation.hover(event);
        else titlePresentation.focus(event);
      }
    });
    for (const type of ['yt-playlist-data-updated', 'yt-page-data-updated']) listen(window, type, schedule);
    listen(window, 'yt-rendererstamper-finished', event => { if (event.target?.closest?.(panelSelector)) schedule(); });
    listen(window, 'yt-navigate-start', suspend); listen(window, 'pagehide', suspend);
    for (const type of ['yt-navigate-finish', 'pageshow']) listen(window, type, () => { navigating = false; schedule(); });
    schedule();
    return () => {
      suspend(); disposed = true;
      for (const [target, type, callback] of listeners) target.removeEventListener(type, callback, true);
      if (sharedStyle) suite.removeStyle('watchLayoutCleanerQueueSteps');
      else style?.remove();
    };
  }

  function installQueueDragAssistance() {
    const panelSelector =
      "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector =
      "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    const placeholderAttribute = "data-ywlc-drag-placeholder";
    let gesture = null;

    function setMarkerStyle(css) {
      const style = document.createElement("style");
      style.id = "tm-youtube-watch-layout-cleaner-drag";
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      return style;
    }

    function removeMarkerStyle(style) {
      style?.remove();
    }

    function release(callback) {
      try {
        callback();
      } catch {
        // Native teardown or another script may already have released it.
      }
    }

    function clearGesture() {
      const current = gesture;
      if (!current) return;
      gesture = null;
      current.groupListeners.forEach(([type, listener]) => {
        release(() => current.group.removeEventListener(type, listener));
      });
      current.domListeners.forEach(([target, type, listener]) => {
        release(() => target.removeEventListener(type, listener, true));
      });
      release(() => current.observer?.disconnect());
      release(() => current.motionQuery?.removeEventListener(
        "change", current.motionListener,
      ));
      clearAnimations(current);
      release(() => {
        if (current.marker?.getAttribute(placeholderAttribute) === "1") {
          current.marker.removeAttribute(placeholderAttribute);
        }
      });
      release(() => removeMarkerStyle(current.markerStyle));
      release(() => {
        const style = current.items.style;
        if (
          current.anchor &&
          style.getPropertyValue("overflow-anchor") === "none" &&
          style.getPropertyPriority("overflow-anchor") === ""
        ) {
          if (current.anchor.value) {
            style.setProperty(
              "overflow-anchor", current.anchor.value, current.anchor.priority,
            );
          } else {
            style.removeProperty("overflow-anchor");
          }
        }
      });
      release(() => {
        if (
          current.support && current.scrollDelta &&
          current.support.calculateScrollDelta === current.scrollDelta
        ) {
          // The native timer stays native-owned; discard only our cached step.
          release(() => {
            if (current.support.scrollDelta_) current.support.scrollDelta_.y = 0;
          });
          if (current.scrollDescriptor) {
            Object.defineProperty(
              current.support,
              "calculateScrollDelta",
              current.scrollDescriptor,
            );
          } else {
            delete current.support.calculateScrollDelta;
          }
        }
      });
    }

    function clearAnimations(current = gesture) {
      if (!current?.animations) return;
      current.animations.forEach((animation) => release(() => animation.cancel()));
      current.animations.clear();
      current.positions.clear();
    }

    function ownsNativeDrag(current) {
      return Boolean(
        current === gesture &&
          current.panel.isConnected &&
          current.items.isConnected &&
          current.row.parentElement === current.items &&
          (current.panel.polymerController ||
            current.panel.getPolymerController?.() || current.panel) ===
            current.owner &&
          (current.owner.ytReorderableController ||
            current.panel.ytReorderableController) === current.controller &&
          Object.getOwnPropertyDescriptor(
            current.controller, current.groupProperty,
          )?.value === current.group &&
          current.group.currDragItem_ === current.row &&
          current.group.isDragging() &&
          current.controller.dragScrollSupport === current.support,
      );
    }

    function visibleScrollBounds(items) {
      const rect = items.getBoundingClientRect();
      const bounds = {
        left: Math.max(0, rect.left),
        right: Math.min(window.innerWidth, rect.right),
        top: Math.max(0, rect.top),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
      for (let element = items; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) {
          return null;
        }
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const clip = element.getBoundingClientRect();
        if (clipX) {
          bounds.left = Math.max(bounds.left, clip.left);
          bounds.right = Math.min(bounds.right, clip.right);
        }
        if (clipY) {
          bounds.top = Math.max(bounds.top, clip.top);
          bounds.bottom = Math.min(bounds.bottom, clip.bottom);
        }
      }
      return bounds.right > bounds.left && bounds.bottom > bounds.top
        ? bounds
        : null;
    }

    function innerContainer(row) {
      return Array.from(row.children).find((child) => child.id === "container");
    }

    function recordPositions() {
      const current = gesture;
      if (!current?.active || !ownsNativeDrag(current)) {
        clearGesture();
        return;
      }
      current.positions.clear();
      if (current.motionQuery?.matches) {
        clearAnimations(current);
        return;
      }
      const bounds = visibleScrollBounds(current.items);
      if (!bounds) return;
      const rows = Array.from(current.items.children);
      const index = rows.indexOf(current.row);
      // Bound geometry reads even for long queues; only neighbours can shift.
      const neighbours = rows.slice(Math.max(0, index - 20), index + 21);
      neighbours.forEach((row) => {
        if (
          row === current.row ||
          !row.matches(rowSelector) ||
          current.group.draggerEl_?.contains(row) ||
          getComputedStyle(row).visibility !== "visible"
        ) {
          return;
        }
        const inner = innerContainer(row);
        if (!inner || typeof inner.animate !== "function") return;
        const ownedAnimation = current.animations.get(inner);
        if (
          (inner.getAnimations?.() || []).some(
            (animation) => animation !== ownedAnimation,
          ) ||
          (!ownedAnimation && getComputedStyle(inner).transform !== "none")
        ) {
          return;
        }
        const rect = inner.getBoundingClientRect();
        if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return;
        current.positions.set(inner, rect.top);
        ownedAnimation?.cancel();
        current.animations.delete(inner);
      });
    }

    function animatePositions() {
      const current = gesture;
      if (!current?.active || !ownsNativeDrag(current)) {
        clearGesture();
        return;
      }
      if (current.motionQuery?.matches) {
        clearAnimations(current);
        return;
      }
      current.positions.forEach((top, inner) => {
        if (
          !inner.isConnected ||
          inner.parentElement?.parentElement !== current.items ||
          inner.parentElement === current.row ||
          getComputedStyle(inner).transform !== "none" ||
          (inner.getAnimations?.() || []).length
        ) {
          return;
        }
        const delta = top - inner.getBoundingClientRect().top;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1) return;
        const animation = inner.animate(
          [
            { transform: `translateY(${delta}px)` },
            { transform: "none" },
          ],
          { duration: 120, easing: "ease-out" },
        );
        current.animations.set(inner, animation);
        animation.onfinish = () => {
          if (current.animations.get(inner) === animation) {
            current.animations.delete(inner);
          }
        };
      });
      current.positions.clear();
    }

    function beginNativeDrag() {
      const current = gesture;
      if (!current || current.active) return;
      const support = current.controller.dragScrollSupport;
      if (
        current.group.currDragItem_ !== current.row ||
        !current.group.isDragging() ||
        support?.containerNode_ !== current.items ||
        support.horizontalScrolling_ !== false ||
        typeof support.calculateScrollDelta !== "function"
      ) {
        clearGesture();
        return;
      }
      current.support = support;
      current.scrollDescriptor = Object.getOwnPropertyDescriptor(
        support,
        "calculateScrollDelta",
      );
      current.scrollDelta = () => {
        try {
          if (!ownsNativeDrag(current) || document.hidden) {
            clearGesture();
            return 0;
          }
          const bounds = visibleScrollBounds(current.items);
          const { x, y } = current.pointer;
          if (
            !bounds ||
            x < bounds.left ||
            x > bounds.right ||
            y < bounds.top ||
            y > bounds.bottom
          ) {
            return 0;
          }
          const edge = Math.min(40, (bounds.bottom - bounds.top) / 2);
          const upwards = y < bounds.top + edge;
          const distance = upwards
            ? bounds.top + edge - y
            : y - (bounds.bottom - edge);
          if (distance <= 0) return 0;
          const step = Math.min(16, (distance / edge) * 16);
          const available = upwards
            ? current.items.scrollTop
            : current.items.scrollHeight - current.items.clientHeight -
              current.items.scrollTop;
          return available > 0 ? (upwards ? -1 : 1) * Math.min(step, available) : 0;
        } catch {
          clearGesture();
          return 0;
        }
      };
      try {
        support.calculateScrollDelta = current.scrollDelta;
        if (support.calculateScrollDelta !== current.scrollDelta) {
          clearGesture();
          return;
        }
      } catch {
        clearGesture();
        return;
      }
      current.active = true;
      const listStyle = current.items.style;
      if (typeof listStyle?.getPropertyValue === "function") {
        current.anchor = {
          value: listStyle.getPropertyValue("overflow-anchor"),
          priority: listStyle.getPropertyPriority("overflow-anchor"),
        };
        // Native placeholder movement must not pull the scrollport with it.
        listStyle.setProperty("overflow-anchor", "none");
      }
      const inner = innerContainer(current.row);
      if (
        inner &&
        !inner.hasAttribute(placeholderAttribute) &&
        ["relative", "absolute", "fixed", "sticky"].includes(
          getComputedStyle(inner).position,
        )
      ) {
        // Reveal only an empty outline, never the hidden row's real contents.
        const style = setMarkerStyle(`[${placeholderAttribute}="1"]::after {
  content: "";
  position: absolute;
  inset: 3px;
  visibility: visible;
  pointer-events: none;
  border: 1px solid var(--yt-spec-call-to-action, #3ea6ff);
  border-radius: 4px;
  box-sizing: border-box;
}`);
        current.marker = inner;
        current.markerStyle = style;
        inner.setAttribute(placeholderAttribute, "1");
      }
    }

    function armDrag(event) {
      if (
        !event.isTrusted || event.button !== 0 || document.hidden ||
        event.ctrlKey || event.altKey || event.metaKey ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)
      ) {
        return;
      }
      clearGesture();
      const target = event.target;
      if (
        !target?.closest ||
        target.closest(
          'button, input, textarea, select, [role="button"], ' +
            '[contenteditable]:not([contenteditable="false"])',
        )
      ) {
        return;
      }
      const row = target.closest(rowSelector);
      const panel = row?.closest(panelSelector);
      const items = row?.parentElement;
      if (
        !panel?.isConnected ||
        items?.id !== "items" ||
        panel.querySelector("#items") !== items ||
        (!panel.closest("ytd-miniplayer") &&
          location.pathname !== "/watch" &&
          !location.pathname.startsWith("/live/")) ||
        !visibleScrollBounds(items)
      ) {
        return;
      }
      let owner;
      let controller;
      let group;
      let groupProperty;
      try {
        owner = panel.polymerController ||
          panel.getPolymerController?.() || panel;
        if (owner.canReorder === false || panel.canReorder === false) return;
        controller = owner.ytReorderableController ||
          panel.ytReorderableController;
        if (!controller) return;
        const entry = Object.getOwnPropertyNames(controller)
          .filter((name) => name.endsWith("dragListGroup"))
          .map((name) => ({
            name, value: Object.getOwnPropertyDescriptor(controller, name)?.value,
          }))
          .find(({ value }) =>
            value &&
            typeof value.addEventListener === "function" &&
            typeof value.removeEventListener === "function" &&
            typeof value.isDragging === "function" &&
            typeof value.getHandleForDragItem_ === "function",
          );
        group = entry?.value;
        groupProperty = entry?.name;
        if (!group || group.isDragging()) return;
        const handle = group.getHandleForDragItem_(row);
        if (!handle || !row.contains(handle) || !handle.contains(target)) return;
      } catch {
        return;
      }
      const current = {
        panel, items, row, owner, controller, group, groupProperty,
        pointer: { x: event.clientX, y: event.clientY },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        active: false,
        groupListeners: [],
        domListeners: [],
        animations: new Map(),
        positions: new Map(),
        motionQuery: typeof matchMedia === "function"
          ? matchMedia("(prefers-reduced-motion: reduce)")
          : null,
      };
      gesture = current;
      function listen(target, type, listener) {
        current.domListeners.push([target, type, listener]);
        target.addEventListener(type, listener, true);
      }
      [
        ["dragstart", beginNativeDrag],
        ["beforedragmove", recordPositions],
        ["dragmove", animatePositions],
        ["dragend", clearGesture],
        ["e", clearGesture],
      ].forEach(([type, listener]) => {
        const guarded = (...args) => {
          try {
            listener(...args);
          } catch {
            // Never let assistance interrupt native insertBefore/drop handling.
            clearGesture();
          }
        };
        current.groupListeners.push([type, guarded]);
        group.addEventListener(type, guarded);
      });
      listen(document, "mousemove", (move) => {
        if (!move.isTrusted) return;
        if (
          !(move.buttons & 1) ||
          !Number.isFinite(move.clientX) || !Number.isFinite(move.clientY)
        ) {
          clearGesture();
          return;
        }
        current.pointer = { x: move.clientX, y: move.clientY };
      });
      listen(document, "mouseup", clearGesture);
      listen(document, "pointercancel", clearGesture);
      listen(document, "keydown", (key) => {
        if (key.key === "Escape") clearGesture();
      });
      listen(document, "visibilitychange", () => {
        if (document.hidden) clearGesture();
      });
      ["blur", "pagehide", "yt-navigate-start"].forEach((type) => {
        listen(window, type, clearGesture);
      });
      listen(window, "resize", (resize) => {
        // Suite/YouTube layout notifications are not actual viewport changes.
        if (
          resize.isTrusted ||
          window.innerWidth !== current.viewport.width ||
          window.innerHeight !== current.viewport.height
        ) {
          clearGesture();
        }
      });
      current.motionListener = () => clearAnimations(current);
      current.motionQuery?.addEventListener("change", current.motionListener);
      if (typeof MutationObserver === "function") {
        current.observer = new MutationObserver(() => {
          if (!panel.isConnected || !items.isConnected || !items.contains(row)) {
            clearGesture();
          }
        });
        current.observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    }

    const onMouseDown = (event) => {
      try {
        armDrag(event);
      } catch {
        clearGesture();
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      clearGesture();
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }

  const scheduleQueuePlayingMarkerReconciliation = installQueuePlayingMarkerReconciliation();
  installQueuePlayNext();
  installQueueStepControls();
  installQueueDragAssistance();
  ensureStyle();
  scheduleQueueThumbnailFallbacks();

  const narrowLayoutMediaQuery = matchMedia(
    `(max-width: ${px(CONFIG.queueLayoutBreakpointPx)})`,
  );
  narrowLayoutMediaQuery.addEventListener(
    "change",
    scheduleQueueThumbnailFallbacks,
  );
  const relatedVideosMediaQuery = matchMedia(
    `(max-width: ${px(CONFIG.relatedVideosHideBreakpointPx)})`,
  );
  relatedVideosMediaQuery.addEventListener(
    "change",
    scheduleSecondaryRailStateReconciliation,
  );

  // YouTube is an SPA; re-apply after in-site navigation
  window.addEventListener(
    "yt-navigate-finish",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
  window.addEventListener(
    "yt-page-data-updated",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
  window.addEventListener(
    "pageshow",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
})();
