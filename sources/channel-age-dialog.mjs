// Native DOM only: keep this factory self-contained for userscript embedding.
export function createChannelAgeDialog(document, service) {
  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === true) node.setAttribute(name, '');
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    node.append(...children);
    return node;
  }
  const button = (id, text, className = 'ytms-age-button') =>
    element('button', { id, type: 'button', class: className }, text);
  const title = element('h2', { id: 'ytms-age-title' }, 'Channel upload filters');
  const closeButton = button('ytms-age-close', '×', 'ytms-age-close');
  closeButton.setAttribute('aria-label', 'Close channel upload filters');
  const intro = element('p', { id: 'ytms-age-intro', class: 'ytms-age-note' },
    'Hide older uploads or block all uploads from selected channels in feeds and search. Watched-video filtering remains separate. Queues, saved playlists, Watch History and directly opened videos are left unchanged.');
  const instructions = element('p', { class: 'ytms-age-note' },
    'Use a UC channel ID or a youtube.com/channel/ URL, not a handle. Each age limit moves forwards automatically; uncertain dates stay visible unless the whole channel is blocked. These Suite filters are separate from YouTube’s Don’t recommend channel choices.');
  const list = element('div', { id: 'ytms-age-list', role: 'list', 'aria-label': 'Channel upload filters' });
  const empty = element('p', { class: 'ytms-age-note', id: 'ytms-age-empty' }, 'No channel upload filters. Channels are unaffected until you add and save a rule.');
  const addButton = button('ytms-age-add', 'Add channel');
  const status = element('p', { id: 'ytms-age-status', class: 'ytms-age-status', role: 'status', hidden: true });
  const cancel = button('ytms-age-cancel', 'Cancel');
  const save = button('ytms-age-save', 'Save filters', 'ytms-age-button ytms-age-primary');
  const content = element('div', { class: 'ytms-age-content' }, intro, instructions, list, empty, addButton);
  const dialog = element('dialog', {
    id: 'ytms-age-dialog', lang: 'en-GB', 'aria-labelledby': title.id, 'aria-describedby': intro.id,
  }, element('div', { class: 'ytms-age-panel' },
    element('header', {}, title, closeButton), content,
    element('footer', {}, status, element('span', { class: 'ytms-age-spacer' }), cancel, save)));
  document.body.append(dialog);
  let saved = [];
  let draft = [];
  let rowSequence = 0;

  function markChanged() {
    status.hidden = true;
    status.classList.remove('ytms-age-error');
  }
  function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('ytms-age-error', error);
    status.hidden = false;
  }
  function render(focusRule) {
    list.replaceChildren();
    empty.hidden = draft.length !== 0;
    addButton.disabled = draft.length >= 100;
    for (const rule of draft) {
      const sequence = ++rowSequence;
      const card = element('div', { class: 'ytms-age-rule', role: 'listitem' });
      const labelField = (labelText, input, className = '') => {
        const label = element('span', { id: `${input.id}-label` }, labelText);
        input.setAttribute('aria-labelledby', label.id);
        return element('label', { class: `ytms-age-field ${className}`, for: input.id }, label, input);
      };
      const name = element('input', {
        id: `ytms-age-name-${sequence}`, type: 'text', maxlength: 120,
        autocomplete: 'off', value: rule.name, placeholder: 'Optional display name',
      });
      name.addEventListener('input', () => { rule.name = name.value; markChanged(); });
      const channel = element('input', {
        id: `ytms-age-channel-${sequence}`, type: 'text', maxlength: 256,
        autocomplete: 'off', spellcheck: 'false', value: rule.channelId,
        placeholder: 'UC… or https://www.youtube.com/channel/UC…',
      });
      channel.addEventListener('input', () => { rule.channelId = channel.value; markChanged(); });
      const maxAge = element('input', {
        id: `ytms-age-value-${sequence}`, type: 'number', min: 1, max: 1000, step: 1,
        inputmode: 'numeric', value: rule.maxAge,
      });
      maxAge.addEventListener('input', () => { rule.maxAge = Number(maxAge.value); markChanged(); });
      const unit = element('select', { id: `ytms-age-unit-${sequence}` },
        ...[['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['years', 'Years']]
          .map(([value, text]) => element('option', { value }, text)));
      unit.value = rule.unit;
      unit.addEventListener('change', () => { rule.unit = unit.value; markChanged(); });
      const enabled = element('input', { id: `ytms-age-enabled-${sequence}`, type: 'checkbox' });
      enabled.checked = rule.enabled;
      enabled.addEventListener('change', () => { rule.enabled = enabled.checked; markChanged(); });
      const blocked = element('input', { id: `ytms-age-blocked-${sequence}`, type: 'checkbox' });
      blocked.checked = rule.blocked === true;
      maxAge.disabled = unit.disabled = blocked.checked;
      blocked.addEventListener('change', () => {
        rule.blocked = blocked.checked; maxAge.disabled = unit.disabled = blocked.checked; markChanged();
      });
      const remove = button(`ytms-age-remove-${sequence}`, 'Remove');
      remove.setAttribute('aria-label', `Remove ${rule.name || rule.channelId || 'channel rule'}`);
      remove.addEventListener('click', () => {
        const index = draft.indexOf(rule);
        draft.splice(index, 1); markChanged(); render(draft[Math.min(index, draft.length - 1)]);
        if (!draft.length) addButton.focus();
      });
      card.append(labelField('Channel name', name), labelField('Channel ID or channel URL', channel, 'ytms-age-wide'),
        element('div', { class: 'ytms-age-limit' }, labelField('Maximum age', maxAge), labelField('Unit', unit)),
        element('label', { class: 'ytms-age-blocked', for: blocked.id }, blocked, ' Hide this channel — all uploads'),
        element('div', { class: 'ytms-age-actions' }, element('label', { for: enabled.id }, enabled, ' Enabled'), remove));
      list.append(card);
      if (rule === focusRule) channel.focus();
    }
  }
  function appendRule(channel = {}) {
    if (draft.length >= 100) {
      showStatus('You can save up to 100 channel rules. Remove an existing rule before adding another.', true);
      return null;
    }
    const rule = { channelId: channel.channelId || '', name: channel.name || '', maxAge: 1, unit: 'weeks', enabled: true, blocked: channel.blocked === true };
    draft.push(rule); markChanged(); render(rule);
    return rule;
  }
  addButton.addEventListener('click', () => appendRule());
  function close() { if (dialog.open) dialog.close(); }
  closeButton.addEventListener('click', close);
  cancel.addEventListener('click', close);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  save.addEventListener('click', () => {
    const ids = new Set();
    const invalidIndex = draft.findIndex(rule => {
      const id = service.normaliseChannelId(rule.channelId);
      const invalid = !id || ids.has(id) || !Number.isSafeInteger(rule.maxAge) || rule.maxAge < 1 || rule.maxAge > 1000 ||
        !['days', 'weeks', 'months', 'years'].includes(rule.unit) || typeof rule.name !== 'string' || typeof rule.enabled !== 'boolean' ||
        (rule.blocked !== undefined && typeof rule.blocked !== 'boolean');
      ids.add(id);
      return invalid;
    });
    if (invalidIndex >= 0) {
      showStatus(`Rule ${invalidIndex + 1}: enter a unique UC channel ID or channel URL and a whole-number age from 1 to 1,000. Each channel can have one rule.`, true);
      return;
    }
    let result;
    try { result = service.save(draft, saved); }
    catch { showStatus('Could not save channel upload filters. Your previous filters are unchanged.', true); return; }
    if (!result?.ok) {
      showStatus(result?.error || 'Could not save channel upload filters. Your previous filters are unchanged.', true);
      return;
    }
    saved = service.getRules();
    draft = saved.map(rule => ({ ...rule }));
    render(); showStatus('Saved. Channel upload filters now apply; no reload is needed.');
    document.defaultView.dispatchEvent(new document.defaultView.CustomEvent('yt-master-channel-age-changed'));
  });
  return {
    open(channel) {
      if (!dialog.open) {
        saved = service.read();
        draft = saved.map(rule => ({ ...rule }));
        markChanged(); render(); dialog.showModal(); content.scrollTop = 0;
      }
      const channelId = channel && service.normaliseChannelId(channel.channelId);
      if (channelId) {
        const existing = draft.find(rule => service.normaliseChannelId(rule.channelId) === channelId);
        if (channel.remove === true) {
          if (existing) {
            draft.splice(draft.indexOf(existing), 1); render();
            showStatus(`${existing.name || channelId} removed from this draft. Choose Save filters to apply it.`);
            save.focus();
          } else showStatus('This channel is not in the current filter draft. Nothing has been removed.');
        } else if (existing) render(existing);
        else appendRule({ channelId, name: typeof channel.name === 'string' ? channel.name : '', blocked: channel.blocked });
      } else if (!draft.length) addButton.focus();
      else closeButton.focus();
    },
    close,
  };
}
