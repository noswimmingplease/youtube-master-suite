// Self-contained: embedded by the builder. No network access or title matching.
export function createChannelAgeService(getStorage, now = () => Date.now()) {
  const key = "yt-master-suite.channel-age.v1";
  const idPattern = /^UC[A-Za-z0-9_-]{22}$/;
  const day = 86400000;
  const units = ["days", "weeks", "months", "years"];
  let current = [];
  let enabledRules = new Map();

  function normaliseChannelId(input) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (idPattern.test(value)) return value;
    const match = /^https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(value);
    return match ? match[1] : null;
  }

  function label(input) {
    return typeof input === "string"
      ? input.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100)
      : "";
  }

  function validateRules(input) {
    if (!Array.isArray(input)) return [];
    const result = [];
    const seen = new Set();
    // Bound work even for a malformed manually edited storage record.
    for (const value of input.slice(0, 100)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const channelId = normaliseChannelId(value.channelId);
      if (!channelId || seen.has(channelId) || !Number.isInteger(value.maxAge) || value.maxAge < 1 || value.maxAge > 1000 || !units.includes(value.unit)) continue;
      if (value.enabled !== undefined && typeof value.enabled !== "boolean") continue;
      if (value.blocked !== undefined && typeof value.blocked !== "boolean") continue;
      seen.add(channelId);
      result.push({ channelId, name: label(value.name), maxAge: value.maxAge, unit: value.unit, enabled: value.enabled !== false, blocked: value.blocked === true });
    }
    return result;
  }

  function snapshot(rules) {
    return rules.map(rule => ({ ...rule }));
  }

  function setCurrent(rules) {
    current = snapshot(rules);
    enabledRules = new Map(current.filter(rule => rule.enabled).map(rule => [rule.channelId, rule]));
  }

  function storedRules(raw) {
    const record = raw && raw.length <= 65536 ? JSON.parse(raw) : null;
    return validateRules(record?.version === 1 ? record.rules : null);
  }

  function read() {
    try {
      setCurrent(storedRules(getStorage().getItem(key)));
    } catch {
      // Unavailable/corrupted storage must not hide any videos.
      setCurrent([]);
    }
    return snapshot(current);
  }

  function save(input, expectedRules) {
    let rules;
    try { rules = validateRules(input); } catch { rules = []; }
    if (!Array.isArray(input) || input.length > 100 || rules.length !== input.length) {
      return { ok: false, error: "Use up to 100 unique channel IDs, each with a whole-number age from 1 to 1000 and a valid unit." };
    }
    let storage, previous;
    try {
      storage = getStorage();
      previous = storage.getItem(key);
      if (expectedRules !== undefined) {
        let latest = [];
        try { latest = storedRules(previous); } catch { /* A corrupt record follows read()'s empty-rule fallback. */ }
        if (JSON.stringify(latest) !== JSON.stringify(expectedRules)) {
          setCurrent(latest);
          return { ok: false, error: 'Channel filters changed in another window. Your draft has been kept. Cancel and reopen before saving.' };
        }
      }
      storage.setItem(key, JSON.stringify({ version: 1, rules }));
      setCurrent(rules);
      return { ok: true, rules: snapshot(rules) };
    } catch {
      // The live snapshot changes only after a successful complete write.
      try {
        if (previous === null) storage?.removeItem(key);
        else if (previous !== undefined) storage?.setItem(key, previous);
      } catch { /* Storage is unavailable; preserve the current in-memory rules. */ }
      return { ok: false, error: "Channel filters could not be saved. Browser storage is unavailable or full." };
    }
  }

  function getRules() {
    return snapshot(current);
  }

  function hasEnabledRules() {
    return enabledRules.size > 0;
  }

  function text(value) {
    if (typeof value === "string") return value.slice(0, 500);
    if (!value || typeof value !== "object") return "";
    if (typeof value.simpleText === "string") return value.simpleText.slice(0, 500);
    if (typeof value.content === "string") return value.content.slice(0, 500);
    return Array.isArray(value.runs) ? value.runs.slice(0, 10).map(run => typeof run?.text === "string" ? run.text : "").join("").slice(0, 500) : "";
  }

  function records(card) {
    const found = [];
    const nodes = [card, ...Array.from(card?.querySelectorAll?.("ytd-rich-grid-media, yt-lockup-view-model, ytm-lockup-view-model") || []).slice(0, 4)];
    for (const node of nodes) {
      let controller, componentData;
      try {
        controller = node?.polymerController || (typeof node?.getPolymerController === "function" ? node.getPolymerController() : null);
      } catch { /* An unavailable renderer controller must not prevent DOM identity checks. */ }
      try {
        if (typeof node?.componentProps?.data === "function") componentData = node.componentProps.data();
      } catch { /* A detached current component retains the existing DOM/legacy fallback. */ }
      for (const value of [node?.data, node?.__data?.data, controller?.data, controller?.__data?.data, componentData]) {
        if (!value || typeof value !== "object") continue;
        found.push(value);
        for (const candidate of [value.videoRenderer, value.compactVideoRenderer, value.gridVideoRenderer, value.content?.videoRenderer, value.content?.richItemRenderer?.content?.videoRenderer, value.lockupViewModel]) {
          if (candidate && typeof candidate === "object") found.push(candidate);
        }
      }
    }
    return found.slice(0, 30);
  }

  function metadataParts(record) {
    const rows = record?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows
      || record?.metadata?.contentMetadataViewModel?.metadataRows;
    return Array.isArray(rows) ? rows.slice(0, 4).flatMap(row => Array.isArray(row?.metadataParts) ? row.metadataParts.slice(0, 5) : []) : [];
  }

  function channelFromCard(card) {
    if (!card?.querySelectorAll) return null;
    const candidates = new Map();
    function add(id, name) {
      const channelId = normaliseChannelId(id);
      if (!channelId) return;
      candidates.set(channelId, candidates.get(channelId) || label(name));
    }
    const bylineSelector = [
      "#channel-name a[href]", "#byline a[href]", "ytd-channel-name a[href]",
      ".yt-content-metadata-view-model__metadata-text a[href]",
      ".yt-content-metadata-view-model__metadata-row a[href]",
      ".ytContentMetadataViewModelMetadataText a[href]",
    ].join(",");
    for (const anchor of Array.from(card.querySelectorAll(bylineSelector)).slice(0, 20)) {
      const href = anchor.getAttribute("href") || "";
      add(href.startsWith("/channel/") ? `https://www.youtube.com${href}` : href, anchor.textContent);
    }
    for (const record of records(card)) {
      // Current History lockups keep the owner endpoint on the avatar, while
      // their visible byline is plain text rather than a clickable channel link.
      const avatar = record.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel;
      add(avatar?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId,
        text(metadataParts(record)[0]?.text));
      for (const byline of [record.ownerText, record.shortBylineText, record.longBylineText]) {
        for (const run of Array.isArray(byline?.runs) ? byline.runs.slice(0, 5) : []) {
          add(run?.navigationEndpoint?.browseEndpoint?.browseId, run?.text);
        }
      }
      for (const part of metadataParts(record)) {
        for (const run of Array.isArray(part?.text?.commandRuns) ? part.text.commandRuns.slice(0, 5) : []) {
          const command = run?.onTap?.innertubeCommand || run?.onTap;
          add(command?.browseEndpoint?.browseId, text(part.text));
        }
      }
    }
    if (candidates.size !== 1) return null;
    const [channelId, name] = candidates.entries().next().value;
    return { channelId, name: name || channelId };
  }

  function liveOrUpcoming(card, data) {
    if (card.matches?.('[data-ytppl-upcoming-hidden="1"]') || card.querySelector('[overlay-style="LIVE"], [overlay-style="UPCOMING"], [data-ytppl-upcoming-hidden="1"]')) return true;
    for (const element of Array.from(card.querySelectorAll("ytd-badge-supported-renderer, ytd-thumbnail-overlay-time-status-renderer, .yt-badge-shape__text, .ytBadgeShapeBadgeText")).slice(0, 20)) {
      if (/^(?:live|live now|upcoming|premiere|scheduled)$/i.test(String(element.textContent || "").trim())) return true;
    }
    return data.some(record => record.isLiveNow === true || Boolean(record.upcomingEventData)
      || (Array.isArray(record.badges) && record.badges.slice(0, 5).some(badge => /LIVE_NOW|UPCOMING/.test(badge?.metadataBadgeRenderer?.style || "")))
      || (Array.isArray(record.thumbnailOverlays) && record.thumbnailOverlays.slice(0, 5).some(overlay => /^(?:LIVE|UPCOMING)$/.test(overlay?.thumbnailOverlayTimeStatusRenderer?.style || ""))));
  }

  function subtractMonths(timestamp, count) {
    const date = new Date(timestamp);
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - count);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDay));
    return date.getTime();
  }

  function cutoff(rule, timestamp) {
    if (rule.unit === "months" || rule.unit === "years") return subtractMonths(timestamp, rule.maxAge * (rule.unit === "years" ? 12 : 1));
    return timestamp - rule.maxAge * (rule.unit === "weeks" ? 7 : 1) * day;
  }

  function latestPublication(value, timestamp) {
    const source = String(value || "").replace(/\s+/g, " ").trim();
    const relative = /^(?:(?:streamed|premiered)\s+)?(\d{1,4})\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(source);
    if (relative) {
      const number = Number(relative[1]);
      if (!number || number > 1000) return null;
      // YouTube rounds relative labels. Use the youngest possible date, never
      // a midpoint. Months use 28 days so short calendar months remain safe.
      const minimumMs = { second: 1000, minute: 60000, hour: 3600000, day, week: 7 * day, month: 28 * day, year: 365 * day }[relative[2].toLowerCase()];
      return timestamp - number * minimumMs;
    }
    if (/^(?:today|yesterday|just now)$/i.test(source)) return timestamp;
    if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(source)) {
      const result = Date.parse(source);
      if (!Number.isFinite(result)) return null;
      // Reject date overflow such as February 31 rather than normalising it.
      if (new Date(result).toISOString().slice(0, 10) !== source.slice(0, 10)) return null;
      return source.length === 10 ? result + day - 1 : result;
    }
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const absolute = /^(?:(?:streamed|premiered)\s+(?:on\s+)?)?([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/i.exec(source)
      || /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(source);
    if (!absolute) return null;
    const monthFirst = /^[A-Za-z]/.test(absolute[1]);
    const month = months[(monthFirst ? absolute[1] : absolute[2]).slice(0, 3).toLowerCase()];
    const date = Number(monthFirst ? absolute[2] : absolute[1]);
    const year = Number(absolute[3]);
    if (month === undefined || year < 2005 || year > 9999 || date < 1 || date > 31) return null;
    const result = new Date(Date.UTC(year, month, date));
    if (result.getUTCMonth() !== month || result.getUTCDate() !== date) return null;
    return result.getTime() + day - 1;
  }

  function isOlderThanRule(card, rule) {
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp)) return false;
    const data = records(card);
    if (liveOrUpcoming(card, data)) return false;
    const dates = [];
    for (const record of data) {
      dates.push(text(record.publishedTimeText));
      for (const part of metadataParts(record)) dates.push(text(part.text));
    }
    const selector = '#metadata-line > span, #metadata-line > yt-formatted-string, #metadata > span, .yt-content-metadata-view-model__metadata-text, .ytContentMetadataViewModelMetadataText, time[datetime]';
    for (const element of Array.from(card.querySelectorAll(selector)).slice(0, 20)) {
      dates.push(element.getAttribute("datetime") || element.textContent);
    }
    const publications = dates.map(value => latestPublication(value, timestamp)).filter(value => value !== null);
    // A fresh DOM date alongside stale renderer data must keep the card visible
    // while YouTube recycles it. Ambiguous dates therefore fail open.
    return publications.length > 0 && Math.max(...publications) < cutoff(rule, timestamp);
  }

  function cardFilterReason(card) {
    if (!enabledRules.size || !card?.querySelectorAll) return null;
    const owner = channelFromCard(card);
    const rule = owner && enabledRules.get(owner.channelId);
    if (!rule) return null;
    // Suite-owned blocks are not YouTube recommendation-feedback history.
    // Deliberately hide all uploads, including undated/live cards, but only
    // on the feed surfaces selected by the caller.
    if (rule.blocked) return "Channel hidden";
    return isOlderThanRule(card, rule) ? "Channel age" : null;
  }

  function isCardTooOld(card) {
    return cardFilterReason(card) === "Channel age";
  }

  read();
  return { key, normaliseChannelId, validateRules, read, save, getRules, hasEnabledRules, channelFromCard, cardFilterReason, isCardTooOld };
}
