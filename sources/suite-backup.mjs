// Self-contained factory embedded by the builder. Saved preferences only;
// no account, browsing history, network, file or clipboard access.
export function createSuiteBackup(getStorage, settings, channelAge) {
  const format = "youtube-master-suite-backup";
  const channelFormat = "youtube-master-suite-channel-filters";
  const limit = 128 * 1024;
  const keys = [settings.key, settings.cornerKey, channelAge.key];
  const settingNames = Object.keys(settings.defaults);
  // Older version 1 backups gain defaults for these newer preferences only.
  // Keep every pre-existing field required and validate optional fields if present.
  const requiredSettingNames = settingNames.filter(name =>
    name !== "hideFullscreenQuickActions" && name !== "liveChatButton" &&
    name !== "hideLiveVideos" && name !== "hideUpcomingStreams" && name !== "timelinePreviewSize");
  const ruleNames = ["channelId", "name", "maxAge", "unit", "enabled", "blocked"];
  const previews = new WeakMap();
  const channelPreviews = new WeakMap();
  const warning = "Restoring replaces all saved Suite settings and channel upload filters. Channel names and IDs are included; history and account data are not.";
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const clone = value => JSON.parse(JSON.stringify(value));

  function fail(message) { throw new Error(message); }

  function checkObject(value, allowed, required = allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(name => !allowed.includes(name)) ||
        required.some(name => !Object.hasOwn(value, name))) {
      fail("The backup contains missing, unknown or incompatible fields.");
    }
  }

  function checkedSettings(input, complete = true) {
    checkObject(input, settingNames, complete ? requiredSettingNames : []);
    const values = settings.validate(input);
    for (const name of Object.keys(input)) {
      // This exact earlier default is a supported preference migration, not a
      // malformed custom order. Keep all other normalisation failures rejected.
      if (name === "menuItemOrder" && settings.isPreviousDefaultMenuOrder(input[name])) continue;
      if (!same(input[name], values[name])) fail(`The backup contains an invalid setting: ${name}.`);
    }
    return values;
  }

  function checkedRules(input, complete = true) {
    if (!Array.isArray(input) || input.length > 100) fail("Use a backup containing no more than 100 channel filters.");
    for (const rule of input) checkObject(rule, ruleNames, complete ? ruleNames : ["channelId", "maxAge", "unit"]);
    const rules = channelAge.validateRules(input);
    if (rules.length !== input.length) fail("The backup contains invalid or duplicate channel filters.");
    for (let index = 0; index < input.length; index += 1) {
      for (const name of Object.keys(input[index])) {
        if (!same(input[index][name], rules[index][name])) fail("The backup contains an invalid channel filter.");
      }
    }
    return rules;
  }

  function readRaw(storage) {
    return keys.map(key => storage.getItem(key));
  }

  function currentChannelRules(raw) {
    if (raw === null) return [];
    if (typeof raw !== "string" || raw.length > 65536) fail("Saved channel filters are too large to back up safely.");
    const record = JSON.parse(raw);
    checkObject(record, ["version", "rules"]);
    if (record.version !== 1) fail("Saved channel filters use an unsupported version.");
    return checkedRules(record.rules, false);
  }

  function currentData(raw) {
    let values = settings.validate({});
    let rules = [];
    if (raw[0] !== null) {
      if (raw[0].length > 8192) fail("Saved settings are too large to back up safely.");
      const record = JSON.parse(raw[0]);
      checkObject(record, ["version", "values"]);
      if (record.version !== 1) fail("Saved settings use an unsupported version.");
      values = checkedSettings(record.values, false);
    }
    if (raw[1] !== null) values = checkedSettings({ ...values, corner: raw[1] });
    rules = currentChannelRules(raw[2]);
    return { values, rules };
  }

  function frozen(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(frozen);
      Object.freeze(value);
    }
    return value;
  }

  function summarise(previous, next) {
    const before = new Map(previous.rules.map(rule => [rule.channelId, rule]));
    const after = new Map(next.rules.map(rule => [rule.channelId, rule]));
    return frozen({
      settingChanges: settingNames.filter(name => !same(previous.values[name], next.values[name]))
        .map(name => ({ name, before: clone(previous.values[name]), after: clone(next.values[name]) })),
      filters: {
        added: next.rules.filter(rule => !before.has(rule.channelId)).length,
        changed: next.rules.filter(rule => before.has(rule.channelId) && !same(before.get(rule.channelId), rule)).length,
        removed: previous.rules.filter(rule => !after.has(rule.channelId)).length,
        total: next.rules.length,
      },
      warning,
    });
  }

  function exportData() {
    try {
      const storage = getStorage();
      const raw = readRaw(storage);
      const data = currentData(raw);
      if (!same(readRaw(storage), raw)) fail("Saved data changed while preparing the backup. Please try again.");
      const text = JSON.stringify({ format, version: 1, language: "en-GB", settings: data.values, channelFilters: data.rules }, null, 2);
      return { ok: true, text, summary: summarise(data, data) };
    } catch (error) {
      return { ok: false, error: error?.message || "The backup could not be created. Browser storage is unavailable." };
    }
  }

  function preview(text) {
    try {
      if (typeof text !== "string" || text.length > limit || !text.trim() || new TextEncoder().encode(text).length > limit) {
        fail("Choose a Suite backup no larger than 128 KiB.");
      }
      const record = JSON.parse(text);
      checkObject(record, ["format", "version", "language", "settings", "channelFilters"]);
      if (record.format !== format || record.version !== 1 || record.language !== "en-GB") {
        fail("This is not a supported YouTube Master Suite backup.");
      }
      const next = { values: checkedSettings(record.settings), rules: checkedRules(record.channelFilters) };
      const storage = getStorage();
      const raw = readRaw(storage);
      const previous = currentData(raw);
      if (!same(readRaw(storage), raw)) fail("Saved data changed while preparing the preview. Please try again.");
      const summary = summarise(previous, next);
      const token = Object.freeze({});
      previews.set(token, { next: frozen(clone(next)), raw: Object.freeze([...raw]), summary });
      return { ok: true, preview: token, summary };
    } catch (error) {
      return { ok: false, error: error?.message || "The backup could not be read. No settings were changed." };
    }
  }

  function restore(token) {
    const staged = token && typeof token === "object" ? previews.get(token) : null;
    if (!staged) return { ok: false, error: "The restore preview has expired. Select the backup again." };
    previews.delete(token);
    let storage;
    try {
      storage = getStorage();
      if (!same(readRaw(storage), staged.raw)) {
        return { ok: false, conflict: true, error: "Saved settings or channel filters changed after this preview. Preview the backup again; no changes were made." };
      }
    } catch {
      return { ok: false, error: "Browser storage is unavailable. No settings were changed." };
    }
    const desired = [JSON.stringify({ version: 1, values: staged.next.values }), staged.next.values.corner,
      JSON.stringify({ version: 1, rules: staged.next.rules })];
    const attempted = [];
    const expected = [...staged.raw];
    try {
      for (let index = 0; index < keys.length; index += 1) {
        if (!same(readRaw(storage), expected)) fail("Saved data changed during the restore.");
        if (desired[index] === staged.raw[index]) continue;
        attempted.push(index);
        storage.setItem(keys[index], desired[index]);
        expected[index] = desired[index];
      }
      if (!same(readRaw(storage), desired)) fail("Browser storage did not retain the complete backup.");
    } catch {
      for (const index of attempted.reverse()) {
        try {
          const current = storage.getItem(keys[index]);
          // Do not overwrite a concurrent third-party value while rolling back.
          if (current === staged.raw[index] || current !== desired[index]) continue;
          if (staged.raw[index] === null) storage.removeItem(keys[index]);
          else storage.setItem(keys[index], staged.raw[index]);
        } catch { /* The complete raw readback below determines rollback success. */ }
      }
      let rollbackComplete = false;
      try { rollbackComplete = same(readRaw(storage), staged.raw); } catch { /* Storage remains unavailable. */ }
      channelAge.read();
      return { ok: false, rollbackComplete, reloadRequired: !rollbackComplete,
        error: rollbackComplete
          ? "The backup could not be restored. Previous saved settings and channel filters have been restored."
          : "The restore failed and previous saved data could not be fully restored. Reload this page and review your settings and channel filters." };
    }
    channelAge.read();
    return { ok: true, values: clone(staged.next.values), rules: clone(staged.next.rules), summary: staged.summary };
  }

  function exportChannels() {
    try {
      const storage = getStorage();
      const raw = storage.getItem(channelAge.key);
      const rules = currentChannelRules(raw);
      if (storage.getItem(channelAge.key) !== raw) fail("Saved channel filters changed while preparing the export. Please try again.");
      const text = JSON.stringify({ format: channelFormat, version: 1, language: "en-GB", channelFilters: rules }, null, 2);
      return { ok: true, text, count: rules.length };
    } catch (error) {
      return { ok: false, error: error?.message || "Channel filters could not be exported. Browser storage is unavailable." };
    }
  }

  function previewChannels(text, mode = "merge") {
    try {
      if (mode !== "merge" && mode !== "replace") fail("Choose Merge or Replace for the channel import.");
      if (typeof text !== "string" || text.length > limit || !text.trim() || new TextEncoder().encode(text).length > limit) {
        fail("Choose a channel export no larger than 128 KiB.");
      }
      const record = JSON.parse(text);
      checkObject(record, ["format", "version", "language", "channelFilters"]);
      if (record.format !== channelFormat || record.version !== 1 || record.language !== "en-GB") {
        fail("This is not a supported YouTube Master Suite channel export. Use Support for full settings backups.");
      }
      const imported = checkedRules(record.channelFilters);
      const storage = getStorage();
      const raw = storage.getItem(channelAge.key);
      const previous = currentChannelRules(raw);
      const importedById = new Map(imported.map(rule => [rule.channelId, rule]));
      const before = new Map(previous.map(rule => [rule.channelId, rule]));
      const next = mode === "replace" ? imported : [
        ...previous.map(rule => importedById.get(rule.channelId) || rule),
        ...imported.filter(rule => !before.has(rule.channelId)),
      ];
      if (next.length > 100) fail("Merging would exceed 100 channel filters. Remove some channels or choose Replace.");
      if (storage.getItem(channelAge.key) !== raw) fail("Saved channel filters changed while preparing the import preview. Please try again.");
      const after = new Set(next.map(rule => rule.channelId));
      const summary = frozen({ mode, orderChanged: !same(previous.map(rule => rule.channelId), next.map(rule => rule.channelId)), filters: {
        added: next.filter(rule => !before.has(rule.channelId)).length,
        changed: next.filter(rule => before.has(rule.channelId) && !same(before.get(rule.channelId), rule)).length,
        removed: previous.filter(rule => !after.has(rule.channelId)).length,
        unchanged: next.filter(rule => before.has(rule.channelId) && same(before.get(rule.channelId), rule)).length,
        total: next.length,
      }, warning: mode === "merge"
        ? "Import updates matching channel IDs and adds new channels. Other saved channels and all Suite preferences are kept."
        : "Import replaces the complete saved channel-filter list. Channels not in this file are removed; all Suite preferences are kept." });
      const token = Object.freeze({});
      channelPreviews.set(token, { rules: frozen(clone(next)), raw, summary });
      return { ok: true, preview: token, summary };
    } catch (error) {
      return { ok: false, error: error?.message || "The channel export could not be read. No saved data was changed." };
    }
  }

  function restoreChannels(token) {
    const staged = token && typeof token === "object" ? channelPreviews.get(token) : null;
    if (!staged) return { ok: false, error: "The channel import preview has expired. Select the file again." };
    channelPreviews.delete(token);
    let storage;
    try {
      storage = getStorage();
      if (storage.getItem(channelAge.key) !== staged.raw) {
        channelAge.read();
        return { ok: false, conflict: true, error: "Saved channel filters changed after this preview. Preview the import again; no changes were made." };
      }
    } catch {
      channelAge.read();
      return { ok: false, error: "Browser storage is unavailable. No channel filters were changed." };
    }
    const desired = JSON.stringify({ version: 1, rules: staged.rules });
    let attempted = false;
    try {
      // The second preflight closes the work-between-reads window without
      // treating independent preference changes as channel-import conflicts.
      if (storage.getItem(channelAge.key) !== staged.raw) {
        channelAge.read();
        return { ok: false, conflict: true, error: "Saved channel filters changed before import. Preview the file again; no changes were made." };
      }
      if (desired !== staged.raw) {
        attempted = true;
        storage.setItem(channelAge.key, desired);
      }
      if (storage.getItem(channelAge.key) !== desired) fail("Browser storage did not retain the channel import.");
    } catch {
      if (attempted) {
        try {
          // A third-party value is not ours to overwrite during recovery.
          if (storage.getItem(channelAge.key) === desired) {
            if (staged.raw === null) storage.removeItem(channelAge.key);
            else storage.setItem(channelAge.key, staged.raw);
          }
        } catch { /* Exact readback below determines whether recovery succeeded. */ }
      }
      let rollbackComplete = false;
      try { rollbackComplete = storage.getItem(channelAge.key) === staged.raw; } catch { /* Storage remains unavailable. */ }
      channelAge.read();
      return { ok: false, rollbackComplete, reloadRequired: !rollbackComplete,
        error: rollbackComplete
          ? "The channel import failed. Previous saved channel filters have been restored; other settings were unchanged."
          : "The channel import failed and previous filters could not be fully restored. Reload and review your channel filters; other settings were unchanged." };
    }
    channelAge.read();
    return { ok: true, rules: clone(staged.rules), summary: staged.summary };
  }

  return Object.freeze({ exportData, preview, restore, exportChannels, previewChannels, restoreChannels });
}
