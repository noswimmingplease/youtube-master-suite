// Language: en-GB. Self-contained factory embedded in the userscript.
// Uses narrow native presentation hooks; never changes a media source or clock.
export function installPlayerPresentation({ document, window, keepHoverPreviews = false, timeDisplayMode = 'native' }) {
  if (!keepHoverPreviews && !['elapsed', 'remaining'].includes(timeDisplayMode)) return () => {};
  const patches = new Map();
  const attemptedTimes = new WeakMap();
  let suspended = false, frame = 0, disposed = false, previewDirty = false, navigationPending = false;
  const home = () => ['/', '/feed/recommended'].includes(window.location.pathname);
  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]') || !element.getClientRects().length) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility);
  }

  function recompute(record) {
    const { controller, app } = record;
    const args = [controller.miniplayerIsActive, controller.miniplayerPlaybackState];
    if (app) args.push(controller.isInlinePreviewDisabled);
    const value = controller.computeIsInlinePreviewEnabled(...args);
    if (typeof value === 'boolean' && controller.isInlinePreviewEnabled !== value) {
      if (typeof controller._setIsInlinePreviewEnabled === 'function') controller._setIsInlinePreviewEnabled(value);
      else if (controller.__dataHasAccessor?.isInlinePreviewEnabled === true &&
          typeof controller._setProperty === 'function' && typeof controller._getProperty === 'function' &&
          controller._getProperty('isInlinePreviewEnabled') === controller.isInlinePreviewEnabled) {
        // Computed Polymer accessors can have a no-op public setter and no
        // generated _setX method. Use the native pending-property path so the
        // value and its observers/Redux subscribers change together.
        controller._setProperty('isInlinePreviewEnabled', value);
      }
      else controller.isInlinePreviewEnabled = value;
    }
  }
  function restorePreviews() {
    for (const record of patches.values()) {
      const { controller, wrapper, descriptor } = record;
      // Do not overwrite an extension's later replacement.
      if (controller.computeIsInlinePreviewEnabled !== wrapper) continue;
      if (descriptor) Object.defineProperty(controller, 'computeIsInlinePreviewEnabled', descriptor);
      else delete controller.computeIsInlinePreviewEnabled;
      try { recompute(record); } catch { /* Native component was detached. */ }
    }
    patches.clear();
  }
  function syncPreviews() {
    if (!keepHoverPreviews || !home() || suspended || document.hidden) { restorePreviews(); return; }
    const apps = [...document.querySelectorAll('ytd-app')].filter(visible);
    if (apps.length !== 1) { restorePreviews(); return; }
    const appController = apps[0].polymerController || apps[0];
    // Honour YouTube's explicit Inline playback preference. Never falsify the
    // global miniplayer state or turn an opted-out user's previews back on.
    if (appController.isInlinePreviewDisabled !== false) { restorePreviews(); return; }
    const hosts = [apps[0], ...apps[0].querySelectorAll('ytd-browse ytd-rich-grid-renderer')].filter(visible);
    const controllers = new Set(hosts.map(host => host.polymerController || host));
    for (const [controller, record] of patches) {
      if (!controllers.has(controller)) {
        if (controller.computeIsInlinePreviewEnabled === record.wrapper) {
          if (record.descriptor) Object.defineProperty(controller, 'computeIsInlinePreviewEnabled', record.descriptor);
          else delete controller.computeIsInlinePreviewEnabled;
          try { recompute(record); } catch { /* Replaced controller. */ }
        }
        patches.delete(controller);
      }
    }
    for (const host of hosts) {
      const controller = host.polymerController || host;
      const existing = patches.get(controller);
      if (existing) {
        if (controller.computeIsInlinePreviewEnabled === existing.wrapper) {
          try { recompute(existing); } catch { /* Preserve the native fallback. */ }
        }
        continue;
      }
      const original = controller.computeIsInlinePreviewEnabled;
      const app = host === apps[0];
      if (!app && !patches.has(appController)) continue;
      if (typeof original !== 'function' || original.length !== (app ? 3 : 2) ||
          typeof controller.miniplayerIsActive !== 'boolean' ||
          !Number.isInteger(controller.miniplayerPlaybackState) ||
          typeof controller.isInlinePreviewEnabled !== 'boolean') continue;
      const descriptor = Object.getOwnPropertyDescriptor(controller, 'computeIsInlinePreviewEnabled');
      if (descriptor && (!('value' in descriptor) || !descriptor.configurable || !descriptor.writable)) continue;
      if (!descriptor && !Object.isExtensible(controller)) continue;
      try {
        // Verify the known pure boolean contract before changing its inputs.
        // A same-named future hook or a stricter extension policy is not ours.
        if (original.call(controller, false, 1, false) !== true ||
            original.call(controller, true, 1, false) !== false ||
            original.call(controller, true, 2, false) !== true ||
            (app && original.call(controller, false, 1, true) !== false)) continue;
      } catch { continue; }
      const record = { host, controller, original, descriptor, app, wrapper: null };
      record.wrapper = function (...args) {
        // Override only the miniplayer-related input to this pure presentation
        // computation. All other native eligibility and failure checks remain.
        if (this === controller && !disposed && !suspended && home() && !document.hidden && host.isConnected &&
            appController.isInlinePreviewDisabled === false && args[0] === true) args[0] = false;
        return original.apply(this, args);
      };
      try {
        Object.defineProperty(controller, 'computeIsInlinePreviewEnabled', {
          configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: record.wrapper,
        });
        patches.set(controller, record);
        recompute(record);
      } catch { /* Unknown or protected native components remain untouched. */ }
    }
  }
  function syncTime() {
    if (!['elapsed', 'remaining'].includes(timeDisplayMode) || suspended || document.hidden) return;
    const players = [...document.querySelectorAll('#movie_player')].filter(player => visible(player) &&
      !player.closest('ytd-video-preview, ytd-reel-video-renderer'));
    if (players.length !== 1) return;
    const player = players[0];
    if (player.matches('.ad-showing, .ad-interrupting') || !player.querySelector('video')) return;
    const displays = [...player.querySelectorAll('.ytp-time-display')].filter(visible);
    if (displays.length !== 1 || displays[0].classList.contains('ytp-live')) return;
    const wrappers = displays[0].querySelectorAll('.ytp-time-wrapper.ytp-time-wrapper-delhi');
    if (wrappers.length !== 1) return;
    const wrapper = wrappers[0], contents = wrapper.querySelector('.ytp-time-contents[role="button"][tabindex="0"]');
    const current = contents?.querySelector('.ytp-time-current')?.textContent.trim();
    const duration = contents?.querySelector('.ytp-time-duration')?.textContent.trim();
    if (!/^[-−]?\d{1,6}:\d{2}(?::\d{2})?$/.test(current || '') ||
        !/^\d{1,6}:\d{2}(?::\d{2})?$/.test(duration || '') || !/[1-9]/.test(duration)) return;
    const remaining = /^[-−]/.test(current);
    if (remaining === (timeDisplayMode === 'remaining')) { attemptedTimes.delete(wrapper); return; }
    // One request per mismatched native state. A blocked/no-op click must not
    // cause a click loop on every timeupdate or keep polling while paused.
    const signature = `${timeDisplayMode}:${remaining}`;
    if (attemptedTimes.get(wrapper) === signature) return;
    attemptedTimes.set(wrapper, signature);
    wrapper.click();
  }
  function sync() {
    frame = 0;
    if (disposed) return;
    if (previewDirty) { previewDirty = false; syncPreviews(); }
    syncTime();
  }
  function schedule(previews = true) {
    previewDirty ||= previews;
    if (!disposed && !suspended && !frame) frame = window.requestAnimationFrame(sync);
  }
  function suspend() {
    suspended = true;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0; restorePreviews();
  }
  function resume() { if (!navigationPending) { suspended = false; schedule(); } }
  function navigateStart() { navigationPending = true; suspend(); }
  function navigateFinish() { navigationPending = false; resume(); }
  function pointer(event) {
    if (suspended || disposed) return;
    const target = event.target?.closest ? event.target : event.target?.parentElement;
    // pointerover precedes native mouseenter; no synthetic hover or click is
    // generated, and newly stamped/recycled Home cards need no polling.
    if (keepHoverPreviews && home() && target?.closest('ytd-browse ytd-rich-grid-renderer')) {
      const card = target.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, yt-lockup-view-model') || target;
      if (!card.contains(event.relatedTarget)) syncPreviews();
    }
    if (timeDisplayMode !== 'native' && target?.closest('#movie_player .ytp-time-display')) syncTime();
  }
  function media(event) {
    if (event.target?.localName === 'video' && event.target.closest('#movie_player') &&
        !event.target.closest('ytd-video-preview, ytd-reel-video-renderer')) schedule(false);
  }
  function visibility() { if (document.hidden) suspend(); else resume(); }
  const listeners = [];
  function listen(target, type, handler) { target.addEventListener(type, handler, true); listeners.push([target, type, handler]); }
  listen(document, 'pointerover', pointer);
  if (timeDisplayMode !== 'native') for (const type of ['timeupdate', 'loadedmetadata', 'durationchange']) listen(document, type, media);
  for (const type of ['yt-navigate-start', 'pagehide']) listen(window, type, navigateStart);
  for (const type of ['yt-navigate-finish', 'pageshow']) listen(window, type, navigateFinish);
  listen(window, 'yt-page-data-updated', resume);
  listen(document, 'visibilitychange', visibility);
  schedule();
  return () => {
    disposed = true; suspend();
    for (const [target, type, handler] of listeners) target.removeEventListener(type, handler, true);
  };
}
