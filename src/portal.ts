// Client self-service portal — a minimal, single-client view rendered for
// holders of a client token. Lets a client see the credit (cost limit) they've
// been granted, how much they've used, and download their personal launcher.
// Styling mirrors the admin dashboard's dark theme but is intentionally lean.

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
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .box { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 32px; width: 380px; max-width: 90vw; }
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
</style>
</head>
<body>
  <form class="box" method="post" action="/portal/login">
    <h1>Client Portal</h1>
    <p class="sub">Sign in with the client name and password your admin gave you.</p>
    ${errBlock}
    <label for="name">Client name</label>
    <input id="name" name="name" autocomplete="username" autofocus required placeholder="e.g. alice" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="your password" />
    <button type="submit" class="primary">Sign in</button>
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
    background: var(--panel); position: sticky; top: 0; z-index: 10;
  }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .who { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  main { padding: 20px 24px; max-width: 960px; margin: 0 auto; }
  .grid { display: grid; gap: 16px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h2 { margin: 0 0 12px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .stat .value { font-size: 24px; font-weight: 600; font-family: var(--mono); }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; margin-top: 4px; letter-spacing: .03em; }
  .credit-big { font-size: 34px; font-weight: 700; font-family: var(--mono); }
  .credit-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .meter { height: 10px; background: var(--panel-2); border-radius: 6px; overflow: hidden; margin: 14px 0 6px; }
  .meter > span { display: block; height: 100%; background: var(--ok); width: 0; transition: width .3s; }
  .meter > span.warn { background: var(--warn); }
  .meter > span.err { background: var(--err); }
  table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-family: var(--mono); background: var(--panel-2); color: var(--muted); }
  .step-label { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--fg); }
  .step-label .num { display: inline-block; min-width: 18px; height: 18px; line-height: 18px; text-align: center; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; margin-right: 6px; }
  .snippet { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-family: var(--mono); font-size: 12px; color: var(--fg); margin: 0; overflow-x: auto; white-space: pre; }
  .muted { color: var(--muted); }
  .warnbox { color: var(--warn); font-size: 12px; margin: 8px 0 0; }
  @media (max-width: 600px) {
    main { padding: 14px; }
    header { padding: 12px 14px; }
  }
</style>
</head>
<body>
<header>
  <h1>Client Portal · <span id="clientName" class="who">…</span></h1>
  <form action="/portal/logout" method="post"><button type="submit">Logout</button></form>
