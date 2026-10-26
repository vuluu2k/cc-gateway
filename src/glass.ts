// Shared "glass" look for every HTML page: translucent panel tokens over a
// soft gradient backdrop, with a frosted blur on the page's own panels.
// Append it at the end of a page's <style> so it wins the cascade. Never put
// a position:fixed element (modal) inside a blurred panel: backdrop-filter
// re-anchors fixed descendants to that panel.

/** `panels` is the page's selector list that gets the frosted blur. */
export function glassCss(panels: string): string {
  return `
  :root {
    --bg: #0b0d10;
    --panel: rgba(22, 27, 34, .55);
    --panel-2: rgba(255, 255, 255, .05);
    --border: rgba(255, 255, 255, .08);
    --glass-blur: blur(18px) saturate(140%);
    color-scheme: dark;
  }
  body {
    background:
      radial-gradient(900px 600px at 0% -10%, rgba(88,166,255,.16), transparent 60%),
      radial-gradient(800px 600px at 100% 0%, rgba(163,113,247,.14), transparent 60%),
      radial-gradient(800px 500px at 50% 110%, rgba(63,185,80,.08), transparent 60%),
      var(--bg);
    background-attachment: fixed;
  }
  ${panels} {
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 8px 32px rgba(0,0,0,.25);
  }
  button.primary, a.btn.primary {
    background: linear-gradient(135deg, #1f6feb, #8957e5); border-color: transparent;
    box-shadow: 0 4px 14px rgba(31,111,235,.3); transition: filter .15s;
  }
  button.primary:hover, a.btn.primary:hover {
    background: linear-gradient(135deg, #1f6feb, #8957e5); border-color: transparent; filter: brightness(1.12);
  }
`
}
