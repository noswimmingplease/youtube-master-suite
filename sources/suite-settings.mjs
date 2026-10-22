// Self-contained factory: the builder embeds it in the single-file userscript.
// No values from storage are used as HTML, selectors, URLs or arbitrary CSS.
export function createSuiteSettings(getStorage, isDarkTheme) {
  const key = "yt-master-suite.settings.v1";
  const cornerKey = "yt-master-suite.scroll-miniplayer.corner.v1";
  const defaults = Object.freeze({
    colourMode: "default", palette: "teal-coral", viewerColour: "#82A3E6", ownerColour: "#FF9F1C",
    compactComments: true, hideCommentControls: true,
    hideShorts: true, hideWatchedVideos: true, hideMixes: true, hidePodcasts: true, hideMembersOnly: true,
    watchedThreshold: "90", yellowCaptions: true, mirrorButton: true, theatreMode: true,
    preferredVideoQuality: "off",
    wheelVolume: true, wheelStep: "5", hideRelated: true, hideChat: true, hideInfoCards: true,
    hideEndScreens: true, fullscreenComments: true, disableTitleHashtagLinks: false, miniplayerEnabled: true,
    corner: "top-right", queueInfo: true,
    headerSettingsIcon: "colour", playerSettingsIcon: "monochrome",
    showRydTooltipBar: false,
    showDeArrowTitleButton: false,
    showDeArrowQueueButton: true,
    menuShowDownload: false, menuGroupChannelTools: true, menuShowAgeLimit: true,
    menuShowNotInterested: true, menuShowDontRecommend: true, menuShowReport: true,
    menuItemOrder: Object.freeze(["playNext", "addToQueue", "watchLater", "savePlaylist", "download", "share",
      "notInterested", "dontRecommend", "report", "channelAge", "channelTools"]),
  });
  const choices = Object.freeze({
    colourMode: ["default", "preset", "custom", "off"],
    palette: ["teal-coral", "lavender-gold", "cyan-rose"],
    watchedThreshold: ["80", "90", "95", "100"], wheelStep: ["1", "2", "5", "10"],
    preferredVideoQuality: ["off", "highest", "tiny", "small", "medium", "large", "hd720", "hd1080", "hd1440", "hd2160"],
    corner: ["top-right", "bottom-right", "bottom-left", "top-left"],
    headerSettingsIcon: ["off", "colour", "monochrome"], playerSettingsIcon: ["off", "colour", "monochrome"],
  });
  const palettes = Object.freeze({
    dark: {
      "teal-coral": ["#80CBC4", "#FFAB91"], "lavender-gold": ["#B39DDB", "#FFD54F"], "cyan-rose": ["#81D4FA", "#F48FB1"],
    },
    light: {
      "teal-coral": ["#00695C", "#A83222"], "lavender-gold": ["#65409B", "#806000"], "cyan-rose": ["#006A8E", "#A82659"],
    },
  });
  function normaliseHex(value) {
    return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())
      ? "#" + value.trim().replace(/^#/, "").toUpperCase() : null;
  }
  function validate(input) {
    const result = { ...defaults, menuItemOrder: [...defaults.menuItemOrder] };
    if (!input || typeof input !== "object" || Array.isArray(input)) return result;
    for (const [name, fallback] of Object.entries(defaults)) {
      if (!Object.hasOwn(input, name)) continue;
      const value = input[name];
      if (typeof fallback === "boolean") {
        if (typeof value === "boolean") result[name] = value;
      } else if (name === "menuItemOrder") {
        if (Array.isArray(value) && value.length <= defaults.menuItemOrder.length) {
          const order = [...new Set(value.filter(item => typeof item === "string" && defaults.menuItemOrder.includes(item)))];
          result[name] = [...order, ...defaults.menuItemOrder.filter(item => !order.includes(item))];
        }
      } else if (name === "viewerColour" || name === "ownerColour") {
        result[name] = normaliseHex(value) || fallback;
      } else if (choices[name]?.includes(value)) result[name] = value;
    }
    // Recover a corrupted or manually edited record without hiding all access.
    if (result.headerSettingsIcon === "off" && result.playerSettingsIcon === "off") result.headerSettingsIcon = defaults.headerSettingsIcon;
    return result;
  }
  function read() {
    try {
      const storage = getStorage();
      const raw = storage.getItem(key);
      let record = null;
      if (raw && raw.length <= 8192) {
        try { record = JSON.parse(raw); } catch { /* Keep defaults, but still read the existing corner. */ }
      }
      const values = validate(record?.version === 1 ? record.values : null);
      // Keep the miniplayer's existing synchronised corner as its one source of truth.
      const corner = storage.getItem(cornerKey);
      if (choices.corner.includes(corner)) values.corner = corner;
      return values;
    } catch { return { ...defaults, menuItemOrder: [...defaults.menuItemOrder] }; }
  }
  const initialValues = read();
  Object.freeze(initialValues.menuItemOrder);
  const initial = Object.freeze(initialValues);
  function save(input) {
    if (input?.headerSettingsIcon === "off" && input?.playerSettingsIcon === "off") {
      return { ok: false, error: "Keep at least one settings button enabled." };
    }
    const values = validate(input);
    let storage, previous;
    try {
      storage = getStorage(); previous = storage.getItem(key);
      storage.setItem(key, JSON.stringify({ version: 1, values }));
      if (storage.getItem(cornerKey) !== values.corner) storage.setItem(cornerKey, values.corner);
      return { ok: true, values };
    } catch {
      // Do not leave half-saved panel preferences if writing the legacy corner fails.
      try {
        if (previous === null) storage?.removeItem(key);
        else if (previous !== undefined) storage?.setItem(key, previous);
      } catch { /* Storage may remain unavailable; report the failure below. */ }
      return { ok: false, error: "Settings could not be saved. Browser storage is unavailable or full." };
    }
  }
  function colours(values = initial, dark = isDarkTheme()) {
    const checked = validate(values);
    if (checked.colourMode === "off") return null;
    if (checked.colourMode === "preset") return palettes[dark ? "dark" : "light"][checked.palette];
    if (checked.colourMode === "custom") return [checked.viewerColour, checked.ownerColour];
    return [defaults.viewerColour, defaults.ownerColour];
  }
  function overrides(id, config) {
    const values = initial;
    if (id === "commentCleaner") {
      const pair = colours();
      return {
        compactComments: values.compactComments, hideCommentControls: values.hideCommentControls,
        colourCommenters: values.colourMode !== "off",
        commenterColour: values.colourMode === "preset" ? "var(--ytms-viewer-colour, #82a3e6)" : (pair?.[0] || defaults.viewerColour),
        uploaderColour: values.colourMode === "preset" ? "var(--ytms-owner-colour, #ff9f1c)" : (pair?.[1] || defaults.ownerColour),
      };
    }
    if (id === "feedUiCleaner") return {
      filterProfiles: Object.fromEntries(Object.entries(config.filterProfiles).map(([route, profile]) => [route, {
        ...profile, mixes: values.hideMixes, membersOnly: values.hideMembersOnly, podcasts: values.hidePodcasts,
      }])),
    };
    if (id === "playerPreferencesLite") return {
      hideShorts: values.hideShorts, hideWatchedVideos: values.hideWatchedVideos,
      watchedVideoThresholdPercent: Number(values.watchedThreshold),
      useReadableYellowCaptions: values.yellowCaptions, enableVideoMirrorButton: values.mirrorButton,
      enableTheaterMode: values.theatreMode, enablePlayerWheelVolume: values.wheelVolume,
      preferredVideoQuality: values.preferredVideoQuality,
      wheelVolumeStep: Number(values.wheelStep), hideRelatedVideos: values.hideRelated,
      hideChat: values.hideChat, hideInfoCards: values.hideInfoCards,
      hideEndScreenRecommendationGrid: values.hideEndScreens, enableFullscreenComments: values.fullscreenComments,
      disableTitleHashtagLinks: values.disableTitleHashtagLinks,
      showRydTooltipBar: values.showRydTooltipBar,
      showDeArrowTitleButton: values.showDeArrowTitleButton,
      feedFilterProfiles: Object.fromEntries(Object.entries(config.feedFilterProfiles).map(([route, profile]) => [route, {
        ...profile, watchedVideos: route === "history" ? false : values.hideWatchedVideos,
      }])),
    };
    if (id === "scrollMiniplayer") return { enabled: values.miniplayerEnabled, showCompactQueueInfo: values.queueInfo };
    if (id === "watchLayoutCleaner") return {
      relatedVideosHideBreakpointPx: values.hideRelated ? config.relatedVideosHideBreakpointPx : 0,
      showDeArrowQueueButton: values.showDeArrowQueueButton,
    };
    return {};
  }
  return Object.freeze({ key, cornerKey, defaults, initial, read, save, validate, colours, normaliseHex, overrides });
}
