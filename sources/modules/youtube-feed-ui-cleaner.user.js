// ==UserScript==
// @name         YouTube Feed UI Cleaner
// @namespace    Citizen.youtube.feed-ui-cleaner
// @version      2.7
// @description  Removes unwanted YouTube UI and filtered feed cards, reconciles recycled renderers, and offers a temporary non-ad reveal control.
// @author       Citizen
// @homepageURL  https://github.com/noswimmingplease/youtube-feed-ui-cleaner
// @supportURL   https://github.com/noswimmingplease/youtube-feed-ui-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-feed-ui-cleaner/main/youtube-feed-ui-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-feed-ui-cleaner/main/youtube-feed-ui-cleaner.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    hideStaticUi: true,
    tightenFeedGrid: true,
    filterProfiles: {
      default: { mixes: true, membersOnly: true, podcasts: true },
      home: { mixes: true, membersOnly: true, podcasts: true },
      subscriptions: { mixes: true, membersOnly: true, podcasts: true },
      search: { mixes: true, membersOnly: true, podcasts: true },
      history: { mixes: true, membersOnly: true, podcasts: true },
    },
    showTemporaryRevealControl: true,
  };

  const STATIC_HIDE_SELECTORS = [
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(2)',
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(4)',
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(5)',
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(6)',
    'ytd-guide-collapsible-entry-renderer.ytd-guide-collapsible-section-entry-renderer.style-scope',
    'ytd-guide-entry-renderer.ytd-guide-collapsible-section-entry-renderer.style-scope:nth-of-type(1)',
    '#guide-links-primary',
    '#guide-links-secondary',
    '#copyright',
    'ytd-guide-renderer #footer',
    'ytd-guide-renderer #guide-links-primary',
    'ytd-guide-renderer #guide-links-secondary',
    'ytd-guide-renderer #copyright',
    'ytd-mini-guide-renderer #copyright',
    'tp-yt-app-drawer #copyright',
    'ytd-browse ytd-feed-filter-chip-bar-renderer #chips-content.ytd-feed-filter-chip-bar-renderer',
    'ytd-browse ytd-feed-filter-chip-bar-renderer #chips-wrapper.ytd-feed-filter-chip-bar-renderer',
    'ytd-browse ytd-rich-grid-renderer ytd-rich-section-renderer',
    'ytd-browse ytd-rich-grid-renderer ytd-rich-item-renderer:has(ytd-feed-nudge-renderer)',
    'ytd-masthead #voice-search-button',
    'ytd-masthead ytd-notification-topbar-button-renderer',
    'ytd-masthead #notification-button',
    'ytd-masthead #create-button',
    'ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])',
    'ytd-masthead button[aria-label="Create"]',
  ];

  const MIX_BADGE_SELECTOR = [
    '.ytThumbnailOverlayBadgeViewModelHost',
    'ytd-thumbnail-overlay-bottom-panel-renderer',
    'ytd-thumbnail-overlay-time-status-renderer',
    'badge-shape',
    '.badge-shape-wiz',
  ].join(',');

  const MEMBERS_ONLY_SELECTOR = [
    '#meta > ytd-badge-supported-renderer.video-badge.style-scope.ytd-rich-grid-media > div.badge.badge-style-type-members-only.style-scope.ytd-badge-supported-renderer.style-scope.ytd-badge-supported-renderer',
    'div.ytContentMetadataViewModelMetadataRow.ytContentMetadataViewModelMetadataRowMetadataRowWrap',
  ].join(',');

  const PODCAST_LINK_SELECTOR = [
    'a[href^="/playlist?list="]',
    'a[href*="youtube.com/playlist?list="]',
  ].join(',');

  const AD_SLOT_SELECTOR = [
    'ytd-ad-slot-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
  ].join(',');

  const OUTER_CONTAINER_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytm-rich-item-renderer',
    'ytm-video-with-context-renderer',
    'ytd-ad-slot-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
  ].join(',');

  const INNER_CONTAINER_SELECTORS = [
    'ytd-rich-grid-media',
    'yt-lockup-view-model',
    'ytm-lockup-view-model',
  ].join(',');

  const EXCLUDED_ANCESTOR_SELECTORS = [
    'ytd-popup-container',
    'tp-yt-iron-dropdown',
    'ytd-menu-popup-renderer',
    'ytd-miniplayer',
    'ytd-miniplayer-ui',
    'ytd-miniplayer-bar-renderer',
    'ytd-playlist-panel-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-playlist-panel-renderer #items',
    'ytd-watch-flexy[playlist]',
    'ytd-engagement-panel-section-list-renderer',
  ].join(',');

  const FEED_SURFACE_SELECTOR = [
    'ytd-browse ytd-rich-grid-renderer',
    'ytd-two-column-browse-results-renderer ytd-rich-grid-renderer',
    'ytd-two-column-search-results-renderer #contents',
  ].join(',');

  const FEED_CONTENTS_SELECTOR = 'ytd-browse ytd-rich-grid-renderer #contents.ytd-rich-grid-renderer';

  const HIDDEN_FLAG = 'data-clean-up-youtube-hidden';
  const HIDDEN_REASON_ATTRIBUTE = 'data-clean-up-youtube-reason';
  const PERMANENT_HIDDEN_FLAG = 'data-clean-up-youtube-permanent-hidden';
  const FILTER_REVEAL_ATTRIBUTE = 'data-yt-master-show-filtered';
  const FILTER_TOGGLE_ID = 'yt-master-filter-toggle';
  const FILTERED_CARD_SELECTOR = [
    `[${HIDDEN_FLAG}="1"]`,
    '[data-ytppl-upcoming-hidden="1"]',
    '[data-ytppl-pay-to-watch-hidden="1"]',
    '[data-ytppl-watched-hidden="1"]',
  ].join(',');

  function getText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function isInsideExcludedSurface(el) {
    return Boolean(el.closest(EXCLUDED_ANCESTOR_SELECTORS));
  }

  function isMixBadge(el) {
    return /^mix$/i.test(getText(el));
  }

  function isFullPodcastLink(el) {
    return /^view full podcast$/i.test(getText(el));
  }

  function isMembersOnlyMatch(el) {
    return /members only/i.test(getText(el));
  }

  function getFilterProfileName() {
    if (location.pathname === '/' || location.pathname === '/feed/recommended') {
      return 'home';
    }
    if (location.pathname === '/feed/subscriptions') {
      return 'subscriptions';
    }
    if (location.pathname === '/results') {
      return 'search';
    }
    if (location.pathname === '/feed/history') {
      return 'history';
    }
    return 'default';
  }

  function getFilterProfile() {
    const profiles = CONFIG.filterProfiles || {};
    return profiles[getFilterProfileName()] || profiles.default || {};
  }

  function isRuntimeFeedRoute() {
    return !(
      location.pathname === '/watch' ||
      location.pathname.startsWith('/live/') ||
      location.pathname.startsWith('/shorts/')
    );
  }

  const CARD_FILTERS = [
    {
      key: 'mixes',
      reason: 'Mix',
      selector: MIX_BADGE_SELECTOR,
      matches: isMixBadge,
    },
    {
      key: 'membersOnly',
      reason: 'Members only',
      selector: MEMBERS_ONLY_SELECTOR,
      matches: isMembersOnlyMatch,
    },
    {
      key: 'podcasts',
      reason: 'Podcast',
      selector: PODCAST_LINK_SELECTOR,
      matches: isFullPodcastLink,
    },
    {
      key: 'advertisement',
      reason: 'Advertisement',
      selector: AD_SLOT_SELECTOR,
      matches: () => true,
      permanent: true,
    },
  ];
  const FILTER_MUTATION_TRIGGER_SELECTOR = [
    MIX_BADGE_SELECTOR,
    MEMBERS_ONLY_SELECTOR,
    PODCAST_LINK_SELECTOR,
    `[${HIDDEN_FLAG}]`,
    `[${PERMANENT_HIDDEN_FLAG}]`,
  ].join(',');

  function buildHideCss(selectors) {
    return `
    ${selectors.join(',\n    ')} {
      display: none !important;
    }
  `;
  }

  function buildStaticCss() {
    return CONFIG.hideStaticUi ? buildHideCss(STATIC_HIDE_SELECTORS) : '';
  }

  function buildFeedGridCss() {
    if (!CONFIG.tightenFeedGrid) return '';

    return `
    ${FEED_CONTENTS_SELECTOR} {
      padding-top: 16px !important;
      padding-left: 24px !important;
      padding-right: 24px !important;
    }
  `;
  }

  function buildFilteredCardCss() {
    return `
    [${PERMANENT_HIDDEN_FLAG}="1"] {
      display: none !important;
    }

    :root:not([${FILTER_REVEAL_ATTRIBUTE}="1"]) [${HIDDEN_FLAG}="1"] {
      display: none !important;
    }

    #${FILTER_TOGGLE_ID} {
      position: fixed !important;
      bottom: 16px !important;
      left: 16px !important;
      z-index: 2200 !important;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,.2)) !important;
      border-radius: 18px !important;
      padding: 7px 12px !important;
      background: var(--yt-spec-raised-background, #272727) !important;
      color: var(--yt-spec-text-primary, #fff) !important;
      cursor: pointer !important;
      font: 500 12px/16px Roboto, Arial, sans-serif !important;
      box-shadow: 0 2px 8px rgba(0,0,0,.3) !important;
    }

    #${FILTER_TOGGLE_ID}:focus-visible {
      outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff) !important;
      outline-offset: 2px !important;
    }
  `;
  }

  function buildCss() {
    return [
      buildStaticCss(),
      buildFeedGridCss(),
      buildFilteredCardCss(),
    ].filter(css => css.trim()).join('\n');
  }

  function getCardContainer(el) {
    return (
      el?.closest?.(OUTER_CONTAINER_SELECTORS) ||
      el?.closest?.(INNER_CONTAINER_SELECTORS) ||
      null
    );
  }

  function collectMatchingElements(root, selector) {
    const elements = new Set();
    if (!root || !root.querySelectorAll) return elements;

    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      elements.add(root);
    }
    root.querySelectorAll(selector).forEach((el) => elements.add(el));
    return elements;
  }

  function addContainerMatch(matchesByContainer, el, filter) {
    if (isInsideExcludedSurface(el) || !filter.matches(el)) return;

    const container = getCardContainer(el);
    if (!container || isInsideExcludedSurface(container)) return;

    const current = matchesByContainer.get(container) || {
      permanent: false,
      reasons: new Set(),
    };
    current.permanent ||= Boolean(filter.permanent);
    current.reasons.add(filter.reason);
    matchesByContainer.set(container, current);
  }

  function addPreviouslyFilteredContainers(containers, root) {
    collectMatchingElements(
      root,
      `[${HIDDEN_FLAG}], [${PERMANENT_HIDDEN_FLAG}]`,
    ).forEach((container) => containers.add(container));

    const rootElement = root?.nodeType === Node.ELEMENT_NODE ? root : null;
    const closest = rootElement?.closest?.(
      `[${HIDDEN_FLAG}], [${PERMANENT_HIDDEN_FLAG}]`,
    );
    if (closest) containers.add(closest);
  }

  function reconcileFilteredCards(root = document) {
    const matchesByContainer = new Map();
    const containers = new Set();
    const profile = getFilterProfile();

    CARD_FILTERS.forEach((filter) => {
      if (!filter.permanent && profile[filter.key] === false) return;

      collectMatchingElements(root, filter.selector).forEach((el) =>
        addContainerMatch(matchesByContainer, el, filter),
      );
    });

    matchesByContainer.forEach((_match, container) => containers.add(container));
    addPreviouslyFilteredContainers(containers, root);

    containers.forEach((container) => {
      const match = matchesByContainer.get(container);
      if (!match) {
        container.removeAttribute(HIDDEN_FLAG);
        container.removeAttribute(HIDDEN_REASON_ATTRIBUTE);
        container.removeAttribute(PERMANENT_HIDDEN_FLAG);
        return;
      }

      const reasons = [...match.reasons].sort().join(', ');
      if (match.permanent) {
        container.setAttribute(PERMANENT_HIDDEN_FLAG, '1');
        container.removeAttribute(HIDDEN_FLAG);
      } else {
        container.setAttribute(HIDDEN_FLAG, '1');
        container.removeAttribute(PERMANENT_HIDDEN_FLAG);
      }
      container.setAttribute(HIDDEN_REASON_ATTRIBUTE, reasons);
    });
  }

  function cleanUp(root = document) {
    const rootElement =
      root && root.nodeType === Node.ELEMENT_NODE ? root : null;
    if (rootElement && rootElement.closest(FEED_SURFACE_SELECTOR)) {
      reconcileFilteredCards(rootElement);
      scheduleFilterToggleUpdate();
      return;
    }

    collectMatchingElements(root, FEED_SURFACE_SELECTOR).forEach((surface) => {
      reconcileFilteredCards(surface);
    });
    scheduleFilterToggleUpdate();
  }

  let filterToggleUpdateFrame = 0;

  function getFilteredContainers() {
    const containers = new Set();
    document.querySelectorAll(FEED_SURFACE_SELECTOR).forEach((surface) => {
      surface.querySelectorAll(FILTERED_CARD_SELECTOR).forEach((container) => {
        if (
          !container.closest(`[${PERMANENT_HIDDEN_FLAG}="1"]`) &&
          !isInsideExcludedSurface(container)
        ) {
          containers.add(container);
        }
      });
    });
    return containers;
  }

  function getFilteredReasonSummary(containers) {
    const counts = new Map();
    const markerReasons = [
      ['data-ytppl-upcoming-hidden', 'Upcoming'],
      ['data-ytppl-pay-to-watch-hidden', 'Pay to watch'],
      ['data-ytppl-watched-hidden', 'Watched'],
    ];

    containers.forEach((container) => {
      const reasons = new Set(
        String(container.getAttribute(HIDDEN_REASON_ATTRIBUTE) || '')
          .split(',')
          .map((reason) => reason.trim())
          .filter(Boolean),
      );
      markerReasons.forEach(([attribute, reason]) => {
        if (container.getAttribute(attribute) === '1') reasons.add(reason);
      });
      reasons.forEach((reason) => counts.set(reason, (counts.get(reason) || 0) + 1));
    });

    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(', ');
  }

  function setFilteredItemsRevealed(revealed) {
    const root = document.documentElement;
    if (
      !root ||
      (root.getAttribute(FILTER_REVEAL_ATTRIBUTE) === '1') === revealed
    ) return;

    if (revealed) {
      root.setAttribute(FILTER_REVEAL_ATTRIBUTE, '1');
    } else {
      root.removeAttribute(FILTER_REVEAL_ATTRIBUTE);
    }
    scheduleFilterToggleUpdate();
  }

  function updateFilterToggle() {
    filterToggleUpdateFrame = 0;
    const existing = document.getElementById(FILTER_TOGGLE_ID);
    if (!CONFIG.showTemporaryRevealControl || !isRuntimeFeedRoute()) {
      existing?.remove();
      setFilteredItemsRevealed(false);
      return;
    }

    const containers = getFilteredContainers();
    if (!containers.size) {
      existing?.remove();
      setFilteredItemsRevealed(false);
      return;
    }

    const revealed =
      document.documentElement?.getAttribute(FILTER_REVEAL_ATTRIBUTE) === '1';
    const button = existing || document.createElement('button');
    button.id = FILTER_TOGGLE_ID;
    button.type = 'button';
    button.setAttribute('aria-pressed', String(Boolean(revealed)));
    button.textContent = `Filtered: ${containers.size} · ${revealed ? 'Hide' : 'Show'}`;
    const reasons = getFilteredReasonSummary(containers);
    button.title = reasons || `${containers.size} filtered items`;
    if (!existing) {
      button.addEventListener('click', () => {
        const root = document.documentElement;
        setFilteredItemsRevealed(
          root?.getAttribute(FILTER_REVEAL_ATTRIBUTE) !== '1',
        );
      });
      (document.body || document.documentElement).appendChild(button);
    }
  }

  function scheduleFilterToggleUpdate() {
    if (filterToggleUpdateFrame) return;
    filterToggleUpdateFrame = requestAnimationFrame(updateFilterToggle);
  }

  function resetTemporaryReveal() {
    document.documentElement?.removeAttribute(FILTER_REVEAL_ATTRIBUTE);
    document.getElementById(FILTER_TOGGLE_ID)?.remove();
  }

  let cleanUpFrame = 0;
  const pendingCleanUpRoots = new Set();

  function addPendingCleanUpRoot(root) {
    if (!root || !root.querySelectorAll) return;

    for (const pendingRoot of Array.from(pendingCleanUpRoots)) {
      if (pendingRoot === root || pendingRoot.contains?.(root)) return;
      if (root.contains?.(pendingRoot)) pendingCleanUpRoots.delete(pendingRoot);
    }

    pendingCleanUpRoots.add(root);
  }

  function scheduleCleanUp(root) {
    addPendingCleanUpRoot(root);
    if (!pendingCleanUpRoots.size) return;
    if (cleanUpFrame) return;

    cleanUpFrame = requestAnimationFrame(() => {
      cleanUpFrame = 0;
      const roots = Array.from(pendingCleanUpRoots);
      pendingCleanUpRoots.clear();
      roots.forEach((pendingRoot) => {
        if (pendingRoot.isConnected !== false) cleanUp(pendingRoot);
      });
    });
  }

  function getAddedNodeCleanUpRoot(node) {
    const element =
      node && node.nodeType === Node.ELEMENT_NODE
        ? node
        : node && node.parentElement;
    if (!element) return null;
    if (isInsideExcludedSurface(element)) return null;

    if (element.closest(FEED_SURFACE_SELECTOR)) {
      return getCardContainer(element) || element;
    }
    if (element.querySelector(FEED_SURFACE_SELECTOR)) return element;
    return null;
  }

  function getMutationCleanUpRoot(mutation) {
    const element =
      mutation.target?.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target?.parentElement;
    if (!element) return null;

    const card = getCardContainer(element);
    if (card?.closest(FEED_SURFACE_SELECTOR)) return card;
    if (element.closest(FEED_SURFACE_SELECTOR)) return element;
    return null;
  }

  function mutationCanAffectFiltering(mutation) {
    if (mutation.type === 'childList') return true;

    const element =
      mutation.target?.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target?.parentElement;
    if (!element) return false;

    if (
      mutation.type === 'attributes' &&
      mutation.attributeName?.startsWith('data-ytppl-')
    ) {
      return true;
    }

    return Boolean(element.closest(FILTER_MUTATION_TRIGGER_SELECTOR));
  }

  GM_addStyle(buildCss());
  cleanUp(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutationCanAffectFiltering(mutation)) continue;

      if (mutation.type !== 'childList') {
        const cleanUpRoot = getMutationCleanUpRoot(mutation);
        if (cleanUpRoot) scheduleCleanUp(cleanUpRoot);
        continue;
      }

      const mutationRoot = getMutationCleanUpRoot(mutation);
      if (mutationRoot) scheduleCleanUp(mutationRoot);
      if (!mutation.addedNodes || !mutation.addedNodes.length) continue;

      mutation.addedNodes.forEach((node) => {
        const cleanUpRoot = getAddedNodeCleanUpRoot(node);
        if (cleanUpRoot) scheduleCleanUp(cleanUpRoot);
      });
    }
  });

  const OBSERVER_OPTIONS = {
    attributeFilter: [
      'href',
      'data-ytppl-upcoming-hidden',
      'data-ytppl-pay-to-watch-hidden',
      'data-ytppl-watched-hidden',
    ],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  };
  let observerActive = false;

  function stopMutationObservation() {
    if (!observerActive) return;
    observer.disconnect();
    observerActive = false;
  }

  function syncMutationObservation() {
    if (!isRuntimeFeedRoute()) {
      stopMutationObservation();
      return false;
    }
    if (!observerActive) {
      observer.observe(document.documentElement, OBSERVER_OPTIONS);
      observerActive = true;
    }
    return true;
  }

  function resetScheduledWork() {
    if (filterToggleUpdateFrame) cancelAnimationFrame(filterToggleUpdateFrame);
    if (cleanUpFrame) cancelAnimationFrame(cleanUpFrame);
    filterToggleUpdateFrame = 0;
    cleanUpFrame = 0;
    pendingCleanUpRoots.clear();
  }

  function reconcileRoute() {
    resetTemporaryReveal();
    if (syncMutationObservation()) cleanUp(document);
  }

  syncMutationObservation();

  window.addEventListener('yt-navigate-start', () => {
    resetTemporaryReveal();
    stopMutationObservation();
    resetScheduledWork();
  }, true);
  window.addEventListener('yt-navigate-finish', reconcileRoute, true);
  window.addEventListener('yt-page-data-updated', reconcileRoute, true);
  window.addEventListener('pagehide', () => {
    stopMutationObservation();
    resetScheduledWork();
  }, true);
  window.addEventListener('pageshow', reconcileRoute, true);
})();
