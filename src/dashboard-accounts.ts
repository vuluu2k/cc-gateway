// Accounts section of the admin dashboard. Kept out of dashboard.ts so all
// account UI logic lives in one readable place; dashboard.ts only mounts it.

/** Markup only. Every visible string is resolved in the browser via data-i18n. */
export function renderAccountsSection(): string {
  return `
    <section id="accounts" class="card">
      <h2 data-i18n="acct.title">Upstream accounts</h2>
      <form id="acctAdd" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <input name="id" required maxlength="64"
               data-i18n-ph="acct.idPlaceholder" placeholder="e.g. pro-1" autocomplete="off" />
        <input name="label" data-i18n-ph="acct.label" placeholder="Label" autocomplete="off" />
        <button type="submit" class="primary" data-i18n="acct.add">Add account</button>
      </form>
      <div id="acctError" class="error" style="display:none"></div>
      <div class="scroll-y">
        <table>
          <thead><tr>
            <th data-i18n="acct.id">ID</th>
            <th data-i18n="acct.label">Label</th>
            <th data-i18n="acct.state">State</th>
            <th data-i18n="acct.expires">Token expires</th>
            <th data-i18n="acct.email">Email</th>
            <th data-i18n="acct.deviceId">Device ID</th>
            <th data-i18n="acct.enabled">Enabled</th>
            <th></th>
          </tr></thead>
          <tbody id="acctRows"></tbody>
        </table>
      </div>
      <div id="acctEmpty" class="empty" data-i18n="acct.none" style="display:none">No accounts yet</div>
    </section>`
}

/**
 * Body for the dashboard's existing IIFE <script>. Wrapped in its own block so
 * its helper names cannot collide with the surrounding scope. Uses window.t().
 * Login state is keyed by account id, so several accounts can be mid-login.
 */
export function accountsScript(): string {
  return `
  {
    const T = (k, v) => (window.t ? window.t(k, v) : k);
    const E = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const rowsEl = document.getElementById('acctRows');
    const PILL = { ok: 'ok', refreshing: 'warn', expired: 'err', uninitialized: 'warn' };
    // id -> { url, code, error, busy }; survives re-renders of the table.
    const login = {};
    let accounts = [];

    const showError = (msg) => {
      const el = document.getElementById('acctError');
      el.textContent = msg || '';
      el.style.display = msg ? 'block' : 'none';
    };
    const api = async (url, method, body) => {
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) { location.href = '/admin'; throw new Error('unauthorized'); }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      return data;
    };
    const url = (id, action) => '/api/accounts/' + encodeURIComponent(id) + (action ? '/' + action : '');
    const stateLabel = (s) => T('acct.state' + s.charAt(0).toUpperCase() + s.slice(1));

    const loginPanel = (a) => {
      const l = login[a.id];
      if (!l) return '';
      return '<tr data-id="' + E(a.id) + '"><td colspan="8">'
        + '<p class="meta" style="margin:0 0 6px">' + E(T('acct.loginStep1')) + '</p>'
        + '<p style="margin:0 0 8px;word-break:break-all"><a href="' + E(l.url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">' + E(l.url) + '</a></p>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
        + '<input class="acct-code" style="flex:1;min-width:220px" autocomplete="off" spellcheck="false" placeholder="' + E(T('acct.loginStep2')) + '" value="' + E(l.code) + '" />'
        + '<button type="button" class="acct-complete primary"' + (l.busy ? ' disabled' : '') + '>' + E(T('acct.loginSubmit')) + '</button>'
        + '<button type="button" class="acct-cancel">' + E(T('common.cancel')) + '</button>'
        + '</div>'
        + (l.error ? '<div class="error" style="margin-top:8px">' + E(l.error) + '</div>' : '')
        + '</td></tr>';
    };

    const render = () => {
      document.getElementById('acctEmpty').style.display = accounts.length ? 'none' : 'block';
      rowsEl.innerHTML = accounts.map((a) => '<tr data-id="' + E(a.id) + '">'
        + '<td><code>' + E(a.id) + '</code></td>'
        + '<td>' + E(a.label) + '</td>'
        + '<td><span class="pill ' + (PILL[a.state] || 'warn') + '" title="' + E(a.lastError) + '">' + E(stateLabel(a.state)) + '</span></td>'
        + '<td>' + (a.expiresAt ? E(new Date(a.expiresAt).toLocaleString()) : '-') + '</td>'
        + '<td>' + E(a.email) + '</td>'
        + '<td><code title="' + E(a.deviceId) + '">' + E(String(a.deviceId).slice(0, 8)) + '...</code></td>'
        + '<td><input type="checkbox" class="acct-enabled"' + (a.enabled ? ' checked' : '') + ' /></td>'
        + '<td style="white-space:nowrap"><button type="button" class="acct-login">' + E(T('acct.relogin')) + '</button> '
        + '<button type="button" class="acct-delete danger">' + E(T('acct.delete')) + '</button></td>'
        + '</tr>' + loginPanel(a)).join('');
    };

    const load = async () => {
      try {
        accounts = (await api('/api/accounts', 'GET')).accounts;
        render();
      } catch (e) { showError(e.message); }
    };

    document.getElementById('acctAdd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      showError('');
      try {
        await api('/api/accounts', 'POST', { id: f.id.value.trim(), label: f.label.value.trim() });
        f.reset();
        load();
      } catch (e) { showError(e.message); }
    });

    rowsEl.addEventListener('click', async (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.dataset.id;
      const cls = ev.target.classList;
      showError('');
      try {
        if (cls.contains('acct-login')) {
          const r = await api(url(id, 'login'), 'POST');
          login[id] = { url: r.url, code: '', error: '', busy: false };
          render();
        } else if (cls.contains('acct-cancel')) {
          delete login[id];
          render();
          api(url(id, 'cancel'), 'POST').catch(() => {});
        } else if (cls.contains('acct-complete')) {
          const l = login[id];
          if (!l || !l.code.trim()) return;
          l.busy = true; l.error = ''; render();
          try {
            const r = await api(url(id, 'complete'), 'POST', { code: l.code.trim() });
            delete login[id];
            accounts = r.accounts;
          } catch (e) { l.busy = false; l.error = e.message; }
          render();
        } else if (cls.contains('acct-delete')) {
          try {
            await api(url(id), 'DELETE');
            delete login[id];
            load();
          } catch (e) {
            // 409 names the clients still bound; show it localized.
            const m = /still used by: (.*)$/.exec(e.message);
            showError(m ? T('acct.inUseBy', { names: m[1] }) : e.message);
          }
        }
      } catch (e) { showError(e.message); }
    });

    rowsEl.addEventListener('input', (ev) => {
      if (!ev.target.classList.contains('acct-code')) return;
      const l = login[ev.target.closest('tr[data-id]').dataset.id];
      if (l) l.code = ev.target.value;
    });

    rowsEl.addEventListener('change', async (ev) => {
      if (!ev.target.classList.contains('acct-enabled')) return;
      showError('');
      try {
        await api(url(ev.target.closest('tr[data-id]').dataset.id), 'PATCH', { enabled: ev.target.checked });
      } catch (e) { showError(e.message); load(); }
    });

    load();
    // Keep states fresh, but never re-render under the admin's cursor.
    setInterval(() => { if (!rowsEl.contains(document.activeElement)) load(); }, 10000);
  }
`
}
