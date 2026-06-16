// Client self-service portal. Clients sign in with their name + password and can
// manage their personal info, review credit + usage (totals, per-model, recent
// activity), rotate their password, and follow a detailed install guide or grab
// their launcher. Everything is scoped to the one authenticated client.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SHARED_HEAD_STYLE = `
  :root {
    --bg: #0b0d10; --panel: #14181d; --panel-2: #1b2027; --border: #232a33;
    --fg: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --ok: #3fb950;
    --warn: #d29922; --err: #f85149;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
  }
  a { color: var(--accent); }
  button, select {
    background: var(--panel-2); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 12px; font-size: 13px; font-family: inherit; cursor: pointer;
  }
  button:hover, select:hover { border-color: var(--accent); }
  button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  button.primary:hover { background: #388bfd; border-color: #388bfd; }
  button.ghost { background: transparent; }
  .error { background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.3); color: var(--err); padding: 10px 12px; border-radius: 6px; font-size: 13px; }
`

export function renderPortalLogin(error?: string): string {
  const errBlock = error ? `<div class="error" style="margin-bottom:8px">${escapeHtml(error)}</div>` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CC Gateway — Client Portal</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
${SHARED_HEAD_STYLE}
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(900px 500px at 50% -10%, #161b22 0%, var(--bg) 60%); }
  .box { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 32px; width: 380px; max-width: 90vw; }
  .brand { font-weight: 700; font-size: 15px; margin-bottom: 18px; }
  .brand .dot { color: var(--accent); }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p.sub { color: var(--muted); font-size: 13px; margin: 0 0 22px; }
  label { display: block; font-size: 12px; color: var(--muted); margin: 14px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
  input {
    width: 100%; padding: 10px 12px; box-sizing: border-box;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    font-size: 14px; font-family: var(--mono);
  }
  input:focus { outline: none; border-color: var(--accent); }
  button[type=submit] { margin-top: 22px; width: 100%; padding: 10px; font-size: 14px; font-weight: 500; }
  .back { display: block; text-align: center; margin-top: 16px; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
  <form class="box" method="post" action="/portal/login">
    <div class="brand">CC <span class="dot">Gateway</span></div>
    <h1>Client Portal</h1>
    <p class="sub">Sign in with the client name and password your admin gave you.</p>
    ${errBlock}
    <label for="name">Client name</label>
    <input id="name" name="name" autocomplete="username" autofocus required placeholder="e.g. alice" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="your password" />
    <button type="submit" class="primary">Sign in</button>
    <a class="back" href="/">← Back to home</a>
  </form>
</body>
</html>`
}

