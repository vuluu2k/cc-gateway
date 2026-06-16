// Public product landing page served at `/`. Introduces the gateway and routes
// visitors to the client portal. The admin area is intentionally not linked here
// — it stays reachable directly at /admin but is not advertised to clients.

export function renderLanding(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CC Gateway</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg: #0b0d10; --panel: #14181d; --panel-2: #1b2027; --border: #232a33;
    --fg: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --ok: #3fb950;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: radial-gradient(1200px 600px at 50% -10%, #161b22 0%, var(--bg) 60%);
    color: var(--fg); min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 28px; border-bottom: 1px solid var(--border);
  }
  header .brand { font-weight: 700; font-size: 16px; letter-spacing: .02em; }
  header .brand .dot { color: var(--accent); }
  header nav { display: flex; gap: 10px; }
  a.btn {
    display: inline-block; text-decoration: none; cursor: pointer;
    padding: 9px 16px; border-radius: 8px; font-size: 14px; font-weight: 500;
    border: 1px solid var(--border); color: var(--fg); background: var(--panel-2);
  }
  a.btn:hover { border-color: var(--accent); }
  a.btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  a.btn.primary:hover { background: #388bfd; border-color: #388bfd; }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
  .hero { max-width: 760px; text-align: center; }
  .hero .eyebrow {
    display: inline-block; font-family: var(--mono); font-size: 12px; color: var(--accent);
    border: 1px solid var(--border); border-radius: 20px; padding: 4px 12px; margin-bottom: 22px;
    background: var(--panel);
  }
  .hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 16px; letter-spacing: -.02em; }
  .hero p.lead { font-size: 17px; color: var(--muted); line-height: 1.6; margin: 0 auto 30px; max-width: 600px; }
  .cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 48px; }
  .cta a.btn { padding: 12px 22px; font-size: 15px; }
  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: left; }
  .feature {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px;
  }
  .feature h3 { margin: 0 0 8px; font-size: 14px; }
  .feature p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.55; }
  footer { text-align: center; padding: 20px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); }
  @media (max-width: 700px) {
    .hero h1 { font-size: 30px; }
    .features { grid-template-columns: 1fr; }
    header { padding: 14px 16px; }
  }
</style>
</head>
<body>
  <header>
    <div class="brand">CC <span class="dot">Gateway</span></div>
    <nav>
      <a class="btn primary" href="/portal">Client Portal</a>
    </nav>
  </header>
  <main>
    <div class="hero">
      <span class="eyebrow">Privacy-preserving AI API gateway</span>
      <h1>One gateway for your whole team's Claude Code.</h1>
      <p class="lead">
        Route every client through a single managed identity, track usage and cost
        per client, and give each person a self-service portal to grab their launcher
        and watch their credit — no shared secrets, no manual setup.
      </p>
      <div class="cta">
        <a class="btn primary" href="/portal">Open client portal</a>
      </div>
      <div class="features">
        <div class="feature">
          <h3>Self-service for clients</h3>
          <p>Each client signs in with their own password to download their installer and review credit used and remaining.</p>
        </div>
        <div class="feature">
          <h3>Per-client cost control</h3>
          <p>Grant a credit limit per client by day, month, or lifetime. Spend is enforced at the gateway automatically.</p>
        </div>
        <div class="feature">
          <h3>Centralized identity</h3>
          <p>All requests appear as one canonical device. Tokens and OAuth lifecycle are managed for you, centrally.</p>
        </div>
      </div>
    </div>
  </main>
  <footer>CC Gateway · self-hosted</footer>
</body>
</html>`
}
