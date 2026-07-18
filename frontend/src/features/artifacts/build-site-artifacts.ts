import type { SiteModel } from "../site-model/schema";

export type SiteArtifacts = {
  html: string;
  css: string;
  javascript: string;
  srcdoc: string;
};

const fontFamilies: Record<SiteModel["theme"]["fontFamily"], string> = {
  sans: 'Inter, "Noto Sans JP", system-ui, sans-serif',
  serif: '"Noto Serif JP", Georgia, serif',
  rounded: '"M PLUS Rounded 1c", "Noto Sans JP", sans-serif',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

export function buildSiteArtifacts(model: SiteModel): SiteArtifacts {
  const sections = model.sections
    .filter((section) => section.visible)
    .map((section, index) => {
      const isHero = section.kind === "hero" || index === 0;
      const heading = isHero
        ? `<h1>${escapeHtml(section.title)}</h1>`
        : `<h2>${escapeHtml(section.title)}</h2>`;
      const image = section.kind === "contact"
        ? ""
        : `<div class="image-placeholder" role="img" aria-label="${escapeHtml(section.imageAlt)}"><span>IMAGE</span></div>`;

      return `<section class="section section-${escapeHtml(section.kind)}" data-builder-id="${escapeHtml(section.id)}" tabindex="0">
  <div class="section-inner">
    ${heading}
    <p>${escapeHtml(section.body)}</p>
    ${image}
  </div>
</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(model.siteTitle)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header" data-builder-id="site-header">
    <a href="#main" class="logo">${escapeHtml(model.siteTitle)}</a>
    <span>${escapeHtml(model.tagline)}</span>
  </header>
  <main id="main">
    ${sections}
  </main>
  <footer data-builder-id="site-footer">自分で調べた情報を確認してから提出しましょう。</footer>
  <script src="script.js"></script>
</body>
</html>`;

  const css = `:root {
  --primary: ${model.theme.primary};
  --background: ${model.theme.background};
  --text: ${model.theme.text};
  --space: ${model.theme.spacing * 4}px;
  font-family: ${fontFamilies[model.theme.fontFamily]};
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--text); background: var(--background); line-height: 1.75; }
.site-header { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: 18px clamp(20px, 6vw, 80px); background: #fff; border-bottom: 1px solid #dbe3ef; }
.logo { color: var(--primary); font-weight: 800; text-decoration: none; }
.site-header span { color: #5b6474; font-size: 13px; }
.section { padding: calc(var(--space) * 2.5) clamp(20px, 8vw, 120px); cursor: pointer; }
.section:focus, .section:hover { outline: 3px solid color-mix(in srgb, var(--primary) 55%, transparent); outline-offset: -6px; }
.section-inner { width: min(980px, 100%); margin: 0 auto; }
.section-hero { min-height: 64vh; display: grid; align-items: center; color: #fff; background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 56%, #111827)); }
h1 { max-width: 780px; margin: 0 0 20px; font-size: clamp(42px, 8vw, 88px); line-height: 1.05; }
h2 { margin: 0 0 16px; color: var(--primary); font-size: clamp(28px, 4vw, 46px); }
p { max-width: 720px; margin: 0 0 28px; }
.image-placeholder { min-height: 220px; display: grid; place-items: center; color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, #fff); border: 2px dashed color-mix(in srgb, var(--primary) 35%, #fff); border-radius: 20px; font-weight: 800; letter-spacing: .18em; }
.section-features { background: #fff; }
footer { padding: 28px; text-align: center; color: #667085; background: #eef2f7; font-size: 13px; }
@media (max-width: 640px) {
  .site-header { align-items: flex-start; flex-direction: column; }
  .section { padding: calc(var(--space) * 2) 20px; }
  .section-hero { min-height: 54vh; }
}`;

  const javascript = `document.querySelectorAll('[data-builder-id]').forEach((element) => {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage({
      type: 'learning-builder:select',
      elementId: element.getAttribute('data-builder-id')
    }, '*');
  });
});`;

  const srcdoc = html
    .replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
    .replace('<script src="script.js"></script>', `<script>${javascript}</script>`);

  return { html, css, javascript, srcdoc };
}
