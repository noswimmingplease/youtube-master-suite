// Lazy, native-DOM tools. No background work, remote storage or automatic reloads.
export function createSettingsSupportPanel(document, suite, hooks) {
  const node = (tag, text = '', attributes = {}) => {
    const element = document.createElement(tag);
    element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const button = (id, text, primary = false) => node('button', text, {
    id: `ytms-${id}`, type: 'button', class: `text-button ${primary ? 'primary' : 'outlined-button'}`,
  });
  const root = node('div', '', { class: 'support-tools' });
  const backup = node('section', '', { 'aria-labelledby': 'ytms-backup-heading' });
  const heading = node('h3', 'Backup and restore', { id: 'ytms-backup-heading' });
  const description = node('p', 'Download saved settings and channel upload filters for this browser profile. Unsaved edits are not included. The file includes channel names and IDs, so keep it private.', { class: 'section-note' });
  const exportButton = button('export-backup', 'Download backup');
  const fileLabel = node('label', 'Choose a backup to preview', { for: 'ytms-import-backup' });
  const fileInput = node('input', '', { id: 'ytms-import-backup', type: 'file', accept: '.json,application/json' });
  const fileField = node('div', '', { class: 'support-file-field' }); fileField.append(fileLabel, fileInput);
  const preview = node('div', '', { id: 'ytms-backup-preview', class: 'support-preview', hidden: '' });
  const backupStatus = node('p', '', { id: 'ytms-backup-status', class: 'section-note', role: 'status' });
  const actions = node('div', '', { class: 'support-actions' }); actions.append(exportButton);
  backup.append(heading, description, actions, fileField, preview, backupStatus);

  const troubleshooting = node('section', '', { 'aria-labelledby': 'ytms-support-heading' });
  const supportHeading = node('h3', 'Troubleshooting', { id: 'ytms-support-heading' });
  const supportNote = node('p', 'A local snapshot of module health and the last video-menu check. Reports exclude account data, video titles, URLs, channel IDs and raw error messages. Nothing is sent automatically. Timing diagnostics remain off.', { class: 'section-note' });
  const refreshButton = button('refresh-support', 'Refresh report');
  const copyButton = button('copy-support', 'Copy report');
  const supportActions = node('div', '', { class: 'support-actions' }); supportActions.append(refreshButton, copyButton);
  const summary = node('p', '', { id: 'ytms-support-summary', class: 'section-note' });
  const report = node('textarea', '', {
    id: 'ytms-support-report', readonly: '', rows: '9', spellcheck: 'false', 'aria-label': 'Privacy-safe troubleshooting report',
  });
  const supportStatus = node('p', '', { id: 'ytms-support-status', class: 'section-note', role: 'status' });
  troubleshooting.append(supportHeading, supportNote, summary, supportActions, report, supportStatus);
  root.append(backup, troubleshooting);

  let token = null;
  let updatePreview = null;
  let generation = 0;
  let downloadUrl = null;
  let downloadTimer = null;
  let disposed = false;
  function clearDownload() {
    if (downloadTimer !== null) document.defaultView.clearTimeout(downloadTimer);
    if (downloadUrl) document.defaultView.URL.revokeObjectURL(downloadUrl);
    downloadUrl = null; downloadTimer = null;
  }
  function clearPreview() {
    generation++; token = null; updatePreview = null; fileInput.value = ''; preview.replaceChildren(); preview.hidden = true;
  }
  function setBackupStatus(text, error = false) {
    backupStatus.textContent = text; backupStatus.classList.toggle('support-error', error);
  }
  function refresh() {
    const snapshot = suite.support.snapshot();
    report.value = JSON.stringify(snapshot, null, 2);
    // Descriptions are provided by the sanitising service, not page content.
    summary.textContent = snapshot.summary || 'Report refreshed. Module health describes initialisation, not every YouTube feature.';
    supportStatus.textContent = '';
    updatePreview?.();
  }
  exportButton.addEventListener('click', () => {
    const result = suite.backup.exportData();
    if (!result.ok) { setBackupStatus(result.error, true); return; }
    try {
      clearDownload();
      const view = document.defaultView;
      downloadUrl = view.URL.createObjectURL(new view.Blob([result.text], { type: 'application/json;charset=utf-8' }));
      const link = node('a', '', { href: downloadUrl, download: 'youtube-master-suite-backup.json', hidden: '' });
      root.append(link);
      try { link.click(); } finally { link.remove(); }
      downloadTimer = view.setTimeout(clearDownload, 30000);
      setBackupStatus('Backup download requested. It contains saved settings and channel filters only.');
    } catch { clearDownload(); setBackupStatus('The backup could not be downloaded. Browser file access may be restricted.', true); }
  });
  const describeValue = value => Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value);
  const settingName = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
  function showPreview(result) {
    token = result.preview; preview.replaceChildren(); preview.hidden = false;
    const { settingChanges, filters, warning } = result.summary;
    preview.append(node('h4', 'Restore preview'), node('p', warning),
      node('p', `${settingChanges.length} ${settingChanges.length === 1 ? 'setting' : 'settings'} changed. Channel filters: ${filters.added} added, ${filters.changed} updated, ${filters.removed} removed; ${filters.total} after restore.`));
    if (settingChanges.length) {
      const details = node('details'); details.append(node('summary', 'Review setting changes'));
      const list = node('ul');
      for (const change of settingChanges) list.append(node('li', `${settingName(change.name)}: ${describeValue(change.before)} → ${describeValue(change.after)}`));
      details.append(list); preview.append(details);
    }
    const acknowledgement = node('label', '', { class: 'support-confirm' });
    const check = node('input', '', { type: 'checkbox', id: 'ytms-confirm-restore' });
    acknowledgement.append(check, document.createTextNode('Replace my saved settings and channel filters with this backup.'));
    const restore = button('restore-backup', 'Restore this backup', true); restore.disabled = true;
    const cancel = button('cancel-restore', 'Cancel restore');
    const buttons = node('div', '', { class: 'support-actions' }); buttons.append(restore, cancel);
    preview.append(acknowledgement, buttons);
    const changed = settingChanges.length || filters.added || filters.changed || filters.removed;
    const update = () => {
      const dirty = hooks.hasDraft();
      restore.disabled = !check.checked || !changed || dirty;
      if (dirty) setBackupStatus('Save or discard your settings edits before restoring a backup.', true);
      else if (!changed) setBackupStatus('This backup already matches your saved settings and channel filters.');
      else setBackupStatus('Preview only. Nothing has been changed. Restoring will not reload or interrupt playback.');
    };
    updatePreview = update;
    check.addEventListener('change', update);
    cancel.addEventListener('click', () => { clearPreview(); setBackupStatus('Restore cancelled. Nothing has been changed.'); });
    restore.addEventListener('click', () => {
      if (hooks.hasDraft()) { update(); return; }
      if (!check.checked || restore.disabled || !token) return;
      const restored = suite.backup.restore(token);
      clearPreview();
      if (!restored.ok) { setBackupStatus(restored.error, true); return; }
      hooks.onRestored(restored);
      setBackupStatus('Backup restored. Channel filters are active. Reload when ready to apply any changed settings.');
      refresh();
    });
    update();
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    token = null; updatePreview = null; preview.replaceChildren(); preview.hidden = true;
    const request = ++generation;
    if (!file) return;
    if (file.size > 131072) { setBackupStatus('Choose a JSON backup no larger than 128 KiB.', true); return; }
    setBackupStatus('Reading backup for preview…');
    try {
      const text = await file.text();
      if (request !== generation || disposed) return;
      const result = suite.backup.preview(text);
      if (result.ok) showPreview(result); else setBackupStatus(result.error, true);
    } catch { if (request === generation && !disposed) setBackupStatus('The selected file could not be read.', true); }
  });
  refreshButton.addEventListener('click', refresh);
  copyButton.addEventListener('click', async () => {
    refresh();
    const request = generation;
    try {
      const clipboard = document.defaultView.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(report.value);
      if (!disposed && request === generation) supportStatus.textContent = 'Report copied. Review it before sharing.';
    } catch {
      if (disposed || request !== generation) return;
      report.focus(); report.select();
      supportStatus.textContent = 'Clipboard access is unavailable. The report is selected; copy it manually.';
    }
  });
  // File selection and restore acknowledgement are not unsaved preferences.
  for (const type of ['input', 'change']) root.addEventListener(type, event => event.stopPropagation());
  return Object.freeze({
    element: root,
    refresh,
    updateDraftState() { updatePreview?.(); },
    reset() {
      disposed = false; clearPreview(); setBackupStatus('');
      report.value = ''; summary.textContent = ''; supportStatus.textContent = '';
    },
    close() { disposed = true; clearPreview(); clearDownload(); },
  });
}
