// Public product landing page served at `/`. Introduces the gateway and routes
// visitors to the client portal. The admin area is intentionally not linked here
// — it stays reachable directly at /admin but is not advertised to clients.

export function renderLanding(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CC Gateway — one gateway for your team's Claude Code</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg: #0b0d10; --panel: #14181d; --panel-2: #1b2027; --border: #232a33;
    --fg: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --ok: #3fb950; --warn: #d29922;
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

  /* Header */
  header {
    position: sticky; top: 0; z-index: 30;
    backdrop-filter: blur(10px); background: rgba(11,13,16,.72);
    border-bottom: 1px solid var(--border);
  }
  header .bar { display: flex; align-items: center; justify-content: space-between; height: 60px; }
  .brand { font-weight: 700; font-size: 16px; letter-spacing: .02em; }
  .brand .dot { color: var(--accent); }
  .nav-links { display: flex; align-items: center; gap: 22px; }
  .nav-links a.muted-link { color: var(--muted); font-size: 14px; }
  .nav-links a.muted-link:hover { color: var(--fg); }
  a.btn {
    display: inline-block; cursor: pointer; padding: 9px 16px; border-radius: 8px;
    font-size: 14px; font-weight: 500; border: 1px solid var(--border);
    color: var(--fg); background: var(--panel-2);
  }
  a.btn:hover { border-color: var(--accent); }
  a.btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  a.btn.primary:hover { background: #388bfd; border-color: #388bfd; }
  @media (max-width: 620px) { .nav-links a.muted-link { display: none; } }

  /* Hero */
  .hero { position: relative; overflow: hidden; border-bottom: 1px solid var(--border); }
  .hero::before {
    content: ""; position: absolute; inset: -1px 0 auto 0; height: 520px; z-index: 0;
    background: radial-gradient(680px 320px at 50% -40px, rgba(88,166,255,.18), transparent 70%);
  }
  .hero .wrap { position: relative; z-index: 1; padding-top: 72px; padding-bottom: 64px; text-align: center; }
  .eyebrow {
    display: inline-block; font-family: var(--mono); font-size: 12px; color: var(--accent);
    border: 1px solid var(--border); border-radius: 20px; padding: 5px 14px; margin-bottom: 22px; background: var(--panel);
  }
  h1.title { font-size: 46px; line-height: 1.08; letter-spacing: -.025em; margin: 0 auto 18px; max-width: 760px; }
  h1.title .grad { background: linear-gradient(90deg,#58a6ff,#7ee787); -webkit-background-clip: text; background-clip: text; color: transparent; }
  p.lead { font-size: 18px; color: var(--muted); margin: 0 auto 30px; max-width: 620px; }
  .cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .cta a.btn { padding: 13px 24px; font-size: 15px; }
  @media (max-width: 620px) { h1.title { font-size: 32px; } p.lead { font-size: 16px; } }

  /* Terminal mock */
  .terminal {
    margin: 48px auto 0; max-width: 640px; text-align: left;
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
  .sec h2 { font-size: 28px; letter-spacing: -.02em; margin: 0 0 8px; text-align: center; }
  .sec .sublead { color: var(--muted); text-align: center; margin: 0 auto 40px; max-width: 560px; }

  .steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; }
  .step { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 22px; }
  .step .n { width: 30px; height: 30px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--border); color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 700; font-family: var(--mono); margin-bottom: 14px; }
  .step h3 { margin: 0 0 6px; font-size: 15px; }
  .step p { margin: 0; color: var(--muted); font-size: 13px; }

  .features { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; }
  .feature { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 22px; transition: border-color .15s, transform .15s; }
  .feature:hover { border-color: #2f3a47; transform: translateY(-2px); }
  .feature .ico { font-size: 20px; margin-bottom: 12px; }
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
  .portal-card { background: linear-gradient(135deg,#11161d,#1a2230); border: 1px solid var(--border); border-radius: 14px; padding: 26px; }
  .portal-card .big { font-family: var(--mono); font-size: 34px; font-weight: 700; }
  .portal-card .meter { height: 10px; background: var(--panel-2); border-radius: 6px; overflow: hidden; margin: 14px 0 6px; }
  .portal-card .meter > span { display: block; height: 100%; width: 62%; background: var(--ok); }
  .portal-card .muted { color: var(--muted); font-size: 12px; }
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
  footer { padding: 28px 0; color: var(--muted); font-size: 13px; }
  footer .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
</style>
</head>
<body>
  <header>
    <div class="wrap bar">
      <div class="brand">CC <span class="dot">Gateway</span></div>
      <nav class="nav-links">
        <a class="muted-link" href="#how">How it works</a>
        <a class="muted-link" href="#features">Features</a>
        <a class="muted-link" href="#faq">FAQ</a>
        <a class="btn primary" href="/portal">Client Portal</a>
      </nav>
    </div>
  </header>

  <div class="hero">
    <div class="wrap">
      <span class="eyebrow">Privacy-preserving AI API gateway</span>
      <h1 class="title">One gateway for your whole team's <span class="grad">Claude Code</span>.</h1>
      <p class="lead">
        Route every client through a single managed identity, enforce a credit
        budget per person, and hand each user a self-service portal to install,
        configure, and track their own usage — no shared secrets, no manual setup.
      </p>
      <div class="cta">
        <a class="btn primary" href="/portal">Open client portal →</a>
        <a class="btn" href="#how">See how it works</a>
      </div>

      <div class="terminal">
        <div class="tbar"><i class="r"></i><i class="y"></i><i class="g"></i><span>zsh — claude code</span></div>
<pre><span class="c"># install your personal launcher once</span>
<span class="p">$</span> ./cc-alice <span class="k">install</span>
<span class="c">Installed as 'ccg'. Run: ccg</span>

<span class="p">$</span> <span class="k">ccg</span> <span class="c"># Claude Code, routed through the gateway</span>
<span class="c">Gateway:  https://ccg.example.com   Health: OK</span>
<span class="w">✻</span> Welcome back, alice — $12.25 of $20.00 credit left
</pre>
      </div>
    </div>
  </div>

  <section id="how" class="sec">
    <div class="wrap">
      <h2>Up and running in three steps</h2>
      <p class="sublead">Your admin creates your account; you take it from there.</p>
      <div class="steps">
        <div class="step">
          <div class="n">1</div>
          <h3>Sign in</h3>
          <p>Open the client portal and log in with the name and password your admin gave you.</p>
        </div>
        <div class="step">
          <div class="n">2</div>
          <h3>Download your launcher</h3>
          <p>Grab your personal installer for macOS, Linux, or Windows — your token is baked in.</p>
        </div>
        <div class="step">
          <div class="n">3</div>
          <h3>Run Claude Code</h3>
          <p>One command and you're working — every request flows through the gateway with your credit tracked.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="features" class="sec">
    <div class="wrap">
      <h2>Everything your team needs</h2>
      <p class="sublead">Built for small teams who share one Claude plan without sharing credentials.</p>
      <div class="features">
        <div class="feature"><div class="ico">🔐</div><h3>Your own login</h3><p>Sign in with a personal password — change it any time. Your API token stays scoped to you.</p></div>
        <div class="feature"><div class="ico">💳</div><h3>Credit you can see</h3><p>Watch exactly how much credit you've used and what's left, by day, month, or lifetime.</p></div>
        <div class="feature"><div class="ico">⤓</div><h3>One-click install</h3><p>Download a ready-to-run launcher and follow a detailed, platform-specific guide.</p></div>
        <div class="feature"><div class="ico">📊</div><h3>Usage insights</h3><p>Break down your spend by model and review your recent requests in one place.</p></div>
        <div class="feature"><div class="ico">🪪</div><h3>Centralized identity</h3><p>All traffic appears as one canonical device; OAuth lifecycle is managed for you.</p></div>
        <div class="feature"><div class="ico">⚡</div><h3>Drop-in for Claude Code</h3><p>Works with the CLI and the VS Code / Cursor extension — hijack or release any time.</p></div>
      </div>
    </div>
  </section>

  <section class="sec">
    <div class="wrap portal-row">
      <div>
        <h2 style="text-align:left">Inside your portal</h2>
        <ul>
          <li>Live credit balance<span>Used vs. remaining for your billing window.</span></li>
          <li>Personal profile<span>Set a display name and email so your admin knows who's who.</span></li>
          <li>Usage by model &amp; recent activity<span>See where your spend goes and your latest requests.</span></li>
          <li>Detailed install guide<span>Step-by-step for macOS, Linux, and Windows — plus manual setup.</span></li>
          <li>Password &amp; token management<span>Rotate your password and copy your API token securely.</span></li>
        </ul>
      </div>
      <div class="portal-card">
        <div class="muted">Your credit · this month</div>
        <div class="big">$12.25 <span style="font-size:16px;color:var(--muted)">left</span></div>
        <div class="meter"><span></span></div>
        <div class="muted">Used $7.75 of $20.00 (39%)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">
          <div style="background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px"><div style="font-family:var(--mono);font-size:18px;font-weight:700">128</div><div class="muted">requests</div></div>
          <div style="background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px"><div style="font-family:var(--mono);font-size:18px;font-weight:700">2.6M</div><div class="muted">tokens</div></div>
        </div>
      </div>
    </div>
  </section>

  <section id="faq" class="sec">
    <div class="wrap faq">
      <h2>Frequently asked</h2>
      <p class="sublead">Quick answers before you sign in.</p>
      <details open><summary>How do I get an account?</summary><p>Your team's admin creates a client for you and shares your client name and a one-time password. Sign in at the portal and change the password on first login.</p></details>
      <details><summary>Which platforms are supported?</summary><p>macOS, Linux (bash launcher) and Windows (PowerShell launcher). The Claude Code CLI and the VS Code / Cursor extension are both supported.</p></details>
      <details><summary>What is "credit"?</summary><p>An optional cost budget your admin sets per client — by day, month, or lifetime. The portal shows what you've used and what remains; the gateway enforces it automatically.</p></details>
      <details><summary>Is my token safe?</summary><p>Your token only authenticates you to the gateway. It's never shared between clients, it's scoped to your account, and you can view or copy it from your portal at any time.</p></details>
    </div>
  </section>

  <div class="band">
    <div class="wrap">
      <h2>Ready to start?</h2>
      <p>Sign in to your portal to install Claude Code and track your credit.</p>
      <a class="btn primary" href="/portal">Open client portal →</a>
    </div>
  </div>

  <footer>
    <div class="wrap row">
      <div class="brand">CC <span class="dot">Gateway</span></div>
      <div>Self-hosted · privacy-preserving proxy for Claude Code</div>
    </div>
  </footer>
</body>
</html>`
}
