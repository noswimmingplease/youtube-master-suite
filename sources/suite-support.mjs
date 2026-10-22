// Self-contained, read-only factory for a privacy-safe troubleshooting report.
// Never copy source records: DOM markers may contain titles, URLs and errors.
export function createSuiteSupport(document, version, moduleIds) {
  const knownModules = ['commentCleaner', 'feedUiCleaner', 'miniplayerButtonRestorer', 'pageCoherence',
    'playerPreferencesLite', 'scrollMiniplayer', 'suiteSettings', 'watchLayoutCleaner'];
  const requested = new Set(Array.isArray(moduleIds) ? moduleIds.slice(0, knownModules.length) : []);
  const ids = knownModules.filter(id => requested.has(id));
  const safeVersion = typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : 'unknown';
  const menuStates = ['not-checked', 'awaiting-menu', 'loading-menu', 'no-menu', 'not-applicable', 'recognised', 'unsupported'];

  function attribute(name) {
    try { return document.documentElement?.getAttribute(name) ?? null; }
    catch { return null; }
  }
  function marker(name, maximumLength, array = false) {
    const raw = attribute(name);
    if (raw === null) return { status: 'missing', value: null };
    if (typeof raw !== 'string' || !raw.length || raw.length > maximumLength) return { status: 'invalid', value: null };
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) !== array) return { status: 'invalid', value: null };
      return { status: 'available', value };
    } catch { return { status: 'invalid', value: null }; }
  }
  const boolean = value => typeof value === 'boolean' ? value : undefined;
  const counter = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined;
  const enumeration = (value, allowed) => allowed.includes(value) ? value : 'unknown';

  function snapshot() {
    const rawHealth = marker('data-yt-master-suite', 8192);
    const healthValue = rawHealth.value || {};
    const modules = ids.map(id => {
      const states = [];
      for (const [property, status] of [['initialisedModules', 'initialised'], ['pendingModules', 'pending'], ['disabledModules', 'disabled']]) {
        if (Array.isArray(healthValue[property]) && healthValue[property].includes(id)) states.push(status);
      }
      if (Array.isArray(healthValue.failedModules) && healthValue.failedModules.some(entry => entry?.id === id)) states.push('failed');
      return { id, status: states.length === 1 ? states[0] : 'unknown' };
    });
    const health = {
      status: rawHealth.status,
      ready: boolean(healthValue.ready), healthy: boolean(healthValue.healthy),
      registeredModules: counter(healthValue.registeredModules, knownModules.length),
      expectedModules: ids.length, modules,
    };
    const rawErrors = marker('data-yt-master-runtime-errors', 32768, true);
    // The runtime retains at most 20 errors. Reject oversized/tampered lists.
    if (rawErrors.value?.length > 20) { rawErrors.status = 'invalid'; rawErrors.value = null; }
    const byModule = [...ids, 'suite'].map(id => ({ id,
      count: (rawErrors.value || []).filter(entry => entry?.module === id).length,
    }));
    const runtimeErrors = { status: rawErrors.status, total: byModule.reduce((sum, entry) => sum + entry.count, 0), byModule };
    const rawMenu = attribute('data-ytms-video-menu-compatibility');
    const videoMenu = { status: rawMenu === null ? 'not-checked' : enumeration(rawMenu, menuStates) };
    const rawCoherence = marker('data-yt-master-state', 65536);
    const state = rawCoherence.value || {};
    const coherence = {
      status: rawCoherence.status,
      identityStatus: enumeration(state.identityStatus, ['not-watch-page', 'pending', 'disagreement', 'coherent']),
      nativeLoading: boolean(state.nativeLoading), confirmedMismatch: boolean(state.confirmedMismatch),
      confirmedCoherent: boolean(state.confirmedCoherent), commentsHiddenAsStale: boolean(state.commentsHiddenAsStale),
      confirmedStaleComments: boolean(state.confirmedStaleComments), mismatchChecks: counter(state.mismatchChecks, 1000),
      loadingRecoveryStatus: enumeration(state.loadingRecoveryStatus, ['not-attempted', 'attempted', 'pending', 'completed', 'failed']),
    };
    const healthSummary = health.status === 'missing' ? 'Module health has not been reported.' :
      health.status === 'invalid' ? 'Module health information is unavailable.' :
        `${modules.filter(entry => entry.status === 'initialised').length} of ${ids.length} modules report initialised.`;
    const menuSummary = {
      'not-checked': 'Video-menu compatibility has not been checked.',
      'awaiting-menu': 'Waiting for the selected video menu.',
      'loading-menu': 'The selected video menu is still loading.',
      'no-menu': 'No video menu appeared before the compatibility check ended.',
      'not-applicable': 'The last opened menu was not an applicable video menu.',
      recognised: 'The last video menu layout was recognised.',
      unsupported: 'The last video menu could not be safely recognised; its native actions were left unchanged.',
      unknown: 'Video-menu compatibility information is unavailable.',
    }[videoMenu.status];
    return { schemaVersion: 1, language: 'en-GB', version: safeVersion, summary: `${healthSummary} ${menuSummary}`,
      health, runtimeErrors, videoMenu, coherence };
  }
  return Object.freeze({ snapshot, report: () => JSON.stringify(snapshot(), null, 2) });
}
