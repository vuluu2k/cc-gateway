// Overview "control center" of the admin dashboard: what needs attention,
// one card per upstream account, and every client's headroom against its
// limit, each with the action that fixes it. dashboard.ts mounts the markup,
// the CSS and the script; the script runs inside dashboard.ts's IIFE and uses
// its helpers (t, esc, fmtCost, fmtNum, fmtAgo, fmtCountdown, goView, refresh).

/** Markup only. Every visible string is resolved in the browser via data-i18n. */
export function renderOverviewSection(): string {
  return `
    <section id="attention" class="card" data-view="overview"></section>
    <section id="ccAccounts" class="card" data-view="overview">
      <h2><span data-i18n="cc.accounts">Claude accounts</span><a href="#accounts" class="h-link" data-i18n="cc.manage">Manage →</a></h2>
      <div id="acctCards" class="acc-grid"></div>
    </section>
    <section id="ccClients" class="card" data-view="overview">
      <h2><span data-i18n="cc.clients">Clients</span><a href="#clients" class="h-link" data-i18n="cc.manage">Manage →</a></h2>
      <div id="clientList"></div>
    </section>`
}

export function overviewCss(): string {
  return `
  .card h2 .h-link { float: right; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 12px; color: var(--accent); text-decoration: none; }
  .card h2 .h-link:hover { text-decoration: underline; }
  /* Attention list */
  #attention h2 { display: flex; align-items: center; gap: 8px; }
  #attention .count { background: var(--err); color: #fff; border-radius: 10px; padding: 0 7px; font-size: 11px; line-height: 18px; letter-spacing: 0; }
  .att { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; margin-top: 8px;
    background: var(--panel-2); border: 1px solid var(--border); border-left: 3px solid var(--warn); }
  .att.err { border-left-color: var(--err); }
  .att .msg-t { flex: 1; min-width: 0; font-size: 13px; }
  .att button { white-space: nowrap; }
  .all-good { display: flex; align-items: center; gap: 10px; color: var(--ok); font-size: 13px; }
  .all-good::before { content: "✓"; font-weight: 700; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: rgba(63,185,80,.15); }
  /* Account cards */
  .acc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .acc { background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .acc.bad { border-color: rgba(248,81,73,.45); }
  .acc.off { opacity: .6; }
  .acc-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .acc-top code { font-family: var(--mono); font-weight: 600; }
  .acc-top .lbl { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--muted); }
  .dot.ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(63,185,80,.15); }
  .dot.warn { background: var(--warn); } .dot.err { background: var(--err); }
  .mrow { display: grid; grid-template-columns: 22px 1fr 40px; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
  .mrow b { color: var(--fg); font-weight: 600; text-align: right; }
  .meter { height: 7px; background: var(--bg); border-radius: 5px; overflow: hidden; }
  .meter > span { display: block; height: 100%; background: var(--ok); border-radius: 5px; transition: width .4s ease; }
  .meter > span.warn { background: var(--warn); } .meter > span.err { background: var(--err); } .meter > span.none { background: transparent; }
  .acc .reset { font-size: 11px; color: var(--muted); margin-top: -4px; }
  .acc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; border-top: 1px solid var(--border); padding-top: 10px; }
  .acc-stats b { display: block; font-family: var(--mono); font-size: 15px; }
  .acc-stats span { font-size: 11px; color: var(--muted); }
  .acc-actions { display: flex; align-items: center; gap: 8px; }
  .acc-actions .sp { flex: 1; }
  /* On/off switch */
  .switch { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--muted); }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch i { width: 32px; height: 18px; border-radius: 10px; background: rgba(255,255,255,.12); position: relative; transition: background .15s; }
  .switch i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .switch input:checked + i { background: var(--ok); }
  .switch input:checked + i::after { transform: translateX(14px); }
  .switch input:focus-visible + i { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* Client headroom list */
  .cl { display: grid; grid-template-columns: minmax(110px, 180px) 1fr auto; gap: 16px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
  .cl:last-child { border-bottom: 0; }
  .cl .nm strong { display: block; font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; }
  .cl .nm span, .cl .sub { font-size: 12px; color: var(--muted); }
  .cl .sub { margin-top: 5px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .cl .sub .bad { color: var(--err); } .cl .sub .near { color: var(--warn); }
  .nav-badge { margin-left: auto; background: var(--err); color: #fff; border-radius: 10px; padding: 0 6px; font-size: 10px; line-height: 16px; font-family: var(--mono); }
  @media (max-width: 600px) {
    .cl { grid-template-columns: 1fr auto; gap: 8px 12px; }
    .cl .bar { grid-column: 1 / -1; grid-row: 2; }
    .att { flex-wrap: wrap; }
  }
`
}

