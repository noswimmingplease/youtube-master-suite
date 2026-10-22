// ==UserScript==
// @name         YouTube Suite Settings
// @namespace    Citizen.youtube.suite-settings
// @version      1.30
// @description  Master-only native-style settings panel accessible from the header and watch player.
// @author       Citizen
// @license      GNU GPLv3
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";
  // This canonical module uses the master's validated preference service and embedded assets.
  const settings = suite.settings;
  const BUTTON_ID = "ytms-settings-button";
  const PLAYER_BUTTON_ID = "ytms-player-settings-button";
  const TOOLTIP_ID = "ytms-player-settings-tooltip";
  const DIALOG_ID = "ytms-settings-dialog";
  let panel = null;
  let frame = 0;
  let suspended = false;
  let watchedMasthead = null;
  let watchedApp = null;
  let watchedMastheadContainer = null;
  let discoveryActive = false;
  let button = null;
  let playerButton = null;
  let playerTooltip = null;
  let playerTarget = null;
  let watchedPlayerBranch = [];
  let channelAgeDialog = null;

  suite.openChannelAgeSettings = channel => {
    if (suspended) return;
    hidePlayerTooltip();
    try {
      channelAgeDialog ||= suite.createChannelAgeDialog(document, suite.channelAge);
      channelAgeDialog.open(channel);
    } catch (error) {
      suite.reportModuleError('suiteSettings', 'open channel upload filters', error);
    }
  };
  suite.installVideoMenu(suite);

  function createPanel() {
    const dialog = suite.createSettingsDialog(document);
    document.body.append(dialog);

    const $ = id => dialog.querySelector(`[id="ytms-${id}"]`);
    const DEFAULTS = settings.defaults;
    const GROUPS = {
      feed: [
        ['hideShorts', 'Hide Shorts'], ['hideWatchedVideos', 'Hide watched videos'],
        ['hideMixes', 'Hide mixes'], ['hidePodcasts', 'Hide podcasts'], ['hideMembersOnly', 'Hide members-only videos'],
        ['watchedThreshold', 'Watched threshold', ['80', '90', '95', '100'], value => `${value}%`],
      ],
      player: [
        ['yellowCaptions', 'Readable yellow captions'], ['mirrorButton', 'Show mirror button'],
        ['theatreMode', 'Automatic theatre mode'], ['wheelVolume', 'Right-button wheel volume'],
        ['wheelStep', 'Volume step', ['1', '2', '5', '10'], value => `${value}%`],
        ['preferredVideoQuality', 'Preferred video quality', ['off', 'highest', 'tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160'],
          value => ({ off: 'YouTube default', highest: 'Highest available', tiny: '144p', small: '240p', medium: '360p', large: '480p',
            hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p (4K)' })[value]],
      ],
      layout: [
        ['hideRelated', 'Hide related videos'], ['hideChat', 'Hide live chat'], ['hideInfoCards', 'Hide info cards'],
        ['hideEndScreens', 'Hide end-screen recommendations'], ['fullscreenComments', 'Scrollable fullscreen comments'],
        ['disableTitleHashtagLinks', 'Disable hashtag links in titles'],
      ],
      miniplayer: [
        ['miniplayerEnabled', 'Scroll miniplayer'],
        ['corner', 'Preferred corner', ['top-right', 'bottom-right', 'bottom-left', 'top-left'], value => value.replace('-', ' ')],
        ['queueInfo', 'Show compact title and queue information'],
      ],
      interface: [
        ['headerSettingsIcon', 'Header button', ['off', 'colour', 'monochrome'], value => value[0].toUpperCase() + value.slice(1)],
        ['playerSettingsIcon', 'Video player button', ['off', 'colour', 'monochrome'], value => value[0].toUpperCase() + value.slice(1)],
        ['showRydTooltipBar', 'Show Return YouTube Dislike tooltip bar'],
        ['showDeArrowTitleButton', 'Show DeArrow icon beside video title'],
        ['showDeArrowQueueButton', 'Show DeArrow logo in queues'],
        ['menuShowDownload', 'Show Download in video menus'],
        ['menuGroupChannelTools', 'Group channel tools in a submenu'],
        ['menuShowAgeLimit', 'Show Filter channel uploads action'],
        ['menuShowNotInterested', 'Show Not interested'],
        ['menuShowDontRecommend', 'Show Don’t recommend channel'],
        ['menuShowReport', 'Show Report'],
      ],
    };
    const DESCRIPTIONS = {
      hideShorts: 'Remove Shorts shelves and cards from feeds and search results.',
      hideWatchedVideos: 'Hide videos already watched past your threshold. Watch History is left unchanged.',
      hideMixes: 'Remove automatically generated mix cards from supported feeds.',
      hidePodcasts: 'Remove podcast cards and shelves from supported feeds.',
      hideMembersOnly: 'Remove cards for videos restricted to channel members.',
      watchedThreshold: 'Choose how much watched progress is required before a video card is hidden.',
      yellowCaptions: 'Use readable yellow subtitles with a black shadow in the player and inline previews.',
      mirrorButton: 'Show the horizontal flip control. Only the video image is mirrored, not captions or controls.',
      theatreMode: 'Start watch videos in YouTube’s theatre view.',
      wheelVolume: 'Hold the right mouse button and scroll over the player to adjust volume.',
      wheelStep: 'Choose the volume change for each wheel step during the right-button gesture.',
      preferredVideoQuality: 'Request this quality on each new video, or the nearest lower available resolution. Opening native player settings stops pending attempts. Higher quality uses more bandwidth. Applies after reload.',
      hideRelated: 'Hide suggested videos beside the watch page without hiding the active queue.',
      hideChat: 'Hide live-chat panels without removing other engagement panels.',
      hideInfoCards: 'Hide in-video information cards and their buttons.',
      hideEndScreens: 'Hide end-screen recommendation tiles without taking over native autoplay.',
      fullscreenComments: 'Scroll to existing comments while page fullscreen remains active. Player-only fullscreen is unchanged.',
      disableTitleHashtagLinks: 'Keep hashtag text as ordinary title text without opening hashtag pages. Preserves YouTube’s title nodes and DeArrow replacements. Applies after reload.',
      miniplayerEnabled: 'Float the watch player into a corner when it scrolls out of view.',
      corner: 'Choose the floating player’s corner. This also synchronises with other open YouTube windows.',
      queueInfo: 'Show the current title and queue position at the top of the floating player.',
      headerSettingsIcon: 'Choose the icon beside your profile button. Available on feed and watch pages.',
      playerSettingsIcon: 'Choose the icon before Mirror video in watch and live player controls.',
      showRydTooltipBar: 'Show Return YouTube Dislike’s tooltip bar. Hidden by default; dislike counts and voting buttons are unchanged. Applies after reload.',
      showDeArrowTitleButton: 'Show DeArrow’s title-button controls beside the watch-page title. Hidden by default; title and thumbnail replacements remain active. Applies after reload.',
      showDeArrowQueueButton: 'Show DeArrow’s original/custom toggle logo in queue titles. Hiding it does not disable DeArrow title or thumbnail replacements.',
      menuShowDownload: 'Show YouTube’s Download action when available. Hidden by default; this does not enable downloads or change your account permissions.',
      menuGroupChannelTools: 'On: place Don’t recommend channel, Report and Filter channel uploads in a Channel tools submenu. Off: keep enabled actions separate in the main menu. Not interested always stays in the main menu. Save and reload to apply.',
      menuShowAgeLimit: 'Add Filter channel uploads to set how old a selected channel’s uploads can be. It appears at the bottom by default.',
      menuShowNotInterested: 'Keep YouTube’s Not interested action visible when the video menu provides it.',
      menuShowDontRecommend: 'Keep YouTube’s Don’t recommend channel action available, separately or inside Channel tools.',
      menuShowReport: 'Keep YouTube’s Report action available, separately or inside Channel tools. A report is never submitted automatically.',
    };
    let saved = settings.read();
    let draft = { ...saved };
    let externalConflict = false;
    let pickerTarget = null;
    let pickerTrigger = null;
    let currentTab = 'comments';

    let supportPanel = null;
    const tabIds = ['comments', 'feed', 'channels', 'player', 'layout', 'miniplayer', 'interface', 'extensions', 'support', 'credits'];
    function selectTab(id, focus = false) {
      closePicker(false);
      currentTab = id;
      $('restore-section-defaults').disabled = ['channels', 'extensions', 'support', 'credits'].includes(id);
      for (const tab of tabIds) {
        const selected = tab === id;
        const section = $(`section-${tab}`), button = $(`tab-${tab}`);
        if (section.hidden === selected) section.hidden = !selected;
        if (button.getAttribute('aria-selected') !== String(selected)) button.setAttribute('aria-selected', String(selected));
        if (button.tabIndex !== (selected ? 0 : -1)) button.tabIndex = selected ? 0 : -1;
      }
      dialog.querySelector('.content').scrollTop = 0;
      if (id === 'channels') renderChannelRules();
      if (id === 'support') supportPanel?.refresh();
      if (focus) $(`tab-${id}`).focus();
    }
    for (const id of tabIds) {
      const tab = document.createElement('button');
      tab.id = `ytms-tab-${id}`; tab.textContent = id === 'miniplayer' ? 'Miniplayer' : id[0].toUpperCase() + id.slice(1);
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `ytms-section-${id}`);
      tab.addEventListener('click', () => selectTab(id));
      tab.addEventListener('keydown', event => {
        const index = tabIds.indexOf(id);
        const next = event.key === 'ArrowRight' ? (index + 1) % tabIds.length :
          event.key === 'ArrowLeft' ? (index + tabIds.length - 1) % tabIds.length :
          event.key === 'Home' ? 0 : event.key === 'End' ? tabIds.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); selectTab(tabIds[next], true); }
      });
      dialog.querySelector('nav').append(tab);
    }
    const menuDetails = document.createElement('details'); menuDetails.id = 'ytms-video-menu-settings';
    const menuSummary = document.createElement('summary'); menuSummary.textContent = 'Video context menu';
    menuDetails.append(menuSummary); $('section-interface').append(menuDetails);
    for (const [group, rows] of Object.entries(GROUPS)) {
      for (const [key, labelText, choices, format] of rows) {
        const row = document.createElement('div'); row.className = 'row';
        const label = document.createElement('label'); label.htmlFor = `ytms-${key}`; label.textContent = labelText;
        const description = document.createElement('span'); description.className = 'description';
        description.id = `ytms-${key}-description`; description.textContent = DESCRIPTIONS[key]; label.append(description);
        const input = document.createElement(choices ? 'select' : 'input'); input.id = `ytms-${key}`;
        input.setAttribute('aria-describedby', description.id);
        if (choices) {
          for (const value of choices) { const option = document.createElement('option'); option.value = value; option.textContent = format(value); input.append(option); }
        } else { input.type = 'checkbox'; input.className = 'switch'; input.setAttribute('role', 'switch'); }
        row.append(label, input);
        if (group === 'interface' && key.startsWith('menu')) menuDetails.append(row);
        else $(`section-${group}`).insertBefore(row, group === 'interface' ? menuDetails : null);
        input.addEventListener('change', () => { draft[key] = choices ? input.value : input.checked; updateColours(); });
      }
    }
    const ageRow = document.createElement('div'); ageRow.className = 'row';
    const ageLabel = document.createElement('div'); ageLabel.className = 'row-label';
    ageLabel.textContent = 'Channel upload filters';
    const ageDescription = document.createElement('span'); ageDescription.className = 'description';
    ageDescription.id = 'ytms-channel-age-description';
    ageDescription.textContent = 'Choose how old each channel’s uploads can be: days, weeks, months or years. Watched-video filtering remains independent. Manage and save these filters separately; the settings reset buttons leave them unchanged.';
    ageLabel.append(ageDescription);
    const ageButton = document.createElement('button'); ageButton.id = 'ytms-manage-channel-age';
    ageButton.type = 'button'; ageButton.className = 'text-button outlined-button'; ageButton.textContent = 'Manage filters';
    ageButton.setAttribute('aria-label', 'Manage channel upload filters');
    ageButton.setAttribute('aria-describedby', ageDescription.id); ageButton.setAttribute('aria-haspopup', 'dialog');
    ageButton.addEventListener('click', () => suite.openChannelAgeSettings());
    const channelNote = document.createElement('p'); channelNote.className = 'section-note';
    channelNote.textContent = 'This list contains filters saved by YouTube Master Suite in this browser profile. YouTube’s own Don’t recommend channel choices are separate and are not included here. Edit or remove a filter in the manager, then choose Save filters to apply it.';
    const channelHelp = document.createElement('a'); channelHelp.className = 'channel-filter-help';
    channelHelp.textContent = 'Manage YouTube’s own recommendation controls';
    channelHelp.href = 'https://support.google.com/youtube/answer/6342839?hl=en&co=GENIE.Platform%3DDesktop';
    channelHelp.target = '_blank'; channelHelp.rel = 'noopener noreferrer';
    channelHelp.setAttribute('aria-label', 'Manage YouTube’s own recommendation controls (opens in a new tab)');
    const channelList = document.createElement('div'); channelList.id = 'ytms-channel-filter-list';
    channelList.setAttribute('role', 'list'); channelList.setAttribute('aria-label', 'Saved channel upload filters');
    ageRow.append(ageLabel, ageButton); $('section-channels').append(ageRow, channelNote, channelHelp, channelList);
    function renderChannelRules() {
      channelList.replaceChildren();
      const rules = suite.channelAge.read();
      if (!rules.length) {
        const empty = document.createElement('p'); empty.className = 'section-note'; empty.textContent = 'No channel upload filters saved.';
        channelList.append(empty);
      }
      for (const rule of rules) {
        const card = document.createElement('article'); card.className = 'channel-filter-card'; card.setAttribute('role', 'listitem');
        const title = document.createElement('h3'); title.textContent = rule.name || rule.channelId;
        const id = document.createElement('p'); id.className = 'channel-filter-id'; id.textContent = rule.channelId;
        const age = document.createElement('p'); age.textContent = `Maximum upload age: ${rule.maxAge} ${rule.maxAge === 1 ? rule.unit.slice(0, -1) : rule.unit}`;
        const status = document.createElement('p'); status.className = 'channel-filter-status';
        status.textContent = `Status: ${!rule.enabled ? 'Disabled' : rule.blocked ? 'All uploads hidden' : 'Enabled'}`;
        const actions = document.createElement('div'); actions.className = 'channel-filter-actions';
        for (const [label, remove] of [['Edit', false], ['Remove', true]]) {
          const action = document.createElement('button'); action.type = 'button';
          action.className = `text-button ${remove ? 'danger-button' : 'outlined-button'}`;
          action.textContent = `${label} filter`; action.setAttribute('aria-label', `${label} filter for ${rule.name || rule.channelId}`);
          action.addEventListener('click', () => suite.openChannelAgeSettings({ channelId: rule.channelId, name: rule.name, ...(remove ? { remove: true } : {}) }));
          actions.append(action);
        }
        card.append(title, id, age, status, actions); channelList.append(card);
      }
    }

    const menuOrder = document.createElement('section'); menuOrder.className = 'menu-order';
    const menuOrderHeading = document.createElement('h3'); menuOrderHeading.textContent = 'Video context menu order';
    const menuOrderNote = document.createElement('p'); menuOrderNote.className = 'section-note';
    menuOrderNote.id = 'ytms-menu-order-description';
    menuOrderNote.textContent = 'Use the arrows to arrange recognised video actions. Hidden or unavailable actions are skipped. Grouped actions keep their relative order inside Channel tools; other YouTube items are left available.';
    const menuOrderList = document.createElement('ol'); menuOrderList.id = 'ytms-menu-order';
    menuOrderList.setAttribute('aria-label', 'Video context menu order'); menuOrderList.setAttribute('aria-describedby', menuOrderNote.id);
    const menuLabels = {
      playNext: 'Play next in queue', addToQueue: 'Add to queue', watchLater: 'Save to Watch Later',
      savePlaylist: 'Save to playlist', download: 'Download', share: 'Share', notInterested: 'Not interested',
      dontRecommend: 'Don’t recommend channel', report: 'Report', channelAge: 'Filter channel uploads', channelTools: 'Channel tools submenu',
    };
    function renderMenuOrder(focusId, focusDirection) {
      menuOrderList.replaceChildren();
      const order = draft.menuItemOrder;
      for (const [index, id] of order.entries()) {
        const item = document.createElement('li'); item.dataset.menuItem = id;
        const label = document.createElement('span'); label.textContent = menuLabels[id];
        item.append(label);
        for (const [direction, text, offset] of [['up', '↑', -1], ['down', '↓', 1]]) {
          const move = document.createElement('button'); move.type = 'button'; move.className = 'menu-order-move';
          move.dataset.direction = direction; move.textContent = text;
          move.setAttribute('aria-label', `Move ${menuLabels[id]} ${direction}`);
          move.disabled = index + offset < 0 || index + offset >= order.length;
          move.addEventListener('click', () => {
            const next = [...draft.menuItemOrder];
            [next[index], next[index + offset]] = [next[index + offset], next[index]];
            draft.menuItemOrder = next; markDraftChanged(); renderMenuOrder(id, direction);
          });
          item.append(move);
        }
        menuOrderList.append(item);
        if (id === focusId) {
          const preferred = item.querySelector(`[data-direction="${focusDirection}"]`);
          (preferred?.disabled ? item.querySelector('button:not(:disabled)') : preferred)?.focus();
        }
      }
    }
    menuOrder.append(menuOrderHeading, menuOrderNote, menuOrderList); menuDetails.append(menuOrder);
    const miniplayerNote = document.createElement('p'); miniplayerNote.className = 'section-note';
    miniplayerNote.textContent = 'Size remains automatic and adapts to the available window space.';
    $('section-miniplayer').append(miniplayerNote);
    const accessNote = document.createElement('p'); accessNote.className = 'section-note';
    accessNote.textContent = 'Keep at least one button enabled. With the header button off, open a video to access settings. Changes apply after reload.';
    $('section-interface').append(accessNote);
    const extensionsHeading = document.createElement('h3'); extensionsHeading.textContent = 'Recommended extensions';
    const extensionsNote = document.createElement('p'); extensionsNote.className = 'section-note';
    extensionsNote.textContent = 'Optional companions to YouTube Master Suite. Install and manage them in your browser. This list does not check installation status or enable extensions.';
    $('section-extensions').append(extensionsHeading, extensionsNote);
    for (const extension of suite.settingsAssets.recommendedExtensions) {
      const card = document.createElement('article'); card.className = 'extension-card';
      card.id = `ytms-extension-${extension.id}`; card.setAttribute('aria-labelledby', `${card.id}-name`);
      const image = document.createElement('img'); image.src = extension.logo;
      image.alt = `${extension.name} logo`; image.width = 40; image.height = 40;
      const details = document.createElement('div'); details.className = 'extension-details';
      const name = document.createElement('h4'); name.id = `${card.id}-name`; name.textContent = extension.name;
      const description = document.createElement('p'); description.textContent = extension.description;
      const note = document.createElement('p'); note.className = 'extension-note'; note.textContent = extension.note;
      const link = document.createElement('a'); link.href = extension.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'extension-link';
      link.textContent = 'Official website'; link.setAttribute('aria-label', `${extension.name}: official website (opens in a new tab)`);
      details.append(name, description, note, link); card.append(image, details); $('section-extensions').append(card);
    }
    const credits = document.createElement('div'); credits.className = 'credits';
    const logo = document.createElement('img'); logo.id = 'ytms-credits-logo';
    logo.src = suite.settingsAssets.logo; logo.alt = 'YouTube Master Suite logo'; logo.width = 96; logo.height = 96;
    const heading = document.createElement('h3'); heading.textContent = 'YouTube Master Suite';
    const author = document.createElement('p'); author.textContent = 'Created by Citizen';
    const version = document.createElement('p'); version.textContent = `Version ${suite.version} · GNU GPLv3`;
    const github = document.createElement('a'); github.id = 'ytms-credits-github';
    github.href = 'https://github.com/noswimmingplease'; github.target = '_blank'; github.rel = 'noopener noreferrer';
    github.textContent = 'noswimmingplease on GitHub';
    credits.append(logo, heading, author, version, github); $('section-credits').append(credits);
    const normaliseHex = settings.normaliseHex;
    function theme() { return document.documentElement.hasAttribute('dark') ? 'dark' : 'light'; }
    function colours() { return settings.colours(draft, theme() === 'dark'); }
    function rgb(hex) { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }
    function hex(channels) { return '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(); }
    function luminance(colour) {
      return rgb(colour).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; })
        .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    }
    function samePreferences(left, right) {
      return Object.keys(DEFAULTS).every(key => {
        const value = left[key], other = right[key];
        return Array.isArray(value) && Array.isArray(other)
          ? value.length === other.length && value.every((item, index) => item === other[index])
          : value === other;
      });
    }
    function primaryActionState() {
      const invalid = draft.colourMode === 'custom' && ['viewer', 'owner'].some(name => !normaliseHex($(`${name}-hex`).value));
      const inaccessible = draft.headerSettingsIcon === 'off' && draft.playerSettingsIcon === 'off';
      return {
        invalid, inaccessible,
        dirty: invalid || inaccessible || !samePreferences(settings.validate(draft), saved),
        pendingReload: !samePreferences(saved, settings.initial),
      };
    }
    function updatePrimaryAction() {
      const state = primaryActionState();
      const reload = !externalConflict && !state.dirty && state.pendingReload;
      const button = $('save-preview'), label = reload ? 'Reload now' : 'Save', action = reload ? 'reload' : 'save';
      const disabled = externalConflict || state.invalid || state.inaccessible || (!state.dirty && !state.pendingReload);
      if (button.textContent !== label) button.textContent = label;
      if (button.dataset.action !== action) button.dataset.action = action;
      if (button.disabled !== disabled) button.disabled = disabled;
      supportPanel?.updateDraftState();
      return state;
    }
    function showConflictNotice() {
      $('settings-status').textContent = 'Settings changed in another window. Your draft has been kept. Cancel and reopen settings before saving or reloading.';
      $('settings-status').hidden = false;
    }
    function reconcileStoredPreferences() {
      if (!dialog.open) return true;
      const current = settings.read();
      if (samePreferences(current, saved)) return !externalConflict;
      if (externalConflict || primaryActionState().dirty) {
        externalConflict = true; updatePrimaryAction(); showConflictNotice();
        return false;
      }
      saved = current; draft = { ...saved };
      closePicker(false); populate();
      $('settings-status').textContent = primaryActionState().pendingReload
        ? 'Saved settings changed in another window. Reload when ready to apply them.'
        : 'Saved settings changed in another window. They now match the settings applied to this page.';
      $('settings-status').hidden = false;
      return true;
    }
    function setHidden(element, hidden) {
      if (element.hidden !== hidden) element.hidden = hidden;
    }
    function updateColours() {
      const custom = draft.colourMode === 'custom';
      setHidden($('custom-colours'), !custom); setHidden($('palette-row'), draft.colourMode !== 'preset');
      const pair = colours(); const preview = $('comment-preview');
      if (preview.dataset.mode !== draft.colourMode) preview.dataset.mode = draft.colourMode;
      function setColourStyle(element, name, value) {
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
      }
      for (const [index, name] of ['viewer', 'owner'].entries()) {
        if (pair) setColourStyle(preview, `--${name}-colour`, pair[index]);
        else if (preview.style.getPropertyValue(`--${name}-colour`)) preview.style.removeProperty(`--${name}-colour`);
        setColourStyle($(`${name}-swatch`), '--swatch', draft[`${name}Colour`]);
      }
      const inaccessible = draft.headerSettingsIcon === 'off' && draft.playerSettingsIcon === 'off';
      setHidden($('button-access-error'), !inaccessible);
      updatePrimaryAction();
      const background = luminance(theme() === 'dark' ? '#0F0F0F' : '#FFFFFF');
      setHidden($('contrast-warning'), !pair || !pair.some(colour => {
        const foreground = luminance(colour);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) < 4.5;
      }));
    }
    function populate(keys) {
      const selected = keys ? new Set(keys) : null;
      for (const [key, value] of Object.entries(draft)) {
        if (selected && !selected.has(key)) continue;
        const input = $(key); if (!input) continue;
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
      }
      if (!selected || selected.has('colourMode')) $('colour-mode').value = draft.colourMode;
      if (!selected || selected.has('palette')) $('palette').value = draft.palette;
      for (const name of ['viewer', 'owner']) {
        if (selected && !selected.has(`${name}Colour`)) continue;
        $(`${name}-hex`).value = draft[`${name}Colour`];
        $(`${name}-hex`).setAttribute('aria-invalid', 'false'); $(`${name}-error`).hidden = true;
      }
      updateColours();
      if (!selected || selected.has('menuItemOrder')) renderMenuOrder();
    }
    function closePicker(restoreFocus = true) {
      $('colour-picker').hidden = true;
      pickerTrigger?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) pickerTrigger?.focus();
      pickerTarget = null; pickerTrigger = null;
    }
    function updateChannels() {
      const channels = rgb(draft[`${pickerTarget}Colour`]);
      ['red', 'green', 'blue'].forEach((name, index) => {
        $(name).value = channels[index]; $(`${name}-value`).value = channels[index];
        const start = [...channels]; const end = [...channels]; start[index] = 0; end[index] = 255;
        $(name).style.background = `linear-gradient(to right, ${hex(start)}, ${hex(end)})`;
      });
    }
    for (const name of ['viewer', 'owner']) {
      $(`${name}-hex`).addEventListener('input', event => {
        const value = normaliseHex(event.target.value);
        event.target.setAttribute('aria-invalid', String(!value)); $(`${name}-error`).hidden = Boolean(value);
        if (value) { draft[`${name}Colour`] = value; if (pickerTarget === name) updateChannels(); }
        updateColours();
      });
      $(`${name}-swatch`).addEventListener('click', event => {
        if (pickerTarget === name) { closePicker(); return; }
        closePicker(false); pickerTarget = name; pickerTrigger = event.currentTarget;
        pickerTrigger.setAttribute('aria-expanded', 'true'); $('colour-picker').hidden = false;
        $('picker-title').textContent = name === 'viewer' ? 'Viewer name colour' : 'Uploader and pinned colour';
        updateChannels(); $('red').focus();
      });
    }
    for (const name of ['red', 'green', 'blue']) {
      $(name).addEventListener('input', () => {
        if (!pickerTarget) return;
        draft[`${pickerTarget}Colour`] = hex(['red', 'green', 'blue'].map(channel => Number($(channel).value)));
        $(`${pickerTarget}-hex`).value = draft[`${pickerTarget}Colour`];
        $(`${pickerTarget}-hex`).setAttribute('aria-invalid', 'false'); $(`${pickerTarget}-error`).hidden = true;
        updateChannels(); updateColours();
      });
    }
    $('close-picker').addEventListener('click', () => closePicker());
    $('colour-mode').addEventListener('change', event => { closePicker(false); draft.colourMode = event.target.value; updateColours(); });
    $('palette').addEventListener('change', event => { draft.palette = event.target.value; updateColours(); });
    for (const key of ['compactComments', 'hideCommentControls']) {
      $(key).addEventListener('change', event => { draft[key] = event.target.checked; updateColours(); });
    }
    function openPanel() {
      saved = settings.read(); draft = { ...saved };
      externalConflict = false;
      supportPanel?.reset();
      menuDetails.open = false;
      $('settings-status').hidden = true;
      closePicker(false); populate(); selectTab('comments');
      if (primaryActionState().pendingReload) {
        $('settings-status').textContent = 'Saved changes are waiting for reload. This page still uses its previous settings.';
        $('settings-status').hidden = false;
      }
      dialog.showModal(); $('tab-comments').focus();
    }

    for (const id of ['close-panel', 'cancel-panel']) $(id).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => closePicker(false));
    dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape' && pickerTarget) { event.preventDefault(); closePicker(); }
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    function markDraftChanged() {
      if (externalConflict) showConflictNotice();
      else setHidden($('settings-status'), true);
      updatePrimaryAction();
    }
    dialog.addEventListener('input', markDraftChanged);
    dialog.addEventListener('change', markDraftChanged);
    function restoreDraftDefaults(keys, message) {
      for (const key of keys) draft[key] = Array.isArray(DEFAULTS[key]) ? [...DEFAULTS[key]] : DEFAULTS[key];
      markDraftChanged(); closePicker(false); populate(keys);
      if (externalConflict) { showConflictNotice(); return; }
      const state = primaryActionState();
      $('settings-status').textContent = state.dirty ? message : state.pendingReload
        ? 'Defaults match your saved settings. Reload when ready to apply them. Saved channel filters are unchanged.'
        : 'These settings already match the defaults. Saved channel filters are unchanged.';
      $('settings-status').hidden = false;
    }
    $('restore-section-defaults').addEventListener('click', () => {
      const keys = currentTab === 'comments'
        ? ['colourMode', 'palette', 'viewerColour', 'ownerColour', 'compactComments', 'hideCommentControls']
        : (GROUPS[currentTab] || []).map(([key]) => key);
      if (!keys.length) return;
      if (currentTab === 'interface') keys.push('menuItemOrder');
      restoreDraftDefaults(keys, `${$(`tab-${currentTab}`).textContent} defaults restored in this draft. Save to apply. Saved channel filters are unchanged.`);
    });
    $('restore-defaults').addEventListener('click', () => {
      restoreDraftDefaults(Object.keys(DEFAULTS), 'All settings restored in this draft. Save to apply. Saved channel filters are unchanged.');
    });
    $('save-preview').addEventListener('click', () => {
      if (!reconcileStoredPreferences()) return;
      const state = updatePrimaryAction();
      if ($('save-preview').disabled) return;
      if (!state.dirty) {
        if (state.pendingReload && window.confirm('Reload YouTube now? This will restart the current page and video.')) location.reload();
        return;
      }
      const result = settings.save(draft);
      if (result.ok) { saved = result.values; draft = { ...saved }; }
      const next = updatePrimaryAction();
      $('settings-status').hidden = false;
      $('settings-status').textContent = !result.ok ? result.error : next.pendingReload
        ? 'Saved. Please reload this page.'
        : 'Saved. No reload needed.';
    });
    supportPanel = suite.createSettingsSupportPanel(document, suite, {
      hasDraft: () => externalConflict || primaryActionState().dirty,
      onRestored: result => {
        saved = result.values; draft = { ...saved }; externalConflict = false;
        closePicker(false); populate(); renderChannelRules();
        window.dispatchEvent(new CustomEvent('yt-master-channel-age-changed'));
        $('settings-status').hidden = false;
        $('settings-status').textContent = primaryActionState().pendingReload
          ? 'Backup restored. Please reload this page.' : 'Backup restored. No reload needed.';
      },
    });
    $('section-support').append(supportPanel.element);
    dialog.addEventListener('close', () => supportPanel.close());
    populate(); selectTab('comments');
    return { dialog, open: openPanel, updateTheme: updateColours, updateChannels: renderChannelRules, reconcileSaved: reconcileStoredPreferences };

  }

  function syncTheme() {
    const pair = settings.colours();
    const coloursCss = settings.initial.colourMode === "preset" && pair
      ? `:root { --ytms-viewer-colour: ${pair[0]}; --ytms-owner-colour: ${pair[1]}; }` : "";
    suite.setStyle("suiteSettings", suite.settingsAssets.css + coloursCss);
    if (document.getElementById(DIALOG_ID)?.open) panel?.updateTheme();
  }

  function openSettings() {
    if (suspended) return;
    hidePlayerTooltip();
    try {
      if (panel && !panel.dialog.isConnected) panel = null;
      panel ||= createPanel();
      panel.open();
    } catch (error) {
      document.getElementById(DIALOG_ID)?.remove();
      panel = null;
      suite.reportModuleError("suiteSettings", "open settings", error);
    }
  }

  function isRendered(element) {
    return Boolean(element?.isConnected && !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length);
  }

  function getPlayerTarget() {
    if (location.pathname !== '/watch' && !location.pathname.startsWith('/live/')) return null;
    const floatingOwner = document.querySelector('#ytsmp-player-placeholder')?.closest('ytd-watch-flexy');
    const mirrorPlayer = document.getElementById('ytppl-video-mirror-button')?.closest('#movie_player');
    const players = new Set([mirrorPlayer, ...document.querySelectorAll('#movie_player')]);
    for (const player of players) {
      if (!isRendered(player) || player.closest('ytd-miniplayer, ytd-video-preview, ytd-reel-video-renderer')) continue;
      const root = player.closest('ytd-watch-flexy') || (player.parentElement === document.body ? floatingOwner : null);
      if (isRendered(root) && player.querySelector('video.html5-main-video')) {
        return { player, controls: player.querySelector('.ytp-right-controls'), root };
      }
    }
    const root = Array.from(document.querySelectorAll('ytd-watch-flexy')).find(isRendered);
    return root ? { root, player: null, controls: null } : null;
  }

  function hidePlayerTooltip() {
    if (playerTooltip) {
      tooltipVisibilityObserver.disconnect();
      document.removeEventListener('pointermove', dismissPlayerTooltipOnPointerMove, true);
      document.removeEventListener('pointerout', dismissPlayerTooltipOnPointerOut, true);
      document.removeEventListener('pointerdown', hidePlayerTooltip, true);
      document.removeEventListener('pointercancel', hidePlayerTooltip, true);
      document.removeEventListener('scroll', hidePlayerTooltip, true);
      document.removeEventListener('visibilitychange', dismissHiddenPlayerTooltip);
      document.removeEventListener('keydown', dismissPlayerTooltipOnEscape, true);
    }
    playerTooltip?.remove(); playerTooltip = null;
    playerButton?.removeAttribute('aria-describedby');
  }

  function isPlayerTooltipOwnerVisible() {
    const player = playerTarget?.player;
    if (suspended || document.visibilityState === 'hidden' || playerButton?.disabled ||
      !isRendered(playerButton) || !player?.contains(playerButton) || player.classList.contains('ytp-autohide')) return false;
    for (let node = playerButton; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
        Number.parseFloat(style.opacity) === 0 || node.getAttribute('aria-disabled') === 'true') return false;
      if (node === player) break;
    }
    return true;
  }

  function dismissPlayerTooltipOnPointerMove(event) {
    if (!playerButton?.contains(event.target)) hidePlayerTooltip();
  }
  function dismissPlayerTooltipOnPointerOut(event) {
    if (!event.relatedTarget) hidePlayerTooltip();
  }
  function dismissHiddenPlayerTooltip() {
    if (document.visibilityState === 'hidden') hidePlayerTooltip();
  }
  function dismissPlayerTooltipOnEscape(event) {
    if (event.key === 'Escape') hidePlayerTooltip();
  }

  function showPlayerTooltip(event) {
    if (!isPlayerTooltipOwnerVisible() ||
      (event.type === 'focus' && !playerButton.matches(':focus-visible'))) { hidePlayerTooltip(); return; }
    if (!playerTooltip) {
      const player = playerTarget.player;
      const tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID; tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = 'Suite settings';
      playerTooltip = player.appendChild(tooltip);
      playerButton.setAttribute('aria-describedby', TOOLTIP_ID);
      // Observe only the visible tooltip's owner chain, never the page subtree.
      for (let node = playerButton; node; node = node.parentElement) {
        tooltipVisibilityObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-disabled', 'disabled'] });
        if (node === player) break;
      }
      document.addEventListener('pointermove', dismissPlayerTooltipOnPointerMove, true);
      document.addEventListener('pointerout', dismissPlayerTooltipOnPointerOut, true);
      document.addEventListener('pointerdown', hidePlayerTooltip, true);
      document.addEventListener('pointercancel', hidePlayerTooltip, true);
      document.addEventListener('scroll', hidePlayerTooltip, true);
      document.addEventListener('visibilitychange', dismissHiddenPlayerTooltip);
      document.addEventListener('keydown', dismissPlayerTooltipOnEscape, true);
    }
    positionPlayerTooltip();
  }

  function positionPlayerTooltip() {
    const player = playerTarget?.player, tooltip = playerTooltip;
    if (!isPlayerTooltipOwnerVisible() || !tooltip?.isConnected ||
      !player?.contains(playerButton) || !player.contains(tooltip)) { hidePlayerTooltip(); return; }
    const playerRect = player.getBoundingClientRect(), buttonRect = playerButton.getBoundingClientRect();
    if (!playerRect.width || !playerRect.height || !buttonRect.width || !buttonRect.height) { hidePlayerTooltip(); return; }
    const width = player.offsetWidth || playerRect.width, height = player.offsetHeight || playerRect.height;
    const scaleX = playerRect.width / width, scaleY = playerRect.height / height;
    const left = (buttonRect.left + buttonRect.width / 2 - playerRect.left) / scaleX - tooltip.offsetWidth / 2;
    const progress = player.querySelector('.ytp-progress-bar-container');
    const progressRect = isRendered(progress) ? progress.getBoundingClientRect() : null;
    const aboveControls = progressRect?.width > 0 && progressRect.height > 0 &&
      progressRect.top >= playerRect.top && progressRect.bottom <= buttonRect.top + 1 &&
      progressRect.left >= playerRect.left - 1 && progressRect.right <= playerRect.right + 1;
    const bottom = aboveControls ? (progressRect.top - playerRect.top) / scaleY - 8 : (buttonRect.top - playerRect.top) / scaleY - 20;
    tooltip.style.left = `${Math.round(Math.max(8, Math.min(left, width - tooltip.offsetWidth - 8)))}px`;
    tooltip.style.top = `${Math.round(Math.max(8, bottom - tooltip.offsetHeight))}px`;
  }

  function refreshPlayerTooltip() {
    if (!playerTooltip) return;
    if (playerButton?.matches(':hover') || (document.activeElement === playerButton && playerButton.matches(':focus-visible'))) positionPlayerTooltip();
    else hidePlayerTooltip();
  }

  function installPlayerButton(target) {
    if (playerTarget?.player !== target?.player || playerTarget?.controls !== target?.controls) hidePlayerTooltip();
    playerTarget = target;
    const controls = target?.controls;
    if (!controls) { playerButton?.remove(); hidePlayerTooltip(); return; }
    if (!playerButton) {
      playerButton = document.createElement('button');
      playerButton.id = PLAYER_BUTTON_ID; playerButton.type = 'button'; playerButton.className = 'ytp-button';
      playerButton.setAttribute('aria-label', 'Suite settings');
      playerButton.setAttribute('aria-haspopup', 'dialog'); playerButton.setAttribute('aria-controls', DIALOG_ID);
      const image = document.createElement('img');
      image.src = settings.initial.playerSettingsIcon === 'colour' ? suite.settingsAssets.logo : suite.settingsAssets.playerLogo;
      image.alt = ''; image.width = 36; image.height = 36;
      image.setAttribute('aria-hidden', 'true'); playerButton.append(image);
      playerButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openSettings(); });
      playerButton.addEventListener('mouseenter', showPlayerTooltip);
      playerButton.addEventListener('focus', showPlayerTooltip);
      playerButton.addEventListener('mouseleave', hidePlayerTooltip);
      playerButton.addEventListener('blur', hidePlayerTooltip);
    }
    const anchor = controls.querySelector('#ytppl-video-mirror-button') || controls.querySelector('.ytp-size-button, .ytp-fullscreen-button');
    const parent = anchor?.parentElement || controls;
    if (playerButton.parentElement !== parent || playerButton.nextElementSibling !== anchor) {
      hidePlayerTooltip(); parent.insertBefore(playerButton, anchor || null);
    }
    refreshPlayerTooltip();
  }

  function installButton() {
    frame = 0;
    if (suspended) return;
    const masthead = settings.initial.headerSettingsIcon === 'off' ? null : document.querySelector("ytd-masthead");
    const app = document.querySelector("ytd-app");
    const mastheadContainer = app?.querySelector('#masthead-container') || null;
    const target = settings.initial.playerSettingsIcon === 'off' ? null : getPlayerTarget();
    const playerBranch = new Set();
    for (let node = target?.controls || target?.player || target?.root; node && node !== document.body; node = node.parentElement) playerBranch.add(node);
    if (target && !target.controls) {
      const scope = target.player || target.root;
      for (const node of scope.querySelectorAll('#player, #player-container, #player-container-inner, #single-column-container, #full-bleed-container, #player-full-bleed-container, .ytp-chrome-bottom, .ytp-chrome-controls')) playerBranch.add(node);
    }
    const pageManager = app?.querySelector('ytd-page-manager, #page-manager');
    if (pageManager) playerBranch.add(pageManager);
    const branch = Array.from(playerBranch);
    if (!discoveryActive || app !== watchedApp || masthead !== watchedMasthead || mastheadContainer !== watchedMastheadContainer ||
      branch.length !== watchedPlayerBranch.length || branch.some((node, index) => node !== watchedPlayerBranch[index])) {
      const registrations = [[document.documentElement, { childList: true }]];
      if (document.body) registrations.push([document.body, { childList: true }]);
      if (app) registrations.push([app, { childList: true }]);
      if (mastheadContainer) registrations.push([mastheadContainer, { childList: true }]);
      if (masthead) registrations.push([masthead, { childList: true, subtree: true }]);
      for (const node of branch) registrations.push([node, { childList: true, ...(node === target?.controls ? { subtree: true } : {}) }]);
      discovery.replaceRegistrations(registrations);
      watchedApp = app; watchedMasthead = masthead;
      watchedMastheadContainer = mastheadContainer; discoveryActive = true;
      watchedPlayerBranch = branch;
    }
    installPlayerButton(target);
    if (!masthead) { button?.remove(); return; }
    const avatar = masthead.querySelector("#avatar-btn, button[aria-label*='Account'], button[aria-label*='account']");
    if (!avatar) { button?.remove(); return; }
    const anchor = avatar.closest("ytd-topbar-menu-button-renderer, ytd-topbar-menu-button-view-model") || avatar;
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID; button.type = "button";
      button.setAttribute("aria-label", "Suite settings");
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", DIALOG_ID);
      button.title = "Suite settings";
      const image = document.createElement("img");
      button.dataset.icon = settings.initial.headerSettingsIcon;
      image.src = settings.initial.headerSettingsIcon === 'monochrome' ? suite.settingsAssets.playerLogo : suite.settingsAssets.logo;
      image.alt = "";
      image.width = 32; image.height = 32; image.setAttribute("aria-hidden", "true");
      button.append(image);
      button.addEventListener("click", openSettings);
    }
    if (button.parentNode !== anchor.parentNode || button.nextElementSibling !== anchor) {
      anchor.before(button);
    }
  }

  function scheduleInstall() {
    if (!suspended && !frame) frame = requestAnimationFrame(installButton);
  }
  const discovery = new MutationObserver(records => {
    // Text and comment updates cannot replace a player, control or header
    // anchor. Keep discovery for structural changes, not native label churn.
    for (const record of records) {
      for (const nodes of [record.addedNodes, record.removedNodes]) {
        for (const node of nodes) {
          if (node.nodeType === 1) { scheduleInstall(); return; }
        }
      }
    }
  });
  const themeObserver = new MutationObserver(syncTheme);
  const tooltipVisibilityObserver = new MutationObserver(refreshPlayerTooltip);
  function start() {
    suspended = false;
    watchedApp = null; watchedMasthead = null;
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });
    syncTheme(); installButton();
  }
  function stop() {
    suspended = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    discovery.disconnect(); themeObserver.disconnect();
    discoveryActive = false;
    hidePlayerTooltip();
    document.getElementById(DIALOG_ID)?.close();
    channelAgeDialog?.close();
  }
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", start);
  window.addEventListener("yt-navigate-start", () => { hidePlayerTooltip(); document.getElementById(DIALOG_ID)?.close(); channelAgeDialog?.close(); });
  window.addEventListener("yt-navigate-finish", scheduleInstall);
  window.addEventListener("yt-page-data-updated", scheduleInstall);
  window.addEventListener('yt-master-channel-age-changed', () => panel?.updateChannels());
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === settings.key || event.key === 'yt-master-suite.scroll-miniplayer.corner.v1') panel?.reconcileSaved();
    if (event.key === null || event.key === suite.channelAge.key) window.dispatchEvent(new CustomEvent('yt-master-channel-age-changed'));
  });
  document.addEventListener('loadedmetadata', event => { if (event.target?.matches?.('video.html5-main-video')) scheduleInstall(); }, true);
  document.addEventListener('fullscreenchange', () => { hidePlayerTooltip(); scheduleInstall(); }, true);
  window.addEventListener('resize', refreshPlayerTooltip);
  window.addEventListener('blur', hidePlayerTooltip);
  start();
})();

