// Client <-> account bindings editor for the admin dashboard Clients section.
// Kept out of dashboard.ts: the Clients table only renders a button with
// data-bind-client; everything else lives here.

/** Markup only. Every visible string is resolved in the browser via data-i18n. */
export function renderBindingsModal(): string {
  return `
<div id="bindModal" class="modal" style="display:none">
  <div class="modal-box wide">
    <h3><span data-i18n="bind.title">Accounts for this client</span> · <span id="bindName"></span></h3>
    <div id="bindNone" class="empty" data-i18n="bind.none" style="display:none"></div>
    <table id="bindTable" style="display:none">
      <thead><tr>
        <th data-i18n="acct.id">Account</th>
        <th><span data-i18n="bind.priority">Priority</span></th>
        <th data-i18n="bind.limit">Limit (USD)</th>
        <th data-i18n="bind.period">Period</th>
        <th></th>
      </tr></thead>
      <tbody id="bindRows"></tbody>
    </table>
    <p class="meta" style="margin:8px 0 0">
      <span data-i18n="bind.order">Lower priority is used first</span> ·
      <span data-i18n="bind.unlimited">0 = unlimited</span>
    </p>
    <div id="bindError" class="error" style="display:none;margin-top:12px"></div>
    <div style="display:flex;gap:8px;margin-top:18px;justify-content:space-between">
      <button id="bindAdd" type="button" data-i18n="bind.add">Add account</button>
      <span style="display:flex;gap:8px">
        <button id="bindCancel" type="button" data-i18n="common.cancel">Cancel</button>
        <button id="bindSave" type="button" class="primary" data-i18n="bind.save">Save bindings</button>
      </span>
    </div>
  </div>
</div>`
}

/**
 * Body for the dashboard's existing IIFE <script>, in its own block so helper
 * names cannot collide. Save PUTs the whole array (replace semantics).
 */
export function bindingsScript(): string {
  return `
  {
    const T = (k, v) => (window.t ? window.t(k, v) : k);
    const E = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const modal = document.getElementById('bindModal');
    const rowsEl = document.getElementById('bindRows');
    const saveBtn = document.getElementById('bindSave');
    const PERIODS = ['lifetime', 'monthly', 'daily'];
    let client = '';
    let accountIds = [];

    const showError = (msg) => {
      const el = document.getElementById('bindError');
      el.textContent = msg || '';
      el.style.display = msg ? 'block' : 'none';
    };
    const close = () => { modal.style.display = 'none'; };
    const syncEmpty = () => {
      const n = rowsEl.children.length;
      document.getElementById('bindNone').style.display = n ? 'none' : 'block';
      document.getElementById('bindTable').style.display = n ? '' : 'none';
    };

    const rowHtml = (b) => '<tr>'
      + '<td><select class="b-acct">' + accountIds.map((id) =>
          '<option value="' + E(id) + '"' + (id === b.accountId ? ' selected' : '') + '>' + E(id) + '</option>').join('')
        + '</select></td>'
      + '<td><input class="b-prio" type="number" step="1" style="width:80px" value="' + E(b.priority) + '" /></td>'
      + '<td><input class="b-limit" type="number" min="0" step="0.01" style="width:110px" value="' + E(b.limitUsd) + '" /></td>'
      + '<td><select class="b-period">' + PERIODS.map((p) =>
          '<option value="' + p + '"' + (p === b.limitPeriod ? ' selected' : '') + '>'
          + E(T('bind.period' + p.charAt(0).toUpperCase() + p.slice(1))) + '</option>').join('')
        + '</select></td>'
      + '<td><button type="button" class="b-del danger">&times;</button></td>'
      + '</tr>';

    const addRow = (b) => {
      rowsEl.insertAdjacentHTML('beforeend', rowHtml(b));
      syncEmpty();
    };

    const open = async (name) => {
      client = name;
      document.getElementById('bindName').textContent = name;
      rowsEl.innerHTML = '';
      showError('');
      syncEmpty();
      modal.style.display = 'flex';
      // Save stays disabled until both loads succeed, so a failed load can
      // never be saved over the client's real bindings.
      saveBtn.disabled = true;
      document.getElementById('bindNone').style.display = 'none';
      const get = async (url) => {
        const r = await fetch(url, { credentials: 'same-origin' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || String(r.status));
        return d;
      };
      try {
        const [a, b] = await Promise.all([
          get('/api/accounts'),
          get('/api/clients/' + encodeURIComponent(name) + '/accounts'),
        ]);
        accountIds = (a.accounts || []).map((x) => x.id);
        (b.bindings || []).forEach(addRow);
        saveBtn.disabled = false;
      } catch (e) {
        rowsEl.innerHTML = '';
        document.getElementById('bindNone').style.display = 'none';
        document.getElementById('bindTable').style.display = 'none';
        showError(e.message);
      }
    };

    // Returns the bindings array, or null after showing a validation error.
    // An empty limit is rejected rather than coerced: the server would read it as 0 = unlimited.
    const collect = () => {
      const out = [];
      const seen = new Set();
      for (const tr of rowsEl.children) {
        const accountId = tr.querySelector('.b-acct').value;
        const priority = tr.querySelector('.b-prio').value.trim();
        const limit = tr.querySelector('.b-limit').value.trim();
        if (!accountId || seen.has(accountId)) { showError(T('bind.errAccount')); return null; }
        seen.add(accountId);
        if (priority === '' || !Number.isFinite(Number(priority))) { showError(T('bind.errPriority')); return null; }
        if (limit === '' || !Number.isFinite(Number(limit)) || Number(limit) < 0) { showError(T('bind.errLimit')); return null; }
        out.push({
          account_id: accountId,
          priority: Number(priority),
          limit_usd: Number(limit),
          limit_period: tr.querySelector('.b-period').value,
        });
      }
      return out;
    };

    document.getElementById('clientsConfig').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-bind-client]');
      if (btn) open(btn.getAttribute('data-bind-client'));
    });
    document.getElementById('bindAdd').addEventListener('click', () => {
      if (!accountIds.length) { showError(T('bind.errNoAccounts')); return; }
      showError('');
      const used = new Set(Array.from(rowsEl.querySelectorAll('.b-acct')).map((s) => s.value));
      const next = accountIds.find((id) => !used.has(id)) || accountIds[0];
      const prios = Array.from(rowsEl.querySelectorAll('.b-prio')).map((i) => Number(i.value) || 0);
      addRow({ accountId: next, priority: prios.length ? Math.max(...prios) + 1 : 1, limitUsd: 0, limitPeriod: 'lifetime' });
    });
    rowsEl.addEventListener('click', (ev) => {
      if (!ev.target.classList.contains('b-del')) return;
      ev.target.closest('tr').remove();
      syncEmpty();
    });
    document.getElementById('bindCancel').addEventListener('click', close);
    modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
    document.getElementById('bindSave').addEventListener('click', async () => {
      showError('');
      const bindings = collect();
      if (!bindings) return;
      const btn = saveBtn;
      btn.disabled = true;
      try {
        const res = await fetch('/api/clients/' + encodeURIComponent(client) + '/accounts', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bindings }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showError(data.error || String(res.status)); return; }
        close();
      } catch (e) { showError(e.message); }
      finally { btn.disabled = false; }
    });
  }
`
}
