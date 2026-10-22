/** Customise recognised video-card menus without replacing native action handlers.
 * Unknown action rows stay native; an unrecognised model/layout is left untouched.
 */
export function installVideoMenu(suite) {
  const preferences = suite.settings.initial;
  const cardSelector = 'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer';
  const popupSelector = 'ytd-menu-popup-renderer, yt-sheet-view-model';
  const rowSelector = 'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, ytd-menu-service-item-download-renderer, yt-list-item-view-model, yt-download-list-item-view-model';
  const defaultOrder = ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'download', 'share', 'notInterested', 'dontRecommend', 'report', 'channelAge', 'channelTools'];
  const order = [...new Set([...(Array.isArray(preferences.menuItemOrder) ? preferences.menuItemOrder.filter(id => defaultOrder.includes(id)) : []), ...defaultOrder])];
  const controller = element => element?.polymerController || element?.getPolymerController?.() || element;
  let trigger = null;
  let active = null;
  let waiting = null;
  let firstFrame = 0;
  let secondFrame = 0;
  let refitFrame = 0;
  let style = null;
  let disposed = false;
  let triggerReason = 'missing-trigger';
  const compatibilityStates = {
    idle: 'not-checked', disposed: 'not-checked', ready: 'recognised',
    'missing-trigger': 'not-applicable',
    'captured-trigger': 'awaiting-menu', 'waiting-for-menu': 'awaiting-menu', 'waiting-for-visible-popup': 'awaiting-menu',
    'unavailable-model': 'loading-menu', 'unsupported-model': 'loading-menu', 'row-count': 'loading-menu', 'row-binding': 'loading-menu',
  };

  function compatibility(status) {
    const root = document.documentElement;
    if (root?.getAttribute?.('data-ytms-video-menu-compatibility') !== status) root?.setAttribute?.('data-ytms-video-menu-compatibility', status);
  }

  function diagnostic(reason) {
    // Fixed reason codes only: never expose titles, channel IDs, URLs or account data.
    const root = document.documentElement;
    if (root?.getAttribute?.('data-ytms-video-menu-status') !== reason) root?.setAttribute?.('data-ytms-video-menu-status', reason);
    compatibility(compatibilityStates[reason] || 'unsupported');
    return false;
  }

  function endpointFor(item) {
    const model = item?.menuServiceItemRenderer || item?.menuNavigationItemRenderer || item?.menuServiceItemDownloadRenderer || item?.listItemViewModel;
    return model?.serviceEndpoint || model?.navigationEndpoint || model?.rendererContext?.commandContext?.onTap?.innertubeCommand;
  }

  function queuedVideoId(item) {
    const actions = endpointFor(item)?.signalServiceEndpoint?.actions;
    if (!Array.isArray(actions) || actions.length !== 1) return null;
    const command = actions[0]?.addToPlaylistCommand;
    const ids = command?.videoIds || [command?.videoId];
    return command?.listType === 'PLAYLIST_EDIT_LIST_TYPE_QUEUE' && Array.isArray(ids) && ids.length === 1 &&
      typeof ids[0] === 'string' && /^[\w-]{11}$/.test(ids[0]) &&
      (command.videoId === undefined || command.videoId === ids[0]) ? ids[0] : null;
  }

  function identify(item, selection) {
    if (item?.downloadListItemViewModel) return 'download';
    const model = item?.menuServiceItemRenderer || item?.menuNavigationItemRenderer || item?.menuServiceItemDownloadRenderer || item?.listItemViewModel;
    const icon = String(model?.icon?.iconType || model?.leadingImage?.sources?.[0]?.clientResource?.imageName || '').toUpperCase();
    if (['QUEUE_PLAY_NEXT', 'ADD_TO_QUEUE_HEAD'].includes(icon) || model?.targetId === 'yt-master-play-next') return 'playNext';
    if (queuedVideoId(item)) return 'addToQueue';
    if (['WATCH_LATER', 'WATCH_LATER_OUTLINE'].includes(icon)) return 'watchLater';
    if (['PLAYLIST_ADD', 'ADD_TO_PLAYLIST', 'PLAYLIST_ADD_OUTLINE', 'BOOKMARK_BORDER'].includes(icon)) return 'savePlaylist';
    if (['DOWNLOAD', 'OFFLINE_DOWNLOAD', 'FILE_DOWNLOAD'].includes(icon) || item?.menuServiceItemDownloadRenderer) return 'download';
    if (['SHARE', 'SHARE_OUTLINE'].includes(icon)) return 'share';
    const library = location.pathname === '/feed/history' || location.pathname === '/playlist' ||
      selection.card.matches('ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer');
    if (['NOT_INTERESTED', 'NOT_INTERESTED_OUTLINE'].includes(icon) || (!library && icon === 'HIDE')) return 'notInterested';
    if (icon === 'DONT_RECOMMEND_CHANNEL' || (!library && ['REMOVE', 'DO_NOT_DISTURB_ON', 'BLOCK'].includes(icon) && endpointFor(item)?.feedbackEndpoint)) return 'dontRecommend';
    if (['FLAG', 'FLAG_OUTLINE', 'REPORT'].includes(icon)) return 'report';
    return null; // Unrecognised actions retain their native position and behaviour.
  }

  function videoIdFromCard(card) {
    const ids = new Set();
    for (const anchor of card.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href'), location.origin);
        if (url.origin !== location.origin) continue;
        const id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
        if (typeof id === 'string' && /^[\w-]{11}$/.test(id)) ids.add(id);
      } catch { /* Malformed links cannot identify a menu target. */ }
    }
    if (ids.size !== 1) return null;
    const id = [...ids][0];
    try {
      const model = typeof card.componentProps?.data === 'function' ? card.componentProps.data() : controller(card)?.data;
      if (model?.contentType && model.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
      if (model?.videoId && model.videoId !== id) return null;
      if (model?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && model.contentId && model.contentId !== id) return null;
    } catch { return null; }
    return id;
  }

  function menuSignature(items) {
    if (!Array.isArray(items) || !items.length || items.length > 60) return null;
    try {
      let fields = 0;
      const value = JSON.stringify(items, (_key, entry) => {
        if (++fields > 4000 || (typeof entry === 'string' && entry.length > 16384)) throw new Error('Menu model exceeds its bound');
        return entry;
      });
      return value.length <= 131072 ? value : null;
    } catch { return null; }
  }

  function nativeMenuSignature(button, card) {
    // Some queue/library menus have no Add to queue command. Require their
    // exact native model instead; a trusted click alone cannot bind a popup.
    const host = button.closest('ytd-menu-renderer');
    if (!host || !card.contains(host)) return null;
    try {
      const items = controller(host)?.data?.items;
      return Array.isArray(items) && !items.some(queuedVideoId) ? menuSignature(items) : null;
    } catch { return null; }
  }

  function matchesNativeMenu(items, selection) {
    return Boolean(selection.nativeSignature) && menuSignature(items) === selection.nativeSignature;
  }

  function captureTrigger(event) {
    if (!event.isTrusted || (event.type === 'keydown' && !['Enter', ' ', 'ArrowDown'].includes(event.key))) return;
    const button = event.target?.closest?.('button, tp-yt-paper-icon-button, yt-icon-button, [role="button"]');
    const card = button?.closest(cardSelector);
    if (!card || !button.closest('ytd-menu-renderer, .ytLockupMetadataViewModelMenuButton, [aria-haspopup="menu"], [aria-haspopup="true"]') ||
        card.closest('#movie_player')) {
      if (!active?.popup.contains(event.target)) {
        trigger = null;
        triggerReason = card ? 'unsupported-trigger' : 'missing-trigger';
        if (waiting) reset();
      }
      return;
    }
    reset();
    const videoId = videoIdFromCard(card);
    if (!videoId) { trigger = null; triggerReason = 'card-identity'; diagnostic(triggerReason); return; }
    trigger = { button, card, videoId, time: performance.now(), nativeSignature: nativeMenuSignature(button, card) };
    triggerReason = 'captured-trigger';
    diagnostic(triggerReason);
    startDiscovery(trigger);
  }

  function ensureStyle() {
    if (style?.isConnected) return;
    style = document.createElement('style');
    style.textContent = `
      .ytms-video-menu-action { box-sizing: border-box; border: 0; border-radius: 0; background: transparent;
        color: var(--yt-sys-color-baseline--text-primary, var(--yt-spec-text-primary, inherit)); cursor: pointer; display: flex; align-items: center; gap: 12px;
        min-height: 40px; width: 100%; padding: 8px 16px; text-align: start; font: 400 14px/20px Roboto, Arial, sans-serif; }
      ytd-menu-popup-renderer .ytms-video-menu-action { min-height: 36px; padding-block: 6px; }
      .ytms-video-menu-action:hover, .ytms-video-menu-action:focus-visible { background: var(--yt-spec-badge-chip-background, #8883); }
      .ytms-video-menu-action:focus-visible { outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff); outline-offset: -2px; }
      .ytms-video-menu-action[aria-disabled="true"] { opacity: .55; cursor: default; }
      .ytms-video-menu-action svg { width: 24px; height: 24px; flex: 0 0 24px; fill: currentColor; }
      .ytms-video-menu-action small { display: block; white-space: normal; max-width: 240px; font-size: 12px; line-height: 16px; margin-top: 3px; }
      .ytms-video-menu-action[hidden] { display: none !important; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function customAction(id, label, path) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytms-video-menu-action';
    button.dataset.ytmsMenuAction = id;
    button.setAttribute('role', 'menuitem');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    const text = document.createElement('span');
    text.textContent = label;
    button.append(svg, text);
    return button;
  }

  function focusable(row) {
    return row.matches('button, [tabindex]') ? row : row.querySelector('button, [role="menuitem"], [tabindex]') || row;
  }

  function refit() {
    const current = active;
    if (!current) return;
    const resize = () => {
      if (active !== current || !visiblePopup(current.popup)) return;
      try { controller(current.popup.closest('tp-yt-iron-dropdown'))?.refit?.(); } catch { /* A dismissed popup may no longer have a native controller. */ }
    };
    resize();
    if (refitFrame) cancelAnimationFrame(refitFrame);
    // Legacy popup rows settle after their first native measurement. One
    // coalesced frame avoids retaining the submenu's stale size constraints.
    refitFrame = requestAnimationFrame(() => { refitFrame = 0; resize(); });
  }

  function restoreRow(row, saved) {
    if (saved.value) row.style.setProperty('display', saved.value, saved.priority);
    else row.style.removeProperty('display');
  }

  function setPage(tools, focus = true) {
    const current = active;
    if (!current || !current.popup.isConnected) return;
    current.tools = tools;
    for (const entry of current.entries) {
      const show = entry.enabled && (tools ? entry.grouped : !entry.grouped);
      if (show) restoreRow(entry.row, entry.display);
      else entry.row.style.setProperty('display', 'none', 'important');
    }
    current.back.hidden = !tools;
    current.group.hidden = tools || !current.entries.some(entry => entry.enabled && entry.grouped);
    current.group.setAttribute('aria-expanded', String(tools));
    refit();
    if (focus) focusable(tools ? current.back : current.group).focus();
  }

  function reset() {
    if (waiting) {
      waiting.observer.disconnect();
      clearTimeout(waiting.timer);
      waiting = null;
      compatibility('not-checked');
    }
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    if (refitFrame) cancelAnimationFrame(refitFrame);
    refitFrame = 0;
    firstFrame = secondFrame = 0;
    if (!active) return;
    const current = active;
    active = null;
    current.back.remove();
    current.group.remove();
    current.age?.remove();
    for (const entry of current.entries) {
      if (!entry.custom) restoreRow(entry.row, entry.display);
    }
    // Only restore a still-owned, fully stamped list. Do not resurrect detached native rows.
    if (current.original.every(row => row.parentElement === current.parent)) {
      current.parent.append(...current.original);
    }
    if (current.popup.getAttribute('data-ytms-video-menu') === '1') current.popup.removeAttribute('data-ytms-video-menu');
  }

  function decorate(popup, selection) {
    if (disposed || trigger !== selection || !selection.card.isConnected || !popup.isConnected ||
        performance.now() - selection.time > 5000 || videoIdFromCard(selection.card) !== selection.videoId) return diagnostic('stale-target');
    const sheet = popup.matches('yt-sheet-view-model');
    let data;
    try { data = sheet ? popup.componentProps?.data?.() : controller(popup)?.data; } catch { return diagnostic('unavailable-model'); }
    const items = sheet ? data?.content?.listViewModel?.listItems : data?.items;
    if (!Array.isArray(items) || !items.length || items.length > 60) return diagnostic('unsupported-model');
    const queueIds = items.map(queuedVideoId).filter(Boolean);
    if (!queueIds.length && !matchesNativeMenu(items, selection)) return diagnostic('no-queue-action');
    if (queueIds.length && !queueIds.includes(selection.videoId)) return diagnostic('queue-target-mismatch');
    // Native Download is an outer action host containing its own list-item row.
    // Keep that original host and handler intact; do not count or move its child.
    const rows = [...popup.querySelectorAll(rowSelector)].filter(row => {
      const downloadHost = row.closest('yt-download-list-item-view-model');
      return !downloadHost || row === downloadHost;
    });
    if (rows.length !== items.length) return diagnostic('row-count');
    if (rows.some(row => row.parentElement !== rows[0].parentElement)) return diagnostic('row-parent');
    const parent = rows[0].parentElement;
    if (sheet && rows.some((row, index) => items[index]?.downloadListItemViewModel
      ? !row.matches('yt-download-list-item-view-model')
      : !items[index]?.listItemViewModel || !row.matches('yt-list-item-view-model'))) return diagnostic('row-binding');
    if (rows.some(row => !popup.contains(row)) || rows.some((row, index) => {
      if (sheet) return false;
      const model = items[index].menuServiceItemRenderer || items[index].menuNavigationItemRenderer || items[index].menuServiceItemDownloadRenderer;
      return !model || typeof model !== 'object' || controller(row)?.data !== model;
    })) return diagnostic('row-binding');
    const ids = items.map(item => identify(item, selection));
    // Ambiguous duplicate recognised actions and mismatched native lists remain untouched.
    if (ids.some((id, index) => id && ids.indexOf(id) !== index)) return diagnostic('duplicate-actions');
    let channel = null;
    try { channel = suite.channelAge?.channelFromCard(selection.card) || null; } catch { /* A missing stable ID leaves manual settings available. */ }
    ensureStyle();
    const grouped = preferences.menuGroupChannelTools !== false;
    const isEnabled = id => id === 'download' ? preferences.menuShowDownload === true :
      id === 'notInterested' ? preferences.menuShowNotInterested !== false :
      id === 'dontRecommend' ? preferences.menuShowDontRecommend !== false :
      id === 'report' ? preferences.menuShowReport !== false : true;
    const entries = rows.map((row, index) => ({ row, id: ids[index], enabled: isEnabled(ids[index]),
      grouped: grouped && ['dontRecommend', 'report'].includes(ids[index]),
      display: { value: row.style.getPropertyValue('display'), priority: row.style.getPropertyPriority('display') } }));
    let age = null;
    if (preferences.menuShowAgeLimit !== false) {
      age = customAction('channelAge', 'Filter channel uploads…', 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v10H5V10h14zM5 6h14v2H5V6zm6 6v5h5v-2h-3v-3h-2z');
      if (!channel?.channelId) {
        age.setAttribute('aria-disabled', 'true');
        const note = document.createElement('small');
        note.textContent = 'Channel ID unavailable; add it manually in Channels settings.';
        age.lastElementChild.append(note);
      }
      entries.push({ row: age, id: 'channelAge', enabled: true, grouped, custom: true, display: { value: '', priority: '' } });
    }
    const group = customAction('channelTools', 'Channel tools', 'M9 5l7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6L9 5z');
    group.setAttribute('aria-haspopup', 'menu');
    const back = customAction('back', 'Back', 'M15 5l-7 7 7 7 1.4-1.4-5.6-5.6 5.6-5.6L15 5z');
    // Keep unknown rows in their original slots; reorder only recognised action slots.
    const sorted = entries.filter(entry => entry.id).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    let index = 0;
    const arranged = entries.map(entry => entry.id ? sorted[index++] : entry);
    const groupRank = order.indexOf('channelTools');
    const beforeGroup = arranged.findIndex(entry => entry.id && order.indexOf(entry.id) > groupRank);
    const nodes = arranged.map(entry => entry.row);
    nodes.splice(beforeGroup < 0 ? nodes.length : beforeGroup, 0, group);
    active = { popup, parent, original: rows, entries, age, group, back, channel, card: selection.card, videoId: selection.videoId,
      trigger: selection.button, tools: false };
    parent.append(back, ...nodes);
    popup.setAttribute('data-ytms-video-menu', '1');
    setPage(false, false);
    diagnostic('ready');
    return true;
  }

  function visiblePopup(popup) {
    if (!popup.isConnected || !popup.getClientRects().length) return false;
    for (let element = popup; element; element = element.parentElement) {
      if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
      const css = getComputedStyle(element);
      if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility)) return false;
    }
    return true;
  }

  function matchesSelection(popup, selection) {
    try {
      const data = popup.matches('yt-sheet-view-model') ? popup.componentProps?.data?.() : controller(popup)?.data;
      const items = popup.matches('yt-sheet-view-model') ? data?.content?.listViewModel?.listItems : data?.items;
      if (!Array.isArray(items) || items.length > 60) return false;
      const queueIds = items.map(queuedVideoId).filter(Boolean);
      return queueIds.length ? queueIds.includes(selection.videoId) : matchesNativeMenu(items, selection);
    } catch { return false; }
  }

  function startDiscovery(selection, eventPopup = null) {
    reset();
    const containers = [...document.querySelectorAll('ytd-popup-container')];
    const existing = eventPopup ? [eventPopup] : [...document.querySelectorAll(popupSelector)];
    const roots = containers.length ? containers : [...new Set(existing.map(popup => popup.closest('tp-yt-iron-dropdown') || popup))];
    diagnostic('waiting-for-menu');
    let request;
    function attempt() {
      secondFrame = 0;
      if (waiting !== request || trigger !== selection) return;
      try {
        const visible = [...document.querySelectorAll(popupSelector)].filter(popup =>
          roots.some(root => root === popup || root.contains(popup)) && visiblePopup(popup));
        if (visible.length) request.sawPopup = true;
        const matching = visible.filter(popup => matchesSelection(popup, selection));
        if (matching.length > 1 || (visible.length > 1 && matching.length !== 1)) {
          diagnostic('ambiguous-popup'); return;
        }
        const popup = matching[0] || (visible.length === 1 ? visible[0] : null);
        if (!popup) { diagnostic('waiting-for-visible-popup'); return; }
        // A visible old menu for another video is not owned by this request.
        request.popup = matching.length === 1 ? popup : null;
        if (decorate(popup, selection) && waiting === request) {
          request.observer.disconnect();
          clearTimeout(request.timer);
          waiting = null;
        }
      } catch { reset(); compatibility('unsupported'); }
    }
    // YouTube reuses cached sheets without another yt-popup-opened event. Watch
    // only known popup containers after this trusted activation, never the page.
    const observer = new MutationObserver(() => {
      if (waiting === request && !firstFrame && !secondFrame) secondFrame = requestAnimationFrame(attempt);
    });
    for (const root of roots) observer.observe(root, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['hidden', 'style', 'aria-hidden', 'opened'] });
    request = { popup: eventPopup && matchesSelection(eventPopup, selection) ? eventPopup : null, roots, observer, sawPopup: false, timer: setTimeout(() => {
      if (waiting === request) {
        observer.disconnect(); waiting = null;
        if (trigger === selection) { trigger = null; triggerReason = 'expired-trigger'; }
        if (firstFrame) cancelAnimationFrame(firstFrame);
        if (secondFrame) cancelAnimationFrame(secondFrame);
        firstFrame = secondFrame = 0;
        compatibility(request.sawPopup ? 'unsupported' : 'no-menu');
      }
    }, 1500) };
    waiting = request;
    // Play next first rebinds the native model; the second frame sees its stamped rows.
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(attempt);
    });
  }

  function opened(event) {
    const popup = event.target;
    if (!popup?.matches?.(popupSelector)) return;
    if (!trigger) { diagnostic(triggerReason); return; }
    startDiscovery(trigger, popup);
  }

  function activate(event) {
    const current = active;
    if (!current) return;
    if (!current.popup.contains(event.target)) {
      // Automatic theatre-mode and other native helpers use synthetic clicks.
      // They must not cancel a menu that the user has just opened.
      if (event.isTrusted) { reset(); trigger = null; triggerReason = 'missing-trigger'; }
      return;
    }
    const action = event.target.closest?.('[data-ytms-menu-action]')?.dataset.ytmsMenuAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.isTrusted) return;
    if (action === 'channelTools') setPage(true);
    else if (action === 'back') setPage(false);
    else if (action === 'channelAge' && current.channel?.channelId) {
      let channel;
      try { channel = suite.channelAge?.channelFromCard(current.card); } catch { return; }
      if (!current.card.isConnected || videoIdFromCard(current.card) !== current.videoId || channel?.channelId !== current.channel.channelId) return;
      try { current.popup.closest('tp-yt-iron-dropdown')?.close?.(); } catch { /* Settings can still open if the native dropdown has already closed. */ }
      reset(); trigger = null; triggerReason = 'missing-trigger';
      suite.openChannelAgeSettings?.(channel);
    }
  }

  function keyboard(event) {
    const current = active;
    if (!current || !current.popup.contains(event.target) || !event.isTrusted) return;
    if ((event.key === 'ArrowRight' && event.target.closest?.('[data-ytms-menu-action="channelTools"]')) ||
        ((event.key === 'ArrowLeft' || event.key === 'Escape') && current.tools)) {
      event.preventDefault(); event.stopImmediatePropagation();
      setPage(!current.tools); return;
    }
    if (event.key === 'Escape') { reset(); trigger = null; triggerReason = 'missing-trigger'; return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...current.parent.children].filter(row => row === current.back ? current.tools :
      row === current.group ? !current.group.hidden :
        current.entries.some(entry => entry.row === row && entry.enabled && (current.tools ? entry.grouped : !entry.grouped)));
    if (!rows.length) return;
    const focused = rows.findIndex(row => row === event.target || row.contains(event.target));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
      (focused + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    event.preventDefault(); event.stopImmediatePropagation();
    focusable(rows[next]).focus();
  }

  function closed(event) {
    const popup = active?.popup || waiting?.popup;
    if ((popup && (event.target === popup || event.target?.contains?.(popup))) ||
        (!active && waiting?.roots.some(root => root === event.target))) {
      reset(); trigger = null; triggerReason = 'missing-trigger';
    }
  }

  function navigated() { reset(); trigger = null; triggerReason = 'missing-trigger'; compatibility('not-checked'); }
  document.addEventListener('click', captureTrigger, true);
  document.addEventListener('keydown', captureTrigger, true);
  document.addEventListener('click', activate, true);
  document.addEventListener('keydown', keyboard, true);
  window.addEventListener('yt-popup-opened', opened, true);
  const closeEvents = ['yt-popup-closed', 'iron-overlay-closed'];
  closeEvents.forEach(type => window.addEventListener(type, closed, true));
  const resetEvents = ['yt-navigate-start', 'pagehide'];
  resetEvents.forEach(type => window.addEventListener(type, navigated, true));
  diagnostic('idle');
  return function disposeVideoMenu() {
    disposed = true;
    navigated();
    style?.remove(); style = null;
    document.removeEventListener('click', captureTrigger, true);
    document.removeEventListener('keydown', captureTrigger, true);
    document.removeEventListener('click', activate, true);
    document.removeEventListener('keydown', keyboard, true);
    window.removeEventListener('yt-popup-opened', opened, true);
    closeEvents.forEach(type => window.removeEventListener(type, closed, true));
    resetEvents.forEach(type => window.removeEventListener(type, navigated, true));
    diagnostic('disposed');
  };
}
