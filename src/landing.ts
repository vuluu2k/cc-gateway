// Public product landing page served at `/`. Explains what this gateway does
// for a client (shared Claude accounts, automatic switching, privacy) and
// routes visitors to the client portal. The admin area is intentionally not
// linked here — it stays reachable directly at /admin but is not advertised.

import { i18nHead, langSwitcher, icon } from './i18n.js'
import { glassCss } from './glass.js'

export function renderLanding(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title data-i18n="landing.title">CC Gateway</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
${i18nHead()}
<style>
  :root {
    --bg: #0b0d10; --panel: #14181d; --panel-2: #1b2027; --border: #232a33;
    --fg: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --ok: #3fb950; --warn: #d29922; --err: #f85149;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; color: var(--fg); background: var(--bg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  a { color: var(--accent); text-decoration: none; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
  @media (max-width: 620px) { .wrap { padding: 0 16px; } }
  section[id] { scroll-margin-top: 64px; }

  /* Header */
  header {
    position: sticky; top: 0; z-index: 30;
    border-bottom: 1px solid var(--border);
  }
  header .bar { display: flex; align-items: center; justify-content: space-between; height: 60px; gap: 12px; }
  .brand { font-weight: 700; font-size: 16px; letter-spacing: .02em; white-space: nowrap; }
  .brand .dot { color: var(--accent); }
  .nav-links { display: flex; align-items: center; gap: 22px; }
  .nav-links a.muted-link { color: var(--muted); font-size: 14px; }
  .nav-links a.muted-link:hover { color: var(--fg); }
  select#langSel {
    background: var(--panel-2); color: var(--fg); border: 1px solid var(--border);
    border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; cursor: pointer;
  }
  select#langSel:hover { border-color: var(--accent); }
  a.btn {
    display: inline-block; cursor: pointer; padding: 9px 16px; border-radius: 8px;
    font-size: 14px; font-weight: 500; border: 1px solid var(--border);
    color: var(--fg); background: var(--panel-2); white-space: nowrap;
  }
  a.btn:hover { border-color: var(--accent); }
  a.btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  a.btn.primary:hover { background: #388bfd; border-color: #388bfd; }
  @media (max-width: 760px) { .nav-links a.muted-link { display: none; } .nav-links { gap: 10px; } }

  /* Hero */
  .hero { position: relative; overflow: hidden; border-bottom: 1px solid var(--border); }
  .hero::before {
    content: ""; position: absolute; inset: -1px 0 auto 0; height: 520px; z-index: 0;
    background: radial-gradient(680px 320px at 50% -40px, rgba(88,166,255,.18), transparent 70%);
  }
  .hero .wrap { position: relative; z-index: 1; padding-top: 72px; padding-bottom: 56px; text-align: center; }
  .eyebrow {
    display: inline-block; font-family: var(--mono); font-size: 12px; color: var(--accent);
    border: 1px solid var(--border); border-radius: 20px; padding: 5px 14px; margin-bottom: 22px; background: var(--panel);
  }
  h1.title { font-size: 46px; line-height: 1.08; letter-spacing: -.025em; margin: 0 auto 18px; max-width: 780px; text-wrap: balance; }
  h1.title .grad { font-family: var(--mono); background: linear-gradient(90deg,#58a6ff,#7ee787); -webkit-background-clip: text; background-clip: text; color: transparent; }
  p.lead { font-size: 18px; color: var(--muted); margin: 0 auto 30px; max-width: 660px; }
  .cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .cta a.btn { padding: 13px 24px; font-size: 15px; }
  .glance { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 22px; margin: 28px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 13px; }
  .glance li::before { content: "✓"; color: var(--ok); font-weight: 700; margin-right: 6px; }
  @media (max-width: 620px) { h1.title { font-size: 32px; } p.lead { font-size: 16px; } }

  /* Terminal mock */
  .terminal {
    margin: 40px auto 0; max-width: 640px; text-align: left;
    background: #0d1117; border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 24px 60px -28px rgba(0,0,0,.8); overflow: hidden;
  }
  .terminal .tbar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--border); background: var(--panel); }
  .terminal .tbar i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .terminal .tbar .r { background: #ff5f56; } .terminal .tbar .y { background: #ffbd2e; } .terminal .tbar .g { background: #27c93f; }
  .terminal .tbar span { margin-left: 8px; color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .terminal pre { margin: 0; padding: 18px; font-family: var(--mono); font-size: 13px; line-height: 1.7; color: var(--fg); overflow-x: auto; }
  .terminal .c { color: var(--muted); } .terminal .p { color: var(--ok); } .terminal .k { color: var(--accent); } .terminal .w { color: var(--warn); }

  /* Sections */
  section.sec { padding: 64px 0; border-bottom: 1px solid var(--border); }
  .sec h2 { font-size: 28px; letter-spacing: -.02em; margin: 0 0 8px; text-align: center; text-wrap: balance; }
  .sec .sublead { color: var(--muted); text-align: center; margin: 0 auto 40px; max-width: 580px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 22px; }

  /* Request flow: three nodes joined by arrows; stacks vertically on phones. */
  .flow { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: stretch; gap: 12px; }
  .flow .node h3 { margin: 0 0 6px; font-size: 15px; display: flex; align-items: center; gap: 8px; }
  .flow .node h3 svg { color: var(--accent); flex-shrink: 0; }
  .flow .node.gw { border-color: rgba(88,166,255,.45); }
  .flow .node p { margin: 0; color: var(--muted); font-size: 13px; }
  .flow .arrow { align-self: center; color: var(--muted); font-size: 22px; font-family: var(--mono); }
  @media (max-width: 820px) {
    .flow { grid-template-columns: 1fr; }
    .flow .arrow { justify-self: center; transform: rotate(90deg); line-height: 1; }
  }

  /* Account priority illustration */
  .route { display: grid; grid-template-columns: 1fr 1.1fr; gap: 40px; align-items: center; margin-top: 56px; }
  .route h3 { font-size: 20px; margin: 0 0 8px; }
  .route p { color: var(--muted); margin: 0 0 12px; font-size: 14px; }
  .route .note { font-size: 13px; border-left: 2px solid var(--warn); padding-left: 12px; }
  .acct { display: grid; grid-template-columns: 22px 64px 1fr auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .acct:last-child { border-bottom: 0; }
  .acct .n { color: var(--muted); font-family: var(--mono); }
  .acct code { font-family: var(--mono); }
  .acct .bar { height: 8px; background: var(--panel-2); border-radius: 5px; overflow: hidden; }
  .acct .bar > span { display: block; height: 100%; }
  .acct .st { font-size: 12px; white-space: nowrap; }
  .acct.over .bar > span { width: 100%; background: var(--err); } .acct.over .st { color: var(--err); } .acct.over code { opacity: .55; text-decoration: line-through; }
  .acct.use .bar > span { width: 40%; background: var(--ok); } .acct.use .st { color: var(--ok); font-weight: 600; }
  .acct.idle .bar > span { width: 0; } .acct.idle .st { color: var(--muted); }
  @media (max-width: 820px) { .route { grid-template-columns: 1fr; gap: 24px; } }
  @media (max-width: 420px) { .acct { grid-template-columns: 18px 52px 1fr; } .acct .st { grid-column: 2 / -1; } }

  .steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; }
  .step .n { width: 30px; height: 30px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--border); color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 700; font-family: var(--mono); margin-bottom: 14px; }
  .step h3 { margin: 0 0 6px; font-size: 15px; }
  .step p { margin: 0; color: var(--muted); font-size: 13px; }

  .features { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; }
  .feature { transition: border-color .15s, transform .15s; }
  .feature:hover { border-color: #2f3a47; transform: translateY(-2px); }
  .feature .ico { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px;
    background: linear-gradient(135deg, rgba(88,166,255,.18), rgba(126,231,135,.12)); border: 1px solid var(--border); color: var(--accent); }
  .feature .ico svg { width: 22px; height: 22px; }
  .feature h3 { margin: 0 0 8px; font-size: 15px; }
  .feature p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
  @media (max-width: 820px) { .steps, .features { grid-template-columns: 1fr; } }

  /* Portal preview list */
  .portal-row { display: grid; grid-template-columns: 1.1fr 1fr; gap: 40px; align-items: center; }
  .portal-row ul { list-style: none; margin: 0; padding: 0; }
  .portal-row li { padding: 10px 0 10px 30px; position: relative; color: var(--fg); border-bottom: 1px solid var(--border); }
  .portal-row li:last-child { border-bottom: 0; }
  .portal-row li::before { content: "✓"; position: absolute; left: 0; top: 10px; color: var(--ok); font-weight: 700; }
  .portal-row li span { color: var(--muted); display: block; font-size: 13px; }
  .portal-card { padding: 26px; }
  .portal-card .big { font-family: var(--mono); font-size: 34px; font-weight: 700; }
  .portal-card .meter { height: 10px; background: var(--panel-2); border-radius: 6px; overflow: hidden; margin: 14px 0 6px; }
  .portal-card .meter > span { display: block; height: 100%; width: 62%; background: var(--ok); }
  .portal-card .muted { color: var(--muted); font-size: 12px; }
  .portal-card .mini { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
  .portal-card .mini > div { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .portal-card .mini b { display: block; font-family: var(--mono); font-size: 18px; }
  @media (max-width: 820px) { .portal-row { grid-template-columns: 1fr; gap: 24px; } }

  /* FAQ */
  .faq { max-width: 760px; margin: 0 auto; }
  .faq details { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 4px 16px; margin-bottom: 10px; }
  .faq summary { cursor: pointer; padding: 14px 0; font-weight: 500; list-style: none; }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: "+"; float: right; color: var(--muted); }
  .faq details[open] summary::after { content: "−"; }
  .faq details p { margin: 0 0 14px; color: var(--muted); font-size: 14px; }

  /* CTA band + footer */
  .band { text-align: center; padding: 64px 0; }
  .band h2 { font-size: 26px; margin: 0 0 10px; }
  .band p { color: var(--muted); margin: 0 0 24px; }
  footer { padding: 28px 0; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); }
  footer .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  ${glassCss('.card, .faq details, .terminal')}
  header { background: rgba(11,13,16,.55); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
  .terminal { background: rgba(13,17,23,.7); }
  .portal-card { background: linear-gradient(135deg, rgba(31,111,235,.12), rgba(137,87,229,.10)), var(--panel); }
</style>
</head>
<body>
  <header>
    <div class="wrap bar">
      <div class="brand">CC <span class="dot">Gateway</span></div>
      <nav class="nav-links">
        <a class="muted-link" href="#how" data-i18n="nav.how">How it works</a>
        <a class="muted-link" href="#features" data-i18n="nav.features">Features</a>
        <a class="muted-link" href="#start" data-i18n="nav.start">Get started</a>
        <a class="muted-link" href="#faq" data-i18n="nav.faq">FAQ</a>
        ${langSwitcher()}
        <a class="btn primary" href="/portal" data-i18n="common.clientPortal">Client Portal</a>
      </nav>
    </div>
  </header>

  <div class="hero">
    <div class="wrap">
      <span class="eyebrow" data-i18n="hero.eyebrow">Self-hosted gateway for Claude Code</span>
      <h1 class="title" data-i18n-html="hero.title">Many Claude accounts. One <span class="grad">ccg</span> command for the whole team.</h1>
      <p class="lead" data-i18n="hero.lead"></p>
      <div class="cta">
        <a class="btn primary" href="/portal" data-i18n="common.openPortal">Open client portal →</a>
        <a class="btn" href="#how" data-i18n="hero.ctaSecondary">See how it works</a>
      </div>
      <ul class="glance">
        <li data-i18n="glance.1"></li>
        <li data-i18n="glance.2"></li>
        <li data-i18n="glance.3"></li>
        <li data-i18n="glance.4"></li>
      </ul>

      <div class="terminal">
        <div class="tbar"><i class="r"></i><i class="y"></i><i class="g"></i><span>zsh — claude code</span></div>
<pre><span class="c"># install your personal launcher once</span>
<span class="p">$</span> ./cc-alice <span class="k">install</span>
<span class="c">Installed as 'ccg'. Run: ccg</span>

<span class="p">$</span> <span class="k">ccg</span> <span class="c"># Claude Code, routed through the gateway</span>
<span class="c">Gateway:  https://ccg.example.com   Health: OK</span>
<span class="w">✻</span> Welcome to Claude Code
</pre>
      </div>
    </div>
  </div>

  <section id="how" class="sec">
    <div class="wrap">
      <h2 data-i18n="how.title">What happens to each request</h2>
      <p class="sublead" data-i18n="how.sub"></p>
      <div class="flow">
        <div class="card node"><h3>${icon('terminal', 18)}<span data-i18n="flow.you.t"></span></h3><p data-i18n="flow.you.d"></p></div>
        <div class="arrow" aria-hidden="true">→</div>
        <div class="card node gw"><h3>${icon('shuffle', 18)}<span data-i18n="flow.gw.t"></span></h3><p data-i18n="flow.gw.d"></p></div>
        <div class="arrow" aria-hidden="true">→</div>
        <div class="card node"><h3>${icon('globe', 18)}<span data-i18n="flow.api.t"></span></h3><p data-i18n="flow.api.d"></p></div>
      </div>

      <div class="route">
        <div>
          <h3 data-i18n="route.title">Your accounts, in priority order</h3>
          <p data-i18n="route.sub"></p>
          <p class="note" data-i18n="route.note"></p>
        </div>
        <div class="card" role="img" aria-label="pro-1 limit reached, pro-2 in use, pro-3 standby">
          <div class="acct over"><span class="n">1</span><code>pro-1</code><div class="bar"><span></span></div><span class="st" data-i18n="route.over"></span></div>
          <div class="acct use"><span class="n">2</span><code>pro-2</code><div class="bar"><span></span></div><span class="st">← <span data-i18n="route.inUse"></span></span></div>
          <div class="acct idle"><span class="n">3</span><code>pro-3</code><div class="bar"><span></span></div><span class="st" data-i18n="route.standby"></span></div>
        </div>
      </div>
    </div>
  </section>

  <section id="features" class="sec">
    <div class="wrap">
      <h2 data-i18n="features.title">Built for teams sharing Claude</h2>
      <p class="sublead" data-i18n="features.sub"></p>
      <div class="features">
        <div class="card feature"><div class="ico">${icon('shuffle')}</div><h3 data-i18n="feat.switch.t"></h3><p data-i18n="feat.switch.d"></p></div>
        <div class="card feature"><div class="ico">${icon('credit-card')}</div><h3 data-i18n="feat.credit.t"></h3><p data-i18n="feat.credit.d"></p></div>
        <div class="card feature"><div class="ico">${icon('user-check')}</div><h3 data-i18n="feat.identity.t"></h3><p data-i18n="feat.identity.d"></p></div>
        <div class="card feature"><div class="ico">${icon('download')}</div><h3 data-i18n="feat.install.t"></h3><p data-i18n="feat.install.d"></p></div>
        <div class="card feature"><div class="ico">${icon('bar-chart')}</div><h3 data-i18n="feat.usage.t"></h3><p data-i18n="feat.usage.d"></p></div>
        <div class="card feature"><div class="ico">${icon('server')}</div><h3 data-i18n="feat.selfhost.t"></h3><p data-i18n="feat.selfhost.d"></p></div>
      </div>
    </div>
  </section>

  <section id="start" class="sec">
    <div class="wrap">
      <h2 data-i18n="start.title">Up and running in three steps</h2>
      <p class="sublead" data-i18n="start.sub"></p>
      <div class="steps">
        <div class="card step"><div class="n">1</div><h3 data-i18n="start.s1.t"></h3><p data-i18n="start.s1.d"></p></div>
        <div class="card step"><div class="n">2</div><h3 data-i18n="start.s2.t"></h3><p data-i18n="start.s2.d"></p></div>
        <div class="card step"><div class="n">3</div><h3 data-i18n="start.s3.t"></h3><p data-i18n="start.s3.d"></p></div>
      </div>
    </div>
  </section>

  <section class="sec">
    <div class="wrap portal-row">
      <div>
        <h2 style="text-align:left" data-i18n="inside.title">Inside your portal</h2>
        <ul>
          <li data-i18n="inside.i1.t">Live credit balance<span data-i18n="inside.i1.d"></span></li>
          <li data-i18n="inside.i2.t">Personal profile<span data-i18n="inside.i2.d"></span></li>
          <li data-i18n="inside.i3.t">Usage by model<span data-i18n="inside.i3.d"></span></li>
          <li data-i18n="inside.i4.t">Detailed install guide<span data-i18n="inside.i4.d"></span></li>
          <li data-i18n="inside.i5.t">Password &amp; token<span data-i18n="inside.i5.d"></span></li>
        </ul>
      </div>
      <div class="card portal-card">
        <div class="muted" data-i18n="inside.creditMonth">Your credit · this month</div>
        <div class="big">$12.25 <span style="font-size:16px;color:var(--muted)" data-i18n="inside.left">left</span></div>
        <div class="meter"><span></span></div>
        <div class="muted" data-i18n="inside.usedOf">Used $7.75 of $20.00 (39%)</div>
        <div class="mini">
          <div><b>128</b><span class="muted" data-i18n="inside.requests">requests</span></div>
          <div><b>2.6M</b><span class="muted" data-i18n="inside.tokens">tokens</span></div>
        </div>
      </div>
    </div>
  </section>

  <section id="faq" class="sec">
    <div class="wrap faq">
      <h2 data-i18n="faq.title">Frequently asked</h2>
      <p class="sublead" data-i18n="faq.sub"></p>
      <details open><summary data-i18n="faq.q1"></summary><p data-i18n="faq.a1"></p></details>
      <details><summary data-i18n="faq.q2"></summary><p data-i18n="faq.a2"></p></details>
      <details><summary data-i18n="faq.q3"></summary><p data-i18n="faq.a3"></p></details>
      <details><summary data-i18n="faq.q4"></summary><p data-i18n="faq.a4"></p></details>
      <details><summary data-i18n="faq.q5"></summary><p data-i18n="faq.a5"></p></details>
      <details><summary data-i18n="faq.q6"></summary><p data-i18n="faq.a6"></p></details>
    </div>
  </section>

  <div class="band">
    <div class="wrap">
      <h2 data-i18n="band.title">Ready to start?</h2>
      <p data-i18n="band.p"></p>
      <a class="btn primary" href="/portal" data-i18n="common.openPortal">Open client portal →</a>
    </div>
  </div>

  <footer>
    <div class="wrap row">
      <div class="brand">CC <span class="dot">Gateway</span></div>
      <div data-i18n="footer.tagline">Self-hosted · several Claude accounts behind one gateway</div>
    </div>
  </footer>
</body>
</html>`
}
