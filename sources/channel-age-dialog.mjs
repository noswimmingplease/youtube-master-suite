// Native DOM only: keep this factory self-contained for userscript embedding.
export function createChannelAgeDialog(document, service, onSaved, options = {}) {
  const embedded = Boolean(options.host);
  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === true) node.setAttribute(name, '');
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    node.append(...children);
    return node;
  }
  const button = (id, text, className = 'ytms-age-button') => element('button', { id, type: 'button', class: className }, text);
  const title = element('h2', { id: 'ytms-age-title' }, 'Channel upload filters');
  const closeButton = button('ytms-age-close', '×', 'ytms-age-close');
  closeButton.setAttribute('aria-label', 'Close channel upload filters');
  const intro = element('p', { id: 'ytms-age-intro', class: 'ytms-age-note', hidden: embedded },
    'Hide older uploads or block all uploads from selected channels in feeds and search. Watched-video filtering remains separate. Queues, saved playlists, Watch History and directly opened videos are left unchanged.');
  const instructions = element('p', { class: 'ytms-age-note', hidden: embedded },
    'Use a UC channel ID or a youtube.com/channel/ URL, not a handle. Each age limit moves forwards automatically; uncertain dates stay visible unless the whole channel is blocked. These Suite filters are separate from YouTube’s Don’t recommend channel choices.');
  const listId = embedded ? 'ytms-channel-filter-list' : 'ytms-age-list';
  const search = element('input', { id: 'ytms-channel-search', type: 'search', maxlength: 120,
    autocomplete: 'off', placeholder: 'Channel name or ID', 'aria-controls': listId });
  const sort = element('select', { id: 'ytms-channel-sort', 'aria-controls': listId },
    ...[['saved', 'Saved order'], ['name-asc', 'Name: A–Z'], ['name-desc', 'Name: Z–A'],
      ['age-asc', 'Upload age: shortest first'], ['age-desc', 'Upload age: longest first'],
      ['status-enabled', 'Status: enabled first'], ['status-disabled', 'Status: disabled first']]
      .map(([value, text]) => element('option', { value }, text)));
  const addButton = button('ytms-age-add', 'Add another channel', 'ytms-age-button ytms-age-outlined');
  const clearSearch = button('ytms-channel-search-clear', 'Clear search', 'ytms-age-button ytms-age-outlined');
  clearSearch.hidden = true;
  const toolbar = element('div', { class: 'ytms-age-toolbar' },
    element('label', { class: 'ytms-age-toolbar-field', for: search.id }, element('span', {}, 'Search channels'), search),
    element('label', { class: 'ytms-age-toolbar-field ytms-age-sort-field', for: sort.id }, element('span', {}, 'Sort by'), sort), addButton);
  const count = element('p', { id: 'ytms-channel-count', class: 'ytms-age-note', role: 'status' });
  const transferAvailable = ['exportChannels', 'previewChannels', 'restoreChannels']
    .every(name => typeof options.channelBackup?.[name] === 'function');
  const exportChannels = button('ytms-export-channels', 'Export channels', 'ytms-age-button ytms-age-outlined');
  const fullBackup = button('ytms-open-full-backup', 'Full settings backup', 'ytms-age-button ytms-age-outlined');
  fullBackup.hidden = typeof options.openFullBackup !== 'function';
  const importFile = element('input', { id: 'ytms-import-channels', type: 'file', accept: '.json,application/json' });
  const importMode = element('select', { id: 'ytms-channel-import-mode' },
    element('option', { value: 'merge' }, 'Merge with saved channels'),
    element('option', { value: 'replace' }, 'Replace the entire saved list'));
  const importPreview = element('div', { id: 'ytms-channel-import-preview', class: 'ytms-channel-import-preview', hidden: true });
  const transferStatus = element('p', { id: 'ytms-channel-transfer-status', class: 'ytms-age-note', role: 'status' });
  const transfer = element('details', { id: 'ytms-channel-transfer', class: 'ytms-channel-transfer', hidden: !transferAvailable },
    element('summary', {}, 'Import or export channels'),
    element('p', { class: 'ytms-age-note' }, 'Export all saved channel filters, including disabled rules, names, IDs, upload-age limits and whole-channel blocks. Search results do not limit the export. Other settings and unsaved edits are not included. Keep the file private.'),
    element('div', { class: 'ytms-channel-transfer-actions' }, exportChannels, fullBackup),
    element('label', { class: 'ytms-age-toolbar-field', for: importFile.id }, element('span', {}, 'Choose a channel export to preview'), importFile),
    element('label', { class: 'ytms-age-toolbar-field', for: importMode.id }, element('span', {}, 'Import mode'), importMode),
    importPreview, transferStatus);
  const columns = element('div', { id: 'ytms-channel-filter-columns', class: 'channel-filter-columns', 'aria-hidden': 'true' },
    ...['Channel', 'Allowed upload age', 'Status', 'Actions'].map(text => element('span', {}, text)));
  const list = element('div', { id: listId, role: 'list', 'aria-label': embedded ? 'Saved channel upload filters' : 'Channel upload filters' });
  const empty = element('p', { class: 'ytms-age-note', id: 'ytms-age-empty' });
  const status = element('p', { id: 'ytms-age-status', class: 'ytms-age-status', role: 'status', hidden: true });
  const cancel = button('ytms-age-cancel', 'Cancel');
  const save = button('ytms-age-save', 'Save filters', 'ytms-age-button ytms-age-primary');
  const footer = element(embedded ? 'div' : 'footer', { class: 'ytms-age-footer' },
    status, element('span', { class: 'ytms-age-spacer' }), cancel, save);
  const content = element('div', { class: 'ytms-age-content' }, intro, toolbar,
    element('div', { class: 'ytms-age-results' }, count, clearSearch), transfer, instructions, columns, list, empty);
  const dialog = element(embedded ? 'section' : 'dialog', {
    id: 'ytms-age-dialog', class: embedded ? 'ytms-age-embedded' : null, lang: 'en-GB',
    'aria-label': embedded ? 'Channel upload filters' : null,
    'aria-labelledby': embedded ? null : title.id, 'aria-describedby': embedded ? null : intro.id,
  }, element('div', { class: 'ytms-age-panel' }, element('header', { hidden: embedded }, title, closeButton), content));
  if (embedded && options.footerHost) options.footerHost.append(footer);
  else dialog.firstElementChild.append(footer);
  (options.host || document.body).append(dialog);
  const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
  let saved = [], draft = [];
  let loaded = false, rowSequence = 0;
  let newRules = new WeakSet(), origin = null, editingRule = null;
  let importGeneration = 0, importToken = null, importText = null, updateImportPreview = null;
  let downloadUrl = null, downloadTimer = null;
  const rendered = new Map();
  const copy = rules => rules.map(rule => ({ ...rule }));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const hasDraft = () => loaded && !same(draft, saved);
  function updateSaveState() { save.disabled = embedded && !hasDraft() && !editingRule; updateImportPreview?.(); }
  function markChanged() {
    status.hidden = true; status.classList.remove('ytms-age-error'); updateSaveState();
  }
  function showStatus(message, error = false) {
    status.textContent = message; status.classList.toggle('ytms-age-error', error); status.hidden = false;
  }
  function setTransferStatus(message, error = false) {
    transferStatus.textContent = message; transferStatus.classList.toggle('ytms-transfer-error', error);
  }
  function clearDownload() {
    if (downloadTimer !== null) document.defaultView.clearTimeout(downloadTimer);
    if (downloadUrl) document.defaultView.URL.revokeObjectURL(downloadUrl);
    downloadUrl = null; downloadTimer = null;
  }
  function clearTransfer(resetMode = false) {
    importGeneration++; importToken = null; importText = null; updateImportPreview = null;
    importFile.value = ''; importPreview.replaceChildren(); importPreview.hidden = true;
    if (resetMode) { importMode.value = 'merge'; transfer.open = false; }
    setTransferStatus(''); clearDownload();
  }
  function showImportPreview(result) {
    importToken = result.preview; importPreview.replaceChildren(); importPreview.hidden = false;
    const { filters, warning, orderChanged } = result.summary;
    const acknowledgement = element('input', { id: 'ytms-confirm-channel-import', type: 'checkbox' });
    const applyImport = button('ytms-apply-channel-import', 'Import channels', 'ytms-age-button ytms-age-primary');
    const cancelImport = button('ytms-cancel-channel-import', 'Cancel import', 'ytms-age-button ytms-age-outlined');
    importPreview.append(element('h3', {}, 'Channel import preview'), element('p', {}, warning),
      element('p', {}, `Channel filters: ${filters.added} added, ${filters.changed} updated, ${filters.removed} removed, ${filters.unchanged} unchanged; ${filters.total} after import.`));
    if (orderChanged && !filters.added && !filters.changed && !filters.removed) {
      importPreview.append(element('p', {}, 'The saved channel order will change to match the file.'));
    }
    importPreview.append(
      element('label', { class: 'ytms-channel-import-confirm', for: acknowledgement.id }, acknowledgement,
        importMode.value === 'replace' ? ' Replace my entire saved channel list with this file.' : ' Merge these channels into my saved list.'),
      element('div', { class: 'ytms-channel-transfer-actions' }, applyImport, cancelImport));
    const changed = filters.added || filters.changed || filters.removed || orderChanged;
    const update = () => {
      const dirty = hasDraft();
      applyImport.disabled = !acknowledgement.checked || !changed || dirty;
      if (dirty) setTransferStatus('Save or discard your channel edits before importing. Your draft has been kept.', true);
      else if (!changed) setTransferStatus('This import would not change your saved channels.');
      else setTransferStatus('Preview only. Other settings are unchanged; nothing has been imported yet.');
    };
    updateImportPreview = update;
    acknowledgement.addEventListener('change', update);
    cancelImport.addEventListener('click', () => { clearTransfer(); setTransferStatus('Import cancelled. Nothing has been changed.'); });
    applyImport.addEventListener('click', () => {
      if (hasDraft()) { update(); return; }
      if (!acknowledgement.checked || applyImport.disabled || !importToken) return;
      let restored;
      try { restored = options.channelBackup.restoreChannels(importToken); }
      catch { restored = { ok: false, error: 'Channels could not be imported. Review the saved list before trying again.' }; }
      clearTransfer();
      if (!restored?.ok) {
        // A concurrent write or incomplete rollback may have changed the saved
        // list. Refresh the clean view without discarding any channel draft.
        refresh();
        setTransferStatus(restored?.error || 'Channels could not be imported. Your other settings are unchanged.', true);
        return;
      }
      origin = null; loadSaved(true); transfer.open = true;
      setTransferStatus('Channels imported. Their filters apply immediately; other settings are unchanged.');
      document.defaultView.dispatchEvent(new document.defaultView.CustomEvent('yt-master-channel-age-changed'));
      try { options.onImported?.(restored); } catch { /* The successful storage operation is not undone by a UI callback. */ }
    });
    update();
  }
  function prepareImportPreview() {
    importToken = null; updateImportPreview = null; importPreview.replaceChildren(); importPreview.hidden = true;
    if (importText === null) return;
    let result;
    try { result = options.channelBackup.previewChannels(importText, importMode.value); }
    catch { result = { ok: false, error: 'The channel export could not be read. No channels were changed.' }; }
    if (result?.ok) showImportPreview(result);
    else setTransferStatus(result?.error || 'The channel export could not be read. No channels were changed.', true);
  }
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importToken = null; importText = null; updateImportPreview = null; importPreview.replaceChildren(); importPreview.hidden = true;
    const request = ++importGeneration;
    if (!file) { setTransferStatus(''); return; }
    if (file.size > 131072) { setTransferStatus('Choose a JSON channel export no larger than 128 KiB.', true); return; }
    setTransferStatus('Reading channel export for preview…');
    try {
      const text = await file.text();
      if (request !== importGeneration) return;
      importText = text; prepareImportPreview();
    } catch { if (request === importGeneration) setTransferStatus('The selected file could not be read. No channels were changed.', true); }
  });
  importMode.addEventListener('change', prepareImportPreview);
  fullBackup.addEventListener('click', () => options.openFullBackup?.());
  exportChannels.addEventListener('click', () => {
    let result;
    try { result = options.channelBackup.exportChannels(); }
    catch { result = { ok: false, error: 'The channel export could not be created.' }; }
    if (!result?.ok) { setTransferStatus(result?.error || 'The channel export could not be created.', true); return; }
    try {
      clearDownload();
      const view = document.defaultView;
      downloadUrl = view.URL.createObjectURL(new view.Blob([result.text], { type: 'application/json;charset=utf-8' }));
      const link = element('a', { href: downloadUrl, download: 'youtube-master-suite-channels.json', hidden: true });
      dialog.append(link);
      try { link.click(); } finally { link.remove(); }
      downloadTimer = view.setTimeout(clearDownload, 30000);
      setTransferStatus('Channel export download requested. It contains saved channels only; unsaved edits and other settings are not included.');
    } catch { clearDownload(); setTransferStatus('The channel export could not be downloaded. Browser file access may be restricted.', true); }
  });
  function rowsForView() {
    const query = search.value.trim().toLocaleLowerCase('en-GB');
    const rows = draft.filter(rule => rule === editingRule || !query ||
      `${rule.name} ${rule.channelId}`.toLocaleLowerCase('en-GB').includes(query));
    const byName = (left, right) => collator.compare(left.name || left.channelId, right.name || right.channelId) ||
      collator.compare(left.channelId, right.channelId);
    const timestamp = Date.now();
    const byAge = (left, right) => (service.compareAgeLimits?.(left, right, timestamp) || 0) || byName(left, right);
    const comparators = {
      'name-asc': byName, 'name-desc': (left, right) => -byName(left, right),
      'age-asc': byAge, 'age-desc': (left, right) => -byAge(left, right),
      'status-enabled': (left, right) => Number(right.enabled) - Number(left.enabled) || byName(left, right),
      'status-disabled': (left, right) => Number(left.enabled) - Number(right.enabled) || byName(left, right),
    };
    if (comparators[sort.value]) rows.sort(comparators[sort.value]);
    return rows;
  }
  function fieldCell(className, label, value) {
    return element('p', { class: className }, element('span', { class: 'channel-filter-field-label' }, `${label}: `),
      element('span', { class: 'channel-filter-value' }, value));
  }
  function render(focusRule = editingRule, focus = false) {
    editingRule = draft.includes(focusRule) ? focusRule : null;
    const rows = rowsForView(), fragment = document.createDocumentFragment();
    rendered.clear();
    empty.hidden = rows.length !== 0;
    empty.textContent = draft.length ? 'No channels match your search.' : 'No channel upload filters saved.';
    columns.hidden = rows.length === 0;
    count.textContent = `Showing ${rows.length} of ${draft.length} ${draft.length === 1 ? 'channel' : 'channels'}`;
    clearSearch.hidden = !search.value; addButton.disabled = draft.length >= 100;
    instructions.hidden = embedded && !editingRule;
    for (const rule of rows) {
      const sequence = ++rowSequence, editing = rule === editingRule;
      const card = element('article', { class: 'ytms-age-rule channel-filter-card', role: 'listitem' });
      const heading = element('h3', {}, rule.name || rule.channelId || 'New channel filter');
      const identity = element('div', { class: 'channel-filter-identity' }, heading,
        element('p', { class: 'channel-filter-id ytms-age-channel-id' }, service.normaliseChannelId(rule.channelId) || rule.channelId));
      const age = fieldCell('channel-filter-age', 'Allowed upload age', rule.blocked ? 'No uploads' :
        `Up to ${rule.maxAge} ${rule.maxAge === 1 ? rule.unit.slice(0, -1) : rule.unit}`);
      const ruleStatus = fieldCell('channel-filter-status', 'Status', rule.enabled ? 'Enabled' : 'Disabled');
      const labelField = (labelText, input, className = '') => {
        const label = element('span', { id: `${input.id}-label` }, labelText);
        input.setAttribute('aria-labelledby', label.id);
        return element('label', { class: `ytms-age-field ${className}`, for: input.id }, label, input);
      };
      const name = element('input', { id: `ytms-age-name-${sequence}`, type: 'text', maxlength: 120,
        autocomplete: 'off', value: rule.name, placeholder: 'Optional display name' });
      const channel = element('input', { id: `ytms-age-channel-${sequence}`, type: 'text', maxlength: 256,
        autocomplete: 'off', spellcheck: 'false', value: rule.channelId, placeholder: 'UC… or https://www.youtube.com/channel/UC…' });
      const maxAge = element('input', { id: `ytms-age-value-${sequence}`, type: 'number', min: 1, max: 1000, step: 1,
        inputmode: 'numeric', value: rule.maxAge });
      const unit = element('select', { id: `ytms-age-unit-${sequence}` },
        ...[['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['years', 'Years']]
          .map(([value, text]) => element('option', { value }, text)));
      unit.value = rule.unit;
      const enabled = element('input', { id: `ytms-age-enabled-${sequence}`, type: 'checkbox' }); enabled.checked = rule.enabled;
      const blocked = element('input', { id: `ytms-age-blocked-${sequence}`, type: 'checkbox' }); blocked.checked = rule.blocked === true;
      maxAge.disabled = unit.disabled = blocked.checked;
      const edit = button(`ytms-age-edit-${sequence}`, 'Edit', 'ytms-age-button ytms-age-outlined ytms-age-edit');
      edit.hidden = editing; edit.setAttribute('aria-expanded', String(editing));
      edit.setAttribute('aria-controls', `ytms-age-fields-${sequence}`);
      const apply = button(`ytms-age-apply-${sequence}`, newRules.has(rule) ? 'Add filter' : 'Update filter', 'ytms-age-button ytms-age-outlined');
      const remove = button(`ytms-age-remove-${sequence}`, 'Remove', 'ytms-age-button ytms-age-danger');
      const actions = element('div', { class: 'channel-filter-actions', role: 'group' }, edit, remove);
      function updateIdentity() {
        const label = rule.name || rule.channelId;
        heading.textContent = label || 'New channel filter';
        identity.lastElementChild.textContent = service.normaliseChannelId(rule.channelId) || rule.channelId;
        edit.setAttribute('aria-label', `Edit filter for ${label || 'this channel'}`);
        remove.setAttribute('aria-label', `Remove filter for ${label || 'this channel'}`);
        actions.setAttribute('aria-label', `Actions for ${label || 'this channel'}`);
        age.lastElementChild.textContent = rule.blocked ? 'No uploads' :
          `Up to ${rule.maxAge} ${rule.maxAge === 1 ? rule.unit.slice(0, -1) : rule.unit}`;
        ruleStatus.lastElementChild.textContent = rule.enabled ? 'Enabled' : 'Disabled';
      }
      const changed = () => { updateIdentity(); markChanged(); };
      name.addEventListener('input', () => { rule.name = name.value; changed(); });
      channel.addEventListener('input', () => { rule.channelId = channel.value; changed(); });
      maxAge.addEventListener('input', () => { rule.maxAge = Number(maxAge.value); changed(); });
      unit.addEventListener('change', () => { rule.unit = unit.value; changed(); });
      enabled.addEventListener('change', () => { rule.enabled = enabled.checked; changed(); });
      blocked.addEventListener('change', () => { rule.blocked = blocked.checked; maxAge.disabled = unit.disabled = blocked.checked; changed(); });
      edit.addEventListener('click', () => { if (validateDraft()) { search.value = ''; render(rule, true); } });
      apply.addEventListener('click', () => {
        if (!validateDraft()) return;
        const added = newRules.has(rule); newRules.delete(rule); render(null);
        showStatus(`${rule.name || service.normaliseChannelId(rule.channelId)} ${added ? 'added to' : 'updated in'} this draft. Choose Save filters to apply it.`);
        rendered.get(rule)?.querySelector('.ytms-age-edit')?.focus();
      });
      remove.addEventListener('click', () => {
        draft.splice(draft.indexOf(rule), 1); markChanged(); render(editingRule === rule ? null : editingRule);
        showStatus(`${rule.name || service.normaliseChannelId(rule.channelId) || 'Channel'} removed from this draft. Choose Save filters to apply it.`);
        if (!draft.length) addButton.focus();
      });
      const fields = element('div', { id: `ytms-age-fields-${sequence}`, class: 'ytms-age-fields', hidden: !editing },
        labelField('Channel name', name), labelField('Channel ID or channel URL', channel, 'ytms-age-wide'),
        element('div', { class: 'ytms-age-limit' }, labelField('Maximum age', maxAge), labelField('Unit', unit)),
        element('label', { class: 'ytms-age-blocked', for: blocked.id }, blocked, ' Hide this channel — all uploads'),
        element('div', { class: 'ytms-age-edit-actions' }, element('label', { for: enabled.id }, enabled, ' Enabled'),
          element('span', { class: 'ytms-age-spacer' }), apply));
      updateIdentity(); card.append(identity, age, ruleStatus, actions, fields);
      rendered.set(rule, card); fragment.append(card);
    }
    list.replaceChildren(fragment); updateSaveState();
    if (focus && editingRule) rendered.get(editingRule)?.querySelector('input[id^="ytms-age-channel-"]')?.focus();
  }
  function appendRule(channel = {}) {
    if (draft.length >= 100) { showStatus('You can save up to 100 channel rules. Remove an existing rule before adding another.', true); return null; }
    const rule = { channelId: channel.channelId || '', name: channel.name || '', maxAge: 1, unit: 'weeks', enabled: true, blocked: channel.blocked === true };
    newRules.add(rule); draft.push(rule); search.value = ''; markChanged(); render(rule, true); return rule;
  }
  function loadSaved(clearView = false) {
    saved = service.read(); draft = copy(saved); loaded = true; newRules = new WeakSet(); editingRule = null;
    if (clearView) { search.value = ''; sort.value = 'saved'; }
    markChanged(); render(null);
  }
  function reset({ defer = false } = {}) {
    clearTransfer(true);
    origin = null;
    if (!defer) { loadSaved(true); return; }
    saved = []; draft = []; loaded = false; newRules = new WeakSet(); editingRule = null;
    search.value = ''; sort.value = 'saved'; rendered.clear(); list.replaceChildren();
    columns.hidden = true; count.textContent = ''; empty.hidden = true; markChanged();
  }
  function close() {
    clearTransfer(true);
    origin = null;
    if (embedded) reset();
    else if (dialog.open) dialog.close();
  }
  function refresh() {
    const latest = service.read();
    if (hasDraft()) {
      if (!same(latest, saved)) showStatus('Channel filters changed in another window. Your draft has been kept. Cancel before editing the updated list.', true);
      return;
    }
    if (loaded && same(latest, saved)) return;
    saved = latest; draft = copy(saved); loaded = true; newRules = new WeakSet(); render(null);
  }
  function add() { if (!loaded) loadSaved(); if (validateDraft()) appendRule(); }
  addButton.addEventListener('click', add);
  search.addEventListener('input', () => render());
  sort.addEventListener('change', () => render());
  clearSearch.addEventListener('click', () => { search.value = ''; render(); search.focus(); });
  function cancelChanges() {
    const state = { hadEditor: Boolean(editingRule), hadDraft: hasDraft() };
    close(); options.onCancel?.(state);
  }
  closeButton.addEventListener('click', cancelChanges); cancel.addEventListener('click', cancelChanges);
  dialog.addEventListener('close', () => { if (!dialog.open) { clearTransfer(true); origin = null; loaded = false; editingRule = null; } });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  for (const type of ['input', 'change']) dialog.addEventListener(type, event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (embedded || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancelChanges();
  });
  function validateDraft() {
    const ids = new Set();
    const invalidIndex = draft.findIndex(rule => {
      const id = service.normaliseChannelId(rule.channelId);
      const invalid = !id || ids.has(id) || !Number.isSafeInteger(rule.maxAge) || rule.maxAge < 1 || rule.maxAge > 1000 ||
        !['days', 'weeks', 'months', 'years'].includes(rule.unit) || typeof rule.name !== 'string' || typeof rule.enabled !== 'boolean' ||
        (rule.blocked !== undefined && typeof rule.blocked !== 'boolean');
      ids.add(id); return invalid;
    });
    if (invalidIndex >= 0) {
      search.value = ''; render(draft[invalidIndex], true);
      showStatus(`Rule ${invalidIndex + 1}: enter a unique UC channel ID or channel URL and a whole-number age from 1 to 1,000. Each channel can have one rule.`, true);
      return false;
    }
    return true;
  }
  save.addEventListener('click', () => {
    if (!validateDraft()) return;
    let result;
    try { result = service.save(draft, saved); }
    catch { showStatus('Could not save channel upload filters. Your previous filters are unchanged.', true); return; }
    if (!result?.ok) { showStatus(result?.error || 'Could not save channel upload filters. Your previous filters are unchanged.', true); return; }
    clearTransfer();
    const change = { origin, previousRules: saved, rules: service.getRules() };
    // A UI acknowledgement failure must not undo a successful storage write.
    try { onSaved?.(change); } catch { /* Filtering still applies if its card disappeared. */ }
    saved = change.rules; draft = copy(saved); newRules = new WeakSet(); origin = null; render(null);
    showStatus('Saved. Channel upload filters apply immediately; no reload is needed.');
    document.defaultView.dispatchEvent(new document.defaultView.CustomEvent('yt-master-channel-age-changed'));
    if (!embedded) close();
    options.onComplete?.();
  });
  return {
    element: dialog,
    open(channel, context) {
      const wasOpen = embedded ? loaded : dialog.open;
      if (!wasOpen) loadSaved(true); else refresh();
      origin = context && channel ? { card: context.card, videoId: context.videoId, channelId: service.normaliseChannelId(channel.channelId) } : null;
      if (!embedded && !dialog.open) dialog.showModal();
      const channelId = channel && service.normaliseChannelId(channel.channelId);
      if (channelId) {
        const existing = draft.find(rule => service.normaliseChannelId(rule.channelId) === channelId);
        if (channel.remove === true) {
          if (existing) {
            draft.splice(draft.indexOf(existing), 1); markChanged(); render(null);
            showStatus(`${existing.name || channelId} removed from this draft. Choose Save filters to apply it.`); save.focus();
          } else showStatus('This channel is not in the current filter draft. Nothing has been removed.');
        } else if (existing) { search.value = ''; render(existing, true); }
        else appendRule({ channelId, name: typeof channel.name === 'string' ? channel.name : '', blocked: channel.blocked });
      } else if (!embedded && !wasOpen && draft.length) render(draft[0], true);
      else if (!draft.length) addButton.focus();
      if (!wasOpen) content.scrollTop = 0;
    },
    // reset/close discard drafts; refresh never overwrites one. View controls
    // are session-only and never reorder the persisted rule array.
    close, refresh, reset, hasDraft, add,
  };
}