/** Body for the dashboard's IIFE. Defines renderControl(data, cfgClients). */
export function overviewScript(): string {
  return `
  // A binding the gateway would actually route to: account on + logged in, under its limit.
  const usableAcct = (a) => a && a.enabled && (a.state === 'ok' || a.state === 'refreshing');
  const bindPct = (b) => (b.limitUsd > 0 ? Math.round((b.usedUsd / b.limitUsd) * 100) : 0);
  const periodName = (p) => t('bind.period' + p.charAt(0).toUpperCase() + p.slice(1));
  const meterCls = (pct) => (pct >= 90 ? 'err' : pct >= 75 ? 'warn' : '');
  const quotaWin = (q, key) => q && (q.windows || []).find(w => w.key === key && w.usedPct != null);

  // Mirrors the gateway's pick: first binding by priority that is usable and under its limit.
  const activeBinding = (c, accts) => (c.bindings || []).slice()
    .sort((a, b) => a.priority - b.priority)
    .find(b => usableAcct(accts[b.accountId]) && (b.limitUsd <= 0 || b.usedUsd < b.limitUsd));

  const attentionItems = (data, cfg) => {
    const items = [];
    const accts = data.accounts || [];
    const byId = Object.fromEntries(accts.map(a => [a.id, a]));
    if (!accts.length) items.push({ lvl: 'err', text: t('cc.noAccounts'), act: 'accounts', label: t('cc.addAccount') });
    for (const a of accts) {
      if (!a.enabled) {
        items.push({ lvl: 'warn', text: t('cc.acctOff', { id: a.id }), act: 'enable', arg: a.id, label: t('cc.turnOn') });
      } else if (a.state === 'expired' || a.state === 'uninitialized') {
        items.push({ lvl: 'err', text: t('cc.acctLogin', { id: a.id }), act: 'relogin', arg: a.id, label: t('acct.relogin') });
      } else {
        for (const key of ['5h', '7d']) {
          const w = quotaWin((data.quotas || {})[a.id], key);
          if (w && w.usedPct >= 90) {
            items.push({ lvl: 'warn', text: t('cc.acctQuota', { id: a.id, pct: Math.round(w.usedPct), win: key })
              + (w.resetMs ? ' · ' + t('admin.quota.resetIn', { t: fmtCountdown(w.resetMs) }) : '') });
          }
        }
      }
    }
    for (const c of cfg) {
      if (!(c.bindings || []).length) {
        items.push({ lvl: 'err', text: t('cc.noBinding', { name: c.name }), act: 'limits', arg: c.name, label: t('cc.assign') });
        continue;
      }
      const b = activeBinding(c, byId);
      if (!b) items.push({ lvl: 'err', text: t('cc.exhausted', { name: c.name }), act: 'limits', arg: c.name, label: t('cc.editLimits') });
      else if (bindPct(b) >= 80) {
        items.push({ lvl: 'warn', text: t('cc.nearLimit', { name: c.name, pct: bindPct(b), id: b.accountId, period: periodName(b.limitPeriod) }),
          act: 'limits', arg: c.name, label: t('cc.editLimits') });
      }
    }
    const k = (data.kpis || {}).last24h || {};
    const errPct = k.total ? (k.errors / k.total) * 100 : 0;
    if (k.total >= 20 && errPct >= 5) {
      items.push({ lvl: 'warn', text: t('cc.errorRate', { pct: errPct.toFixed(1), n: fmtNum(k.errors), total: fmtNum(k.total) }),
        act: 'recent', label: t('cc.viewRequests') });
    }
    return items.sort((a, b) => (a.lvl === b.lvl ? 0 : a.lvl === 'err' ? -1 : 1));
  };

  const actBtn = (it) => it.act
    ? '<button type="button" data-cc="' + it.act + '"' + (it.arg ? ' data-arg="' + esc(it.arg) + '"' : '') + '>' + esc(it.label) + '</button>'
    : '';

  const renderAttention = (items) => {
    const el = document.getElementById('attention');
    el.innerHTML = items.length
      ? '<h2>' + esc(t('cc.attention')) + ' <span class="count">' + items.length + '</span></h2>'
        + items.map(it => '<div class="att ' + it.lvl + '"><span class="msg-t">' + esc(it.text) + '</span>' + actBtn(it) + '</div>').join('')
      : '<div class="all-good">' + esc(t('cc.allGood')) + '</div>';
    const link = document.querySelector('#sideNav a[href="#overview"]');
    let badge = link.querySelector('.nav-badge');
    if (!items.length) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; link.appendChild(badge); }
    badge.textContent = items.length;
  };

  const meterRow = (label, w) => {
    const pct = w ? Math.round(w.usedPct) : null;
    return '<div class="mrow"><span>' + label + '</span><div class="meter"><span class="' + (pct == null ? 'none' : meterCls(pct))
      + '" style="width:' + (pct || 0) + '%"></span></div><b>' + (pct == null ? '—' : pct + '%') + '</b></div>';
  };

  const renderAccountCards = (data, cfg) => {
    const el = document.getElementById('acctCards');
    const accts = data.accounts || [];
    if (!accts.length) {
      el.innerHTML = '<div class="empty">' + esc(t('cc.noAccounts')) + ' <button type="button" data-cc="accounts">' + esc(t('cc.addAccount')) + '</button></div>';
      return;
    }
    const usage = (data.kpis || {}).byAccount24h || {};
    const PILL = { ok: 'ok', refreshing: 'warn', expired: 'err', uninitialized: 'warn' };
    el.innerHTML = accts.map(a => {
      const q = (data.quotas || {})[a.id];
      const w5 = quotaWin(q, '5h'), w7 = quotaWin(q, '7d');
      const u = usage[a.id] || { costUsd: 0, requests: 0, errors: 0 };
      const nClients = cfg.filter(c => (c.bindings || []).some(b => b.accountId === a.id)).length;
      const needsLogin = a.state === 'expired' || a.state === 'uninitialized';
      const dot = !a.enabled ? '' : PILL[a.state] || 'warn';
      const pill = a.enabled
        ? '<span class="pill ' + (PILL[a.state] || 'warn') + '">' + esc(t('acct.state' + a.state.charAt(0).toUpperCase() + a.state.slice(1))) + '</span>'
        : '<span class="pill">' + esc(t('cc.off')) + '</span>';
      const reset = w5 && w5.resetMs
        ? '<div class="reset" data-reset="' + w5.resetMs + '">' + esc(t('admin.quota.resetIn', { t: fmtCountdown(w5.resetMs) })) + '</div>'
        : (!w5 && !w7 ? '<div class="reset">' + esc(t('cc.noQuota')) + '</div>' : '');
      return '<div class="acc' + (!a.enabled ? ' off' : needsLogin ? ' bad' : '') + '">'
        + '<div class="acc-top"><span class="dot ' + dot + '"></span><code>' + esc(a.id) + '</code><span class="lbl">' + esc(a.label) + '</span>' + pill + '</div>'
        + meterRow('5h', w5) + meterRow('7d', w7) + reset
        + '<div class="acc-stats">'
        + '<div><b>' + fmtCost(u.costUsd) + '</b><span>' + esc(t('cc.cost24h')) + '</span></div>'
        + '<div><b>' + fmtNum(u.requests) + '</b><span>' + esc(t('cc.req24h')) + (u.errors ? ' · <span style="color:var(--err)">' + fmtNum(u.errors) + ' ' + esc(t('cc.err')) + '</span>' : '') + '</span></div>'
        + '<div><b>' + nClients + '</b><span>' + esc(t('cc.clientsN')) + '</span></div>'
        + '</div>'
        + '<div class="acc-actions"><label class="switch"><input type="checkbox" data-cc="toggle" data-arg="' + esc(a.id) + '"' + (a.enabled ? ' checked' : '') + ' /><i></i>'
        + esc(t(a.enabled ? 'cc.on' : 'cc.off')) + '</label><span class="sp"></span>'
        + (needsLogin && a.enabled ? '<button type="button" class="primary" data-cc="relogin" data-arg="' + esc(a.id) + '">' + esc(t('acct.relogin')) + '</button>' : '')
        + '</div></div>';
    }).join('');
  };

  const renderClientList = (data, cfg) => {
    const el = document.getElementById('clientList');
    if (!cfg.length) {
      el.innerHTML = '<div class="empty">' + esc(t('admin.empty.noClientsConfigured')) + ' <button type="button" data-cc="addClient">' + esc(t('admin.addClient')) + '</button></div>';
      return;
    }
    const byId = Object.fromEntries((data.accounts || []).map(a => [a.id, a]));
    const seen = Object.fromEntries((data.clients || []).map(c => [c.name, c.lastSeen]));
    const rows = cfg.map(c => {
      const b = activeBinding(c, byId);
      const pct = b ? bindPct(b) : 100;
      return { c, b, rank: !(c.bindings || []).length || !b ? 1000 : pct };
    }).sort((x, y) => y.rank - x.rank);
    el.innerHTML = rows.map(({ c, b }) => {
      const none = !(c.bindings || []).length;
      let bar, sub;
      if (none || !b) {
        bar = '<div class="meter"><span class="err" style="width:100%"></span></div>';
        sub = '<span class="bad">' + esc(t(none ? 'cc.noBindingShort' : 'cc.exhaustedShort')) + '</span>';
      } else {
        const pct = bindPct(b);
        bar = '<div class="meter"><span class="' + (b.limitUsd > 0 ? meterCls(pct) : 'none') + '" style="width:' + Math.min(100, pct) + '%"></span></div>';
        sub = '<span class="' + (pct >= 80 ? 'near' : '') + '">' + esc(t('cc.inUse', { id: b.accountId })) + ' · ' + fmtCost(b.usedUsd)
          + (b.limitUsd > 0 ? ' / ' + fmtCost(b.limitUsd) + ' · ' + esc(periodName(b.limitPeriod)) : ' · ' + esc(t('cc.noLimit'))) + '</span>'
          + (b.limitUsd > 0 ? '<span>' + pct + '%</span>' : '');
      }
      const last = seen[c.name];
      return '<div class="cl">'
        + '<div class="nm"><strong>' + esc(c.name) + '</strong><span>' + esc(last ? fmtAgo(last) : t('cc.neverSeen')) + '</span></div>'
        + '<div class="bar">' + bar + '<div class="sub">' + sub + '</div></div>'
        + '<button type="button" data-cc="limits" data-arg="' + esc(c.name) + '">' + esc(t(none ? 'cc.assign' : 'cc.editLimits')) + '</button>'
        + '</div>';
    }).join('');
  };

  const renderControl = (data, cfg) => {
    renderAttention(attentionItems(data, cfg));
    renderAccountCards(data, cfg);
    renderClientList(data, cfg);
  };

  // One delegated handler for every control-center action.
  const ccAct = async (act, arg, el) => {
    if (act === 'accounts' || act === 'recent') return goView(act);
    if (act === 'addClient') return document.getElementById('addClientBtn').click();
    if (act === 'limits') {
      const btn = document.querySelector('#clientsConfig [data-bind-client="' + CSS.escape(arg) + '"]');
      if (btn) btn.click(); // the bindings modal is fixed-position, so no view switch needed
      return;
    }
    if (act === 'relogin') {
      return goView('accounts', () => {
        const btn = document.querySelector('#acctRows tr[data-id="' + CSS.escape(arg) + '"] .acct-login');
        if (!btn) return;
        btn.click();
        btn.closest('tr').scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    if (act === 'enable' || act === 'toggle') {
      const enabled = act === 'enable' ? true : el.checked;
      const res = await fetch('/api/accounts/' + encodeURIComponent(arg), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(t('admin.alert.failed', { error: err.error || res.status }));
      }
      refresh();
    }
  };
  document.querySelector('main').addEventListener('click', (ev) => {
    const el = ev.target.closest('button[data-cc]');
    if (el) ccAct(el.dataset.cc, el.dataset.arg, el);
  });
  document.querySelector('main').addEventListener('change', (ev) => {
    if (ev.target.matches('input[data-cc="toggle"]')) ccAct('toggle', ev.target.dataset.arg, ev.target);
  });
`
}
