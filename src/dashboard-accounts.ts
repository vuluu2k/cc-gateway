// Accounts section of the admin dashboard. Kept out of dashboard.ts so all
// account UI logic lives in one readable place; dashboard.ts only mounts it.

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Markup only. Every visible string is resolved in the browser via data-i18n. */
export function renderAccountsSection(): string {
  return `
    <section id="accounts" class="card" data-view="accounts">
      <h2 data-i18n="acct.title">Upstream accounts</h2>
      <form id="acctAdd" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <input name="id" required maxlength="64"
               data-i18n-ph="acct.idPlaceholder" placeholder="e.g. pro-1" autocomplete="off" />
        <input name="label" data-i18n-ph="acct.label" placeholder="Label" autocomplete="off" />
        <input name="email" type="email" data-i18n-ph="acct.emailPlaceholder" placeholder="Email (optional)" autocomplete="off" />
        <button type="submit" class="primary" data-i18n="acct.add">Add account</button>
      </form>
      <div id="acctError" class="error" style="display:none"></div>
      <div id="acctBulk" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <strong id="acctBulkCount"></strong>
        <input id="acctBulkModels" style="flex:1;min-width:220px" autocomplete="off" spellcheck="false"
               data-i18n-ph="acct.blockModelsPh" placeholder="Blocked models, comma-separated" />
        <span class="meta" data-i18n="acct.blockEfforts">Blocked effort:</span>
        ${EFFORTS.map((e) => `<label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" class="acct-bulk-effort" value="${e}" />${e}</label>`).join('')}
        <button type="button" id="acctBulkApply" class="primary" data-i18n="acct.blockApply">Apply to selected</button>
        <button type="button" id="acctBulkClear" data-i18n="acct.blockClear">Unblock selected</button>
      </div>
      <div class="scroll-y">
        <table>
          <thead><tr>
            <th><input type="checkbox" id="acctSelAll" data-i18n-title="acct.selectAll" title="Select all" /></th>
            <th data-i18n="acct.id">ID</th>
            <th data-i18n="acct.label">Label</th>
            <th data-i18n="acct.state">State</th>
            <th data-i18n="acct.blockedCol">Blocked</th>
            <th class="dtl" data-i18n="acct.expires">Token expires</th>
            <th class="dtl" data-i18n="acct.email">Email</th>
            <th class="dtl" data-i18n="acct.deviceId">Device ID</th>
            <th class="num" data-i18n="acct.usage">Usage</th>
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
    // id -> { label, email, env, promptEnv } as typed; survives re-renders too.
    const edit = {};
    let accounts = [];
    let defaultEmail = '';
    // Checked account ids for bulk block/unblock; survives re-renders.
    const selected = new Set();
    const selAll = document.getElementById('acctSelAll');

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
      return '<tr data-id="' + E(a.id) + '"><td colspan="11">'
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

    const json = (v) => (v && Object.keys(v).length ? JSON.stringify(v, null, 2) : '');
    const editPanel = (a) => {
      const e = edit[a.id];
      if (!e) return '';
      const field = (f, key) => '<label style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px">'
        + '<span class="meta">' + E(T(key)) + '</span>'
        + '<input class="acct-e" data-f="' + f + '" autocomplete="off" value="' + E(e[f]) + '" /></label>';
      const area = (f, key) => '<label style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:260px">'
        + '<span class="meta">' + E(T(key)) + '</span>'
        + '<textarea class="acct-e" data-f="' + f + '" rows="5" spellcheck="false" style="font-family:var(--mono);font-size:12px"'
        + ' placeholder="{}">' + E(e[f]) + '</textarea></label>';
      return '<tr data-id="' + E(a.id) + '"><td colspan="11">'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
        + field('label', 'acct.label') + field('email', 'acct.email')
        + '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
        + area('env', 'acct.envLabel') + area('promptEnv', 'acct.promptEnvLabel')
        + '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end">'
        + '<label style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:260px">'
        + '<span class="meta">' + E(T('acct.proxyLabel')) + (a.proxyUrl ? ' - ' + E(T('acct.proxyKeep', { url: a.proxyUrl })) : '') + '</span>'
        + '<input class="acct-e" data-f="proxyUrl" autocomplete="off" spellcheck="false" placeholder="' + E(T('acct.proxyPh')) + '" value="' + E(e.proxyUrl) + '" /></label>'
        + (a.proxyUrl ? '<button type="button" class="acct-proxy-clear danger">' + E(T('acct.proxyClear')) + '</button>' : '')
        + '</div><div style="display:flex;gap:8px;margin-top:8px">'
        + '<button type="button" class="acct-save primary">' + E(T('common.save')) + '</button>'
        + '<button type="button" class="acct-edit-cancel">' + E(T('common.cancel')) + '</button>'
        + '</div></td></tr>';
    };
    // Accounts still on the gateway's template email (user@example.com on a
    // fresh bootstrap), or sharing an email, all report one telemetry identity.
    const sharedIdentity = (a) => !a.email || a.email === defaultEmail
      || accounts.filter((b) => b.email === a.email).length > 1;

    const render = () => {
      document.getElementById('acctEmpty').style.display = accounts.length ? 'none' : 'block';
      for (const id of selected) if (!accounts.some((a) => a.id === id)) selected.delete(id);
      selAll.checked = accounts.length > 0 && selected.size === accounts.length;
      document.getElementById('acctBulk').style.display = selected.size ? 'flex' : 'none';
      document.getElementById('acctBulkCount').textContent = T('acct.selected', { n: selected.size });
      // One compact pill per account; a pill per entry wrapped the whole row.
      const blocks = (a) => a.blockedModels
        .concat(a.blockedEfforts.length ? ['effort ' + a.blockedEfforts.join('/')] : []).join(' · ');
      rowsEl.innerHTML = accounts.map((a) => '<tr data-id="' + E(a.id) + '">'
        + '<td><input type="checkbox" class="acct-sel"' + (selected.has(a.id) ? ' checked' : '') + ' /></td>'
        + '<td style="white-space:nowrap"><code>' + E(a.id) + '</code></td>'
        + '<td>' + E(a.label)
          + (a.proxyUrl ? ' <span class="pill warn" title="' + E(T('acct.viaProxy', { url: a.proxyUrl })) + '">proxy</span>' : '')
          + '</td>'
        + '<td style="white-space:nowrap"><span class="pill ' + (PILL[a.state] || 'warn') + '" title="' + E(a.lastError) + '">' + E(stateLabel(a.state)) + '</span></td>'
        + '<td style="white-space:nowrap">' + (blocks(a)
          ? '<span class="pill err" title="' + E(T('acct.blocked')) + '">' + E(blocks(a)) + '</span>'
          : '<span class="meta">-</span>') + '</td>'
        + '<td class="dtl">' + (a.expiresAt ? E(new Date(a.expiresAt).toLocaleString()) : '-') + '</td>'
        + '<td class="dtl">' + E(a.email)
          + (sharedIdentity(a) ? ' <span class="pill warn" title="' + E(T('acct.defaultIdentityHint')) + '">' + E(T('acct.defaultIdentity')) + '</span>' : '')
          + '</td>'
        + '<td class="dtl"><code title="' + E(a.deviceId) + '">' + E(String(a.deviceId).slice(0, 8)) + '...</code></td>'
        + '<td class="num" title="' + E(T('acct.usageRequests', { n: a.usage ? a.usage.requests : 0 })) + '">'
          + E(fmtCost(a.usage ? a.usage.costUsd : 0)) + '</td>'
        + '<td><input type="checkbox" class="acct-enabled"' + (a.enabled ? ' checked' : '') + ' /></td>'
        + '<td style="white-space:nowrap"><button type="button" class="acct-edit">' + E(T('acct.edit')) + '</button> '
        + '<button type="button" class="acct-login">' + E(T('acct.relogin')) + '</button> '
        + '<button type="button" class="acct-delete danger">' + E(T('acct.delete')) + '</button></td>'
        + '</tr>' + editPanel(a) + loginPanel(a)).join('');
    };

    const load = async () => {
      try {
        const r = await api('/api/accounts', 'GET');
        accounts = r.accounts;
        defaultEmail = r.defaultEmail || '';
        render();
      } catch (e) { showError(e.message); }
    };

    document.getElementById('acctAdd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      showError('');
      try {
        const email = f.email.value.trim();
        await api('/api/accounts', 'POST', {
          id: f.id.value.trim(), label: f.label.value.trim(), ...(email ? { email } : {}),
        });
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
        if (cls.contains('acct-edit')) {
          const a = accounts.find((x) => x.id === id);
          if (a) edit[id] = { label: a.label, email: a.email, env: json(a.env), promptEnv: json(a.promptEnv), proxyUrl: '' };
          render();
        } else if (cls.contains('acct-edit-cancel')) {
          delete edit[id];
          render();
        } else if (cls.contains('acct-save')) {
          const e = edit[id];
          if (!e) return;
          // Empty = null = inherit the gateway's env / prompt_env.
          const parse = (f, name) => {
            if (!e[f].trim()) return null;
            let v;
            try { v = JSON.parse(e[f]); } catch { v = undefined; }
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(T('acct.badJson', { field: name }));
            return v;
          };
          // proxyUrl is sent only when typed: the stored value is shown masked,
          // so echoing it back would overwrite the real URL with the mask.
          const proxyUrl = e.proxyUrl.trim();
          await api(url(id), 'PATCH', {
            label: e.label.trim(), email: e.email.trim(),
            env: parse('env', 'env'), promptEnv: parse('promptEnv', 'prompt_env'),
            ...(proxyUrl ? { proxyUrl } : {}),
          });
          delete edit[id];
          load();
        } else if (cls.contains('acct-proxy-clear')) {
          await api(url(id), 'PATCH', { proxyUrl: '' });
          if (edit[id]) edit[id].proxyUrl = '';
          load();
        } else if (cls.contains('acct-login')) {
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
      if (ev.target.classList.contains('acct-e')) {
        const e = edit[ev.target.closest('tr[data-id]').dataset.id];
        if (e) e[ev.target.dataset.f] = ev.target.value;
        return;
      }
      if (!ev.target.classList.contains('acct-code')) return;
      const l = login[ev.target.closest('tr[data-id]').dataset.id];
      if (l) l.code = ev.target.value;
    });

    selAll.addEventListener('change', () => {
      selected.clear();
      if (selAll.checked) accounts.forEach((a) => selected.add(a.id));
      render();
    });

    // Replaces each selected account's blocklists; sequential so a failure
    // names the account it stopped at and the rest stay untouched.
    const bulkSet = async (blockedModels, blockedEfforts) => {
      showError('');
      for (const id of selected) {
        try { await api(url(id), 'PATCH', { blockedModels, blockedEfforts }); }
        catch (e) { showError(id + ': ' + e.message); break; }
      }
      load();
    };
    document.getElementById('acctBulkApply').addEventListener('click', () => {
      const models = document.getElementById('acctBulkModels').value.split(',').map((m) => m.trim()).filter(Boolean);
      const efforts = [...document.querySelectorAll('.acct-bulk-effort:checked')].map((c) => c.value);
      bulkSet(models, efforts);
    });
    document.getElementById('acctBulkClear').addEventListener('click', () => bulkSet([], []));

    rowsEl.addEventListener('change', async (ev) => {
      if (ev.target.classList.contains('acct-sel')) {
        const id = ev.target.closest('tr[data-id]').dataset.id;
        if (ev.target.checked) selected.add(id); else selected.delete(id);
        render();
        return;
      }
      if (!ev.target.classList.contains('acct-enabled')) return;
      showError('');
      try {
        await api(url(ev.target.closest('tr[data-id]').dataset.id), 'PATCH', { enabled: ev.target.checked });
      } catch (e) { showError(e.message); load(); }
    });

    load();
    // Keep states fresh, but never re-render under the admin's cursor or in a hidden tab.
    setInterval(() => { if (!document.hidden && !rowsEl.contains(document.activeElement)) load(); }, 10000);
  }
`
}