</header>
<main>
  <div class="grid">
    <section class="card">
      <h2>Your credit</h2>
      <div id="creditBig" class="credit-big">…</div>
      <div id="creditSub" class="credit-sub"></div>
      <div class="meter"><span id="creditMeter"></span></div>
      <div id="creditUsed" class="muted" style="font-size:12px"></div>
    </section>

    <div class="row" id="lifetimeStats"></div>

    <section class="card">
      <h2>Usage by period</h2>
      <div id="periodTable"></div>
    </section>

    <section class="card">
      <h2>Download your launcher</h2>
      <p class="muted" style="margin:0 0 12px">
        Pick your platform and download a personal launcher that routes Claude Code through this gateway using your token.
      </p>
      <div class="controls">
        <select id="dlPlatform">
          <option value="unix">macOS / Linux (bash)</option>
          <option value="windows">Windows (PowerShell)</option>
        </select>
        <select id="dlScheme">
          <option value="https">https</option>
          <option value="http">http</option>
        </select>
        <button id="dlBtn" class="primary" type="button">Download launcher</button>
      </div>

      <p class="step-label"><span class="num">1</span>macOS — if Gatekeeper blocks the file</p>
      <pre class="snippet" id="cmdUnblock"></pre>
      <p class="step-label"><span class="num">2</span>Run the launcher</p>
      <pre class="snippet" id="cmdRun"></pre>
      <p class="warnbox">⚠ On first run, Claude Code asks "Do you want to use this custom API?" — choose <strong>Yes</strong>. Picking <em>No (recommended)</em> drops the gateway env vars.</p>
      <p class="step-label"><span class="num">3</span>Install system-wide as <code>ccg</code></p>
      <pre class="snippet" id="cmdInstall"></pre>
      <p class="muted" style="font-size:12px;margin-top:12px">
        Prerequisite: Claude Code installed (<code>npm install -g @anthropic-ai/claude-code</code>).
      </p>
    </section>

    <section class="card">
      <h2>Change password</h2>
      <p class="muted" style="margin:0 0 12px">Update the password you use to sign in to this portal.</p>
      <div id="pwMsg" style="display:none;margin-bottom:10px"></div>
      <div style="display:grid;gap:10px;max-width:360px">
        <input id="pwCurrent" type="password" autocomplete="current-password" placeholder="Current password"
          style="padding:9px 11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px;font-size:14px" />
        <input id="pwNew" type="password" autocomplete="new-password" placeholder="New password (min 8 chars)"
          style="padding:9px 11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px;font-size:14px" />
        <input id="pwConfirm" type="password" autocomplete="new-password" placeholder="Confirm new password"
          style="padding:9px 11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px;font-size:14px" />
        <div><button id="pwBtn" class="primary" type="button">Update password</button></div>
      </div>
    </section>
  </div>
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
  const periodLabel = { lifetime: 'lifetime', monthly: 'this month', daily: 'today' };

  let CLIENT = '';

  const render = (d) => {
    CLIENT = d.name;
    document.getElementById('clientName').textContent = d.name;

    // Credit
    const c = d.credit;
    const big = document.getElementById('creditBig');
    const sub = document.getElementById('creditSub');
    const meter = document.getElementById('creditMeter');
    const used = document.getElementById('creditUsed');
    if (c.limit_usd == null) {
      big.textContent = 'Unlimited';
      sub.textContent = 'No cost limit set for your account.';
      meter.parentElement.style.display = 'none';
      used.textContent = 'Used ' + fmtCost(c.used_usd) + ' so far.';
    } else {
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
    ].map(([label, value]) => \`
      <div class="card stat">
        <div class="value">\${value}</div>
        <div class="label">\${label}</div>
      </div>\`).join('');

    // Periods
    const rows = (d.periods || []).map(p => \`<tr>
      <td><strong>\${esc(p.label)}</strong></td>
      <td class="num">\${fmtNum(p.total)}</td>
      <td class="num">\${fmtTokens(p.inputTokens)}</td>
      <td class="num">\${fmtTokens(p.outputTokens)}</td>
      <td class="num"><strong>\${fmtCost(p.costUsd)}</strong></td>
    </tr>\`).join('');
    document.getElementById('periodTable').innerHTML = \`
      <table>
        <thead><tr><th>Period</th><th class="num">Calls</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>\`;

    updateCmds();
  };

  const updateCmds = () => {
    const platform = document.getElementById('dlPlatform').value;
    const name = CLIENT || 'client';
    if (platform === 'windows') {
      const f = 'cc-' + name + '.ps1';
      document.getElementById('cmdUnblock').textContent = '# Windows: no quarantine step needed';
      document.getElementById('cmdRun').textContent = 'powershell -ExecutionPolicy Bypass -File .\\\\' + f;
      document.getElementById('cmdInstall').textContent = '.\\\\' + f + ' install';
    } else {
      const f = 'cc-' + name;
      document.getElementById('cmdUnblock').textContent = 'xattr -d com.apple.quarantine ' + f + '   # macOS only, if blocked';
      document.getElementById('cmdRun').textContent = 'chmod +x ' + f + ' && ./' + f;
      document.getElementById('cmdInstall').textContent = './' + f + ' install';
    }
  };

  document.getElementById('dlPlatform').addEventListener('change', updateCmds);

  document.getElementById('dlBtn').addEventListener('click', () => {
    const platform = document.getElementById('dlPlatform').value;
    const scheme = document.getElementById('dlScheme').value;
    const qs = new URLSearchParams({ platform, scheme });
    window.location.href = '/portal/launcher?' + qs.toString();
  });

  // Change password
  const pwMsg = (text, ok) => {
    const el = document.getElementById('pwMsg');
    el.style.display = 'block';
    el.className = ok ? '' : 'error';
    el.style.color = ok ? 'var(--ok)' : '';
    el.style.fontSize = '13px';
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    } catch {
      pwMsg('Network error.', false);
    } finally {
      btn.disabled = false;
    }
  });

  fetch('/portal/me', { headers: { 'Accept': 'application/json' } })
    .then(r => {
      if (r.status === 401) { window.location.href = '/portal'; return null; }
      return r.json();
    })
    .then(d => { if (d) render(d); })
    .catch(() => {
      document.getElementById('creditBig').textContent = 'Error loading data';
    });

  // Default the scheme selector to the page's protocol.
  document.getElementById('dlScheme').value = location.protocol === 'http:' ? 'http' : 'https';
})();
</script>
</body>
</html>`
}