export function renderPortal(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CC Gateway — Client Portal</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
${SHARED_HEAD_STYLE}
  header {
    padding: 14px 24px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    background: var(--panel); position: sticky; top: 0; z-index: 20;
  }
  header .left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  header .avatar {
    width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
    background: linear-gradient(135deg, #1f6feb, #58a6ff); color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;
  }
  header .title { font-size: 15px; font-weight: 600; line-height: 1.2; }
  header .sub { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  nav.tabs {
    display: flex; gap: 4px; overflow-x: auto; padding: 0 16px;
    background: var(--panel); border-bottom: 1px solid var(--border);
    position: sticky; top: 63px; z-index: 19; scrollbar-width: none;
  }
  nav.tabs::-webkit-scrollbar { display: none; }
  nav.tabs a {
    padding: 12px 14px; font-size: 13px; color: var(--muted); text-decoration: none;
    border-bottom: 2px solid transparent; white-space: nowrap;
  }
  nav.tabs a:hover { color: var(--fg); }
  nav.tabs a.active { color: var(--accent); border-bottom-color: var(--accent); }
  main { padding: 22px 24px; max-width: 1000px; margin: 0 auto; }
  section.block { scroll-margin-top: 110px; margin-bottom: 26px; }
  section.block > h2.section-title { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 12px; }
  .grid { display: grid; gap: 16px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 12px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .card h3 { margin: 0 0 12px; font-size: 13px; }
  .stat .value { font-size: 22px; font-weight: 600; font-family: var(--mono); }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; margin-top: 4px; letter-spacing: .03em; }
  .credit-card { background: linear-gradient(135deg, #11161d, #1a2230); }
  .credit-big { font-size: 36px; font-weight: 700; font-family: var(--mono); }
  .credit-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .meter { height: 10px; background: var(--panel-2); border-radius: 6px; overflow: hidden; margin: 16px 0 6px; }
  .meter > span { display: block; height: 100%; background: var(--ok); width: 0; transition: width .3s; }
  .meter > span.warn { background: var(--warn); }
  .meter > span.err { background: var(--err); }
  table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .table-wrap { overflow-x: auto; }
  .table-wrap table { min-width: 520px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-family: var(--mono); }
  .pill.ok { background: rgba(63,185,80,.15); color: var(--ok); }
  .pill.warn { background: rgba(210,153,34,.15); color: var(--warn); }
  .pill.err { background: rgba(248,81,73,.15); color: var(--err); }
  .pill.muted { background: var(--panel-2); color: var(--muted); }
  .kv { display: grid; grid-template-columns: 130px 1fr; gap: 8px 14px; font-size: 13px; align-items: center; }
  .kv .k { color: var(--muted); }
  .kv .v { font-family: var(--mono); word-break: break-word; }
  label.field { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
  input.text {
    width: 100%; padding: 9px 11px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px; font-size: 14px; box-sizing: border-box;
  }
  input.text:focus { outline: none; border-color: var(--accent); }
  .muted { color: var(--muted); }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .step-label { margin: 18px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--fg); }
  .step-label .num { display: inline-block; min-width: 18px; height: 18px; line-height: 18px; text-align: center; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; margin-right: 6px; }
  .snippet-block { position: relative; }
  .snippet { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-family: var(--mono); font-size: 12px; color: var(--fg); margin: 0; overflow-x: auto; white-space: pre; }
  .copy-btn { position: absolute; top: 6px; right: 6px; padding: 4px 10px; font-size: 11px; background: var(--panel-2); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; }
  .copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .copy-btn.copied { color: var(--ok); border-color: var(--ok); }
  .warnbox { color: var(--warn); font-size: 12px; margin: 8px 0 0; }
  .cmd-table { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-size: 12px; }
  .cmd-table code { font-family: var(--mono); color: var(--accent); white-space: nowrap; }
  .cmd-table span { color: var(--muted); }
  .ok-msg { color: var(--ok); font-size: 13px; }
  @media (max-width: 720px) {
    .two-col { grid-template-columns: 1fr; }
    nav.tabs { top: 60px; }
    main { padding: 16px 14px; }
  }
</style>
</head>
<body>
<header>
  <div class="left">
    <div class="avatar" id="avatar">·</div>
    <div>
      <div class="title" id="headerName">…</div>
      <div class="sub" id="headerSub"></div>
    </div>
  </div>
  <form action="/portal/logout" method="post"><button type="submit">Logout</button></form>
</header>
<nav class="tabs" id="tabs">
  <a href="#overview" class="active">Overview</a>
  <a href="#profile">Profile</a>
  <a href="#usage">Usage</a>
  <a href="#install">Install guide</a>
  <a href="#security">Security</a>
</nav>
<main>
  <!-- Overview -->
  <section id="overview" class="block">
    <h2 class="section-title">Overview</h2>
    <div class="grid">
      <div class="card credit-card">
        <h3>Your credit</h3>
        <div id="creditBig" class="credit-big">…</div>
        <div id="creditSub" class="credit-sub"></div>
        <div class="meter" id="creditMeterWrap"><span id="creditMeter"></span></div>
        <div id="creditUsed" class="muted" style="font-size:12px"></div>
      </div>
      <div class="row" id="lifetimeStats"></div>
    </div>
  </section>

  <!-- Profile -->
  <section id="profile" class="block">
    <h2 class="section-title">Profile &amp; account</h2>
    <div class="two-col">
      <div class="card">
        <h3>Personal info</h3>
        <p class="muted" style="margin:0 0 14px;font-size:12px">Optional — helps your admin recognise you. Saved to this gateway only.</p>
        <div id="profileMsg" style="display:none;margin-bottom:10px"></div>
        <label class="field" for="pfDisplay">Display name</label>
        <input class="text" id="pfDisplay" maxlength="64" placeholder="e.g. Alice Nguyen" style="margin-bottom:12px" />
        <label class="field" for="pfEmail">Email</label>
        <input class="text" id="pfEmail" maxlength="254" type="email" placeholder="you@example.com" style="margin-bottom:14px" />
        <button id="pfSave" class="primary" type="button">Save profile</button>
      </div>
      <div class="card">
        <h3>Account</h3>
        <div class="kv">
          <div class="k">Client name</div><div class="v" id="acName">—</div>
          <div class="k">Plan / limit</div><div class="v" id="acPlan">—</div>
          <div class="k">Member since</div><div class="v" id="acSince">—</div>
          <div class="k">Password set</div><div class="v" id="acPwUpdated">—</div>
        </div>
        <h3 style="margin:18px 0 8px">API token</h3>
        <p class="muted" style="margin:0 0 8px;font-size:12px">Used by your launcher and for manual setup. Keep it secret.</p>
        <div class="snippet-block">
          <pre class="snippet" id="acToken">••••••••</pre>
          <button id="acTokenReveal" type="button" class="copy-btn" style="right:74px">Reveal</button>
          <button id="acTokenCopy" type="button" class="copy-btn">Copy</button>
        </div>
      </div>
    </div>
  </section>

  <!-- Usage -->
  <section id="usage" class="block">
    <h2 class="section-title">Usage</h2>
    <div class="grid">
      <div class="card">
        <h3>By period</h3>
        <div class="table-wrap" id="periodTable"></div>
      </div>
      <div class="card">
        <h3>By model</h3>
        <div class="table-wrap" id="modelsTable"></div>
      </div>
      <div class="card">
        <h3>Recent activity</h3>
        <div class="table-wrap" id="recentTable"></div>
      </div>
    </div>
  </section>

  <!-- Install guide -->
  <section id="install" class="block">
    <h2 class="section-title">Install guide</h2>
    <div class="card">
      <p class="muted" style="margin:0 0 12px">
        Pick your platform, download your personal launcher, and follow the steps. The launcher routes
        Claude Code through this gateway using your token — nothing is written to your shell config until you opt in.
      </p>
      <div class="controls" style="margin-bottom:6px">
        <select id="dlPlatform">
          <option value="unix">macOS / Linux (bash)</option>
          <option value="windows">Windows (PowerShell)</option>
        </select>
        <select id="dlScheme">
          <option value="https">https</option>
          <option value="http">http</option>
        </select>
        <button id="dlBtn" class="primary" type="button">Download launcher</button>
        <span class="muted" style="font-size:12px">File: <code id="dlFile">cc-…</code></span>
      </div>

      <p class="step-label">Prerequisite</p>
      <p class="muted" style="margin:0 0 6px;font-size:12px">Install Claude Code first if you haven't:</p>
      <div class="snippet-block"><pre class="snippet" id="cmdPrereq">npm install -g @anthropic-ai/claude-code</pre><button class="copy-btn" data-copy="cmdPrereq" type="button">Copy</button></div>

      <p class="step-label" id="step1Label"><span class="num">1</span>Unblock the file</p>
      <p class="muted" id="step1Meta" style="margin:0 0 6px;font-size:12px"></p>
      <div class="snippet-block"><pre class="snippet" id="cmdUnblock"></pre><button class="copy-btn" data-copy="cmdUnblock" type="button">Copy</button></div>

      <p class="step-label"><span class="num">2</span>Run the launcher (quick test)</p>
      <p class="muted" id="step2Meta" style="margin:0 0 6px;font-size:12px"></p>
      <div class="snippet-block"><pre class="snippet" id="cmdRun"></pre><button class="copy-btn" data-copy="cmdRun" type="button">Copy</button></div>
      <p class="warnbox">⚠ On first run, Claude Code asks <em>"Do you want to use this custom API?"</em> — choose <strong>Yes</strong>. Picking <em>No (recommended)</em> drops the gateway env vars and falls back to the native endpoint.</p>

      <p class="step-label"><span class="num">3</span>Install system-wide as <code>ccg</code></p>
      <p class="muted" id="step3Meta" style="margin:0 0 6px;font-size:12px"></p>
      <div class="snippet-block"><pre class="snippet" id="cmdInstall"></pre><button class="copy-btn" data-copy="cmdInstall" type="button">Copy</button></div>

      <p class="step-label"><span class="num">4</span>Route <code>claude</code> through the gateway (optional)</p>
      <p class="muted" id="step4Meta" style="margin:0 0 6px;font-size:12px">Aliases the native <code>claude</code> command so every call goes through the gateway. New terminals pick it up automatically. Undo with <code>ccg release</code>.</p>
      <div class="snippet-block"><pre class="snippet" id="cmdHijack">ccg hijack</pre><button class="copy-btn" data-copy="cmdHijack" type="button">Copy</button></div>

      <p class="step-label"><span class="num">5</span>Route VS Code / Cursor extension (optional)</p>
      <p class="muted" style="margin:0 0 6px;font-size:12px">Persists gateway env vars at the user level so the Claude Code extension also uses the gateway. Restart the editor afterwards. Undo with <code>ccg release-gui</code>.</p>
      <div class="snippet-block"><pre class="snippet" id="cmdHijackGui">ccg hijack-gui</pre><button class="copy-btn" data-copy="cmdHijackGui" type="button">Copy</button></div>

      <p class="step-label">All <code>ccg</code> subcommands</p>
      <div class="cmd-table">
        <code>ccg</code><span>Start Claude Code through this gateway.</span>
        <code>ccg [claude args]</code><span>Forward any flags to Claude Code (e.g. <code>--model</code>, <code>--resume</code>).</span>
        <code>ccg --print "hi"</code><span>Single-shot non-interactive mode.</span>
        <code>ccg install</code><span>Install this launcher as the <code>ccg</code> system command.</span>
        <code>ccg uninstall</code><span>Remove <code>ccg</code> and undo any hijack.</span>
        <code>ccg hijack</code><span>Alias <code>claude</code> to <code>ccg</code> in your shell.</span>
        <code>ccg release</code><span>Remove the alias — <code>claude</code> goes back to native.</span>
        <code>ccg hijack-gui</code><span>Route the VS Code / Cursor extension through the gateway.</span>
        <code>ccg release-gui</code><span>Undo the GUI routing.</span>
        <code>ccg native [args]</code><span>Run native <code>claude</code> once, bypassing the gateway.</span>
        <code>ccg status</code><span>Show gateway URL, hijack state, and a health check.</span>
        <code>ccg help</code><span>Print this command list in the terminal.</span>
      </div>

      <p class="step-label">Manual setup (no launcher)</p>
      <p class="muted" style="margin:0 0 6px;font-size:12px">Prefer to wire it yourself? Set these environment variables before running <code>claude</code>:</p>
      <div class="snippet-block"><pre class="snippet" id="cmdManual"></pre><button class="copy-btn" data-copy="cmdManual" type="button">Copy</button></div>
    </div>
  </section>

  <!-- Security -->
  <section id="security" class="block">
    <h2 class="section-title">Security</h2>
    <div class="card" style="max-width:420px">
      <h3>Change password</h3>
      <p class="muted" style="margin:0 0 12px">Update the password you use to sign in to this portal.</p>
      <div id="pwMsg" style="display:none;margin-bottom:10px"></div>
      <div style="display:grid;gap:10px">
        <input class="text" id="pwCurrent" type="password" autocomplete="current-password" placeholder="Current password" />
        <input class="text" id="pwNew" type="password" autocomplete="new-password" placeholder="New password (min 8 chars)" />
        <input class="text" id="pwConfirm" type="password" autocomplete="new-password" placeholder="Confirm new password" />
        <div><button id="pwBtn" class="primary" type="button">Update password</button></div>
      </div>
    </div>
  </section>
</main>
<script>
(() => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const fmtNum = (n) => (n || 0).toLocaleString();
  const fmtTokens = (n) => {
    n = n || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n/1000).toFixed(1).replace(/\\.0$/,'') + 'k';
    return (n/1e6).toFixed(2).replace(/\\.00$/,'') + 'M';
  };
  const fmtCost = (n) => {
    n = n || 0;
    if (n === 0) return '$0';
    if (n < 0.01) return '$' + n.toFixed(4);
    if (n < 100) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
  };
  const shortModel = (m) => !m ? '—' : m.replace(/^claude-/, '').replace(/-\\d{8}$/, '');
  const fmtAgo = (ts) => {
    const d = Math.max(0, Date.now() - ts);
    if (d < 60000) return Math.floor(d/1000) + 's ago';
    if (d < 3600000) return Math.floor(d/60000) + 'm ago';
    if (d < 86400000) return Math.floor(d/3600000) + 'h ago';
    return Math.floor(d/86400000) + 'd ago';
  };
  const fmtDate = (ts) => !ts ? '—' : new Date(ts).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
  const periodLabel = { lifetime: 'lifetime', monthly: 'this month', daily: 'today' };

  let CLIENT = '', TOKEN = '', GATEWAY = location.host, tokenShown = false;

  const render = (d) => {
    CLIENT = d.name; TOKEN = d.token || '';
    GATEWAY = d.gateway_addr || location.host;
    const display = (d.profile && d.profile.display_name) || d.name;
    document.getElementById('headerName').textContent = display;
    document.getElementById('headerSub').textContent = '@' + d.name;
    document.getElementById('avatar').textContent = (display[0] || '?').toUpperCase();

    // Credit
    const c = d.credit;
    const big = document.getElementById('creditBig');
    const sub = document.getElementById('creditSub');
    const meterWrap = document.getElementById('creditMeterWrap');
    const meter = document.getElementById('creditMeter');
    const used = document.getElementById('creditUsed');
    if (c.limit_usd == null) {
      big.textContent = 'Unlimited';
      sub.textContent = 'No cost limit set for your account.';
      meterWrap.style.display = 'none';
      used.textContent = 'Used ' + fmtCost(c.used_usd) + ' so far.';
    } else {
      meterWrap.style.display = '';
      big.textContent = fmtCost(c.remaining_usd) + ' left';
      sub.textContent = 'of ' + fmtCost(c.limit_usd) + ' credit (' + (periodLabel[c.period] || c.period) + ')';
      const pct = c.limit_usd > 0 ? Math.min(100, (c.used_usd / c.limit_usd) * 100) : 0;
      meter.style.width = pct + '%';
      meter.className = pct >= 100 ? 'err' : pct >= 80 ? 'warn' : '';
      used.textContent = 'Used ' + fmtCost(c.used_usd) + ' of ' + fmtCost(c.limit_usd) + ' (' + pct.toFixed(0) + '%).';
    }

    // Lifetime stats
    const lt = d.lifetime;
    document.getElementById('lifetimeStats').innerHTML = [
      ['Total requests', fmtNum(lt.total)],
      ['Total cost', fmtCost(lt.costUsd)],
      ['Input tokens', fmtTokens(lt.inputTokens)],
      ['Output tokens', fmtTokens(lt.outputTokens)],
      ['Cache read', fmtTokens(lt.cacheReadTokens)],
      ['Last active', lt.lastSeen ? fmtAgo(lt.lastSeen) : '—'],
    ].map(([label, value]) => '<div class="card stat"><div class="value">' + value + '</div><div class="label">' + label + '</div></div>').join('');

    // Account
    const a = d.account || {};
    document.getElementById('acName').textContent = d.name;
    document.getElementById('acPlan').textContent = a.cost_limit_usd == null
      ? 'Unlimited'
      : fmtCost(a.cost_limit_usd) + ' / ' + (a.cost_limit_period || 'lifetime');
    document.getElementById('acSince').textContent = fmtDate(a.created_at);
    document.getElementById('acPwUpdated').textContent = fmtDate(a.password_updated_at);

    // Profile inputs
    document.getElementById('pfDisplay').value = (d.profile && d.profile.display_name) || '';
    document.getElementById('pfEmail').value = (d.profile && d.profile.email) || '';

    // Periods
    document.getElementById('periodTable').innerHTML = renderUsageTable(d.periods || []);

    // Models
    const models = d.models || [];
    document.getElementById('modelsTable').innerHTML = models.length
      ? '<table><thead><tr><th>Model</th><th class="num">Calls</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache</th><th class="num">Cost</th></tr></thead><tbody>'
        + models.map(m => '<tr><td><strong>' + esc(shortModel(m.model)) + '</strong></td>'
          + '<td class="num">' + fmtNum(m.total) + '</td>'
          + '<td class="num">' + fmtTokens(m.inputTokens) + '</td>'
          + '<td class="num">' + fmtTokens(m.outputTokens) + '</td>'
          + '<td class="num">' + fmtTokens((m.cacheReadTokens||0)+(m.cacheCreationTokens||0)) + '</td>'
          + '<td class="num"><strong>' + fmtCost(m.costUsd) + '</strong></td></tr>').join('')
        + '</tbody></table>'
      : '<p class="muted" style="margin:0">No model usage recorded yet.</p>';

    // Recent
    const recent = d.recent || [];
    document.getElementById('recentTable').innerHTML = recent.length
      ? '<table><thead><tr><th>When</th><th>Model</th><th>Status</th><th class="num">Dur</th><th class="num">In</th><th class="num">Out</th><th class="num">Cost</th><th>Message</th></tr></thead><tbody>'
        + recent.map(r => {
          const cls = r.status >= 500 ? 'err' : r.status >= 400 ? 'warn' : 'ok';
          const hasUsage = r.inputTokens || r.outputTokens;
          return '<tr><td class="muted">' + fmtAgo(r.ts) + '</td>'
            + '<td><span class="muted">' + esc(shortModel(r.model)) + '</span></td>'
            + '<td><span class="pill ' + cls + '">' + r.status + '</span></td>'
            + '<td class="num">' + r.durationMs + 'ms</td>'
            + '<td class="num">' + (hasUsage ? fmtTokens(r.inputTokens) : '—') + '</td>'
            + '<td class="num">' + (hasUsage ? fmtTokens(r.outputTokens) : '—') + '</td>'
            + '<td class="num">' + (r.costUsd ? fmtCost(r.costUsd) : '—') + '</td>'
            + '<td class="muted" title="' + esc(r.userMessage||'') + '" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (esc(r.userMessage||'') || '—') + '</td></tr>';
        }).join('')
        + '</tbody></table>'
      : '<p class="muted" style="margin:0">No requests yet.</p>';

    updateInstall();
  };

  const renderUsageTable = (periods) => {
    if (!periods.length) return '<p class="muted" style="margin:0">No usage yet.</p>';
    return '<table><thead><tr><th>Period</th><th class="num">Calls</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead><tbody>'
      + periods.map(p => '<tr><td><strong>' + esc(p.label) + '</strong></td>'
        + '<td class="num">' + fmtNum(p.total) + '</td>'
        + '<td class="num">' + fmtTokens(p.inputTokens) + '</td>'
        + '<td class="num">' + fmtTokens(p.outputTokens) + '</td>'
        + '<td class="num"><strong>' + fmtCost(p.costUsd) + '</strong></td></tr>').join('')
      + '</tbody></table>';
  };

  // ── Install guide (platform-aware) ──
  const updateInstall = () => {
    const platform = document.getElementById('dlPlatform').value;
    const scheme = document.getElementById('dlScheme').value;
    const name = CLIENT || 'client';
    const isWin = platform === 'windows';
    const fname = isWin ? 'cc-' + name + '.ps1' : 'cc-' + name;
    document.getElementById('dlFile').textContent = fname;
    const gw = scheme + '://' + GATEWAY;
    if (isWin) {
      document.getElementById('step1Label').innerHTML = '<span class="num">1</span>Allow scripts &amp; unblock the file';
      document.getElementById('step1Meta').innerHTML = 'One-time per machine: allow your user to run local scripts, then strip the Mark-of-the-Web from the download.';
      document.getElementById('cmdUnblock').textContent = 'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; Unblock-File .\\\\' + fname;
      document.getElementById('step2Meta').textContent = 'Run the launcher with PowerShell to verify the gateway connection.';
      document.getElementById('cmdRun').textContent = '.\\\\' + fname;
      document.getElementById('step3Meta').innerHTML = 'Copies the launcher into <code>%LOCALAPPDATA%\\\\ccg-bin</code> and adds it to your user PATH (open a new terminal afterwards).';
      document.getElementById('cmdInstall').textContent = '.\\\\' + fname + ' install';
      document.getElementById('cmdManual').textContent =
        '$env:ANTHROPIC_BASE_URL = "' + gw + '"\\n$env:ANTHROPIC_API_KEY = "' + (TOKEN || '<your-token>') + '"\\nclaude';
    } else {
      document.getElementById('step1Label').innerHTML = '<span class="num">1</span>macOS — if Gatekeeper blocks the file';
      document.getElementById('step1Meta').innerHTML = 'Removes the quarantine attribute browsers add to downloads. Skip on Linux, or if it runs without warning.';
      document.getElementById('cmdUnblock').textContent = 'xattr -d com.apple.quarantine ' + fname;
      document.getElementById('step2Meta').textContent = 'Make it executable and start Claude Code through the gateway.';
      document.getElementById('cmdRun').textContent = 'chmod +x ' + fname + ' && ./' + fname;
      document.getElementById('step3Meta').innerHTML = 'Copies the launcher into <code>$PATH</code> so you can run <code>ccg</code> from anywhere.';
      document.getElementById('cmdInstall').textContent = 'chmod +x ' + fname + ' && ./' + fname + ' install';
      document.getElementById('cmdManual').textContent =
        'export ANTHROPIC_BASE_URL="' + gw + '"\\nexport ANTHROPIC_API_KEY="' + (TOKEN || '<your-token>') + '"\\nclaude';
    }
  };
  document.getElementById('dlPlatform').addEventListener('change', updateInstall);
  document.getElementById('dlScheme').addEventListener('change', updateInstall);
  document.getElementById('dlScheme').value = location.protocol === 'http:' ? 'http' : 'https';

  document.getElementById('dlBtn').addEventListener('click', () => {
    const qs = new URLSearchParams({
      platform: document.getElementById('dlPlatform').value,
      scheme: document.getElementById('dlScheme').value,
    });
    window.location.href = '/portal/launcher?' + qs.toString();
  });

  // ── Token reveal / copy ──
  document.getElementById('acTokenReveal').addEventListener('click', (e) => {
    tokenShown = !tokenShown;
    document.getElementById('acToken').textContent = tokenShown ? (TOKEN || '—') : '••••••••';
    e.currentTarget.textContent = tokenShown ? 'Hide' : 'Reveal';
  });

  // ── Copy buttons (generic, via data-copy or token) ──
  const copyText = async (btn, text) => {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = 'Copied'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1500);
    } catch {}
  };
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn, document.getElementById(btn.getAttribute('data-copy')).textContent));
  });
  document.getElementById('acTokenCopy').addEventListener('click', (e) => copyText(e.currentTarget, TOKEN));

  // ── Profile save ──
  const profileMsg = (text, ok) => {
    const el = document.getElementById('profileMsg');
    el.style.display = 'block';
    el.className = ok ? 'ok-msg' : 'error';
    el.textContent = text;
  };
  document.getElementById('pfSave').addEventListener('click', async () => {
    const btn = document.getElementById('pfSave');
    btn.disabled = true;
    try {
      const res = await fetch('/portal/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: document.getElementById('pfDisplay').value,
          email: document.getElementById('pfEmail').value,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        profileMsg('Profile saved.', true);
        const display = d.display_name || CLIENT;
        document.getElementById('headerName').textContent = display;
        document.getElementById('avatar').textContent = (display[0] || '?').toUpperCase();
      } else if (res.status === 401) {
        window.location.href = '/portal';
      } else {
        const err = await res.json().catch(() => ({}));
        profileMsg(err.error || 'Save failed (' + res.status + ').', false);
      }
    } catch { profileMsg('Network error.', false); }
    finally { btn.disabled = false; }
  });

  // ── Change password ──
  const pwMsg = (text, ok) => {
    const el = document.getElementById('pwMsg');
    el.style.display = 'block';
    el.className = ok ? 'ok-msg' : 'error';
    el.textContent = text;
  };
  document.getElementById('pwBtn').addEventListener('click', async () => {
    const current = document.getElementById('pwCurrent').value;
    const next = document.getElementById('pwNew').value;
    const confirm = document.getElementById('pwConfirm').value;
    if (!current || !next) { pwMsg('Fill in both current and new password.', false); return; }
    if (next.length < 8) { pwMsg('New password must be at least 8 characters.', false); return; }
    if (next !== confirm) { pwMsg('New password and confirmation do not match.', false); return; }
    const btn = document.getElementById('pwBtn');
    btn.disabled = true;
    try {
      const res = await fetch('/portal/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, new: next }),
      });
      if (res.ok) {
        pwMsg('Password updated.', true);
        document.getElementById('pwCurrent').value = '';
        document.getElementById('pwNew').value = '';
        document.getElementById('pwConfirm').value = '';
      } else if (res.status === 401) {
        window.location.href = '/portal';
      } else {
        const err = await res.json().catch(() => ({}));
        pwMsg(err.error || 'Update failed (' + res.status + ').', false);
      }
    } catch { pwMsg('Network error.', false); }
    finally { btn.disabled = false; }
  });

  // ── Tab highlighting ──
  const tabLinks = Array.from(document.querySelectorAll('#tabs a'));
  const sections = tabLinks.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const ratios = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) ratios.set(e.target.id, e.intersectionRatio);
      let best = null, bestR = 0;
      for (const [id, r] of ratios) if (r > bestR) { bestR = r; best = id; }
      if (best) tabLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + best));
    }, { rootMargin: '-120px 0px -55% 0px', threshold: [0, 0.2, 0.6, 1] });
    sections.forEach(s => io.observe(s));
  }

  // ── Load ──
  const load = () => fetch('/portal/me', { headers: { 'Accept': 'application/json' } })
    .then(r => { if (r.status === 401) { window.location.href = '/portal'; return null; } return r.json(); })
    .then(d => { if (d) render(d); })
    .catch(() => { document.getElementById('creditBig').textContent = 'Error loading data'; });
  load();
  setInterval(load, 15000);
})();
</script>
</body>
</html>`
}
