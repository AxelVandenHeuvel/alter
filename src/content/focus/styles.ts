import { BRAND } from '../../lib/brand';

/** Styles for the reader and recipe views, scoped to their shadow root. */
export const FOCUS_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }

.frame {
  --bg: #fbfbf9;
  --sheet: #ffffff;
  --text: #1d1d1f;
  --muted: #6e6e73;
  --faint: #a1a1a6;
  --rule: #e6e6e3;
  --accent: ${BRAND.accent};
  --bar: rgba(251, 251, 249, 0.86);
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font: 17px/1.65 Charter, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  -webkit-font-smoothing: antialiased;
}
.theme-sepia { --bg: #f4ecd8; --sheet: #f8f1e1; --text: #3b2f22; --muted: #7a6650; --faint: #a8957d; --rule: #e3d6ba; --accent: #8a5a2b; --bar: rgba(244, 236, 216, 0.88); }
.theme-dark { --bg: #161618; --sheet: #1c1c1f; --text: #e8e6e3; --muted: #a1a1aa; --faint: #6b6b74; --rule: #2c2c31; --accent: ${BRAND.accentOnDark}; --bar: rgba(22, 22, 24, 0.86); color-scheme: dark; }
.size-large { font-size: 20px; }

.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--rule);
  background: var(--bar);
  backdrop-filter: saturate(1.4) blur(12px);
  font: 500 13px/1 ${BRAND.font};
  flex-shrink: 0;
}
.bar-label { color: var(--accent); font-weight: 600; }
.bar-site { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.bar-close, .reopen {
  font: 500 13px/1 ${BRAND.font};
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--rule);
  background: var(--sheet);
  color: var(--text);
  cursor: pointer;
}
.bar-close:hover { border-color: var(--faint); }
.bar-close:focus-visible, .reopen:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.sheet {
  flex: 1;
  overflow-y: auto;
  padding: 48px 24px 96px;
}
.sheet > * { max-width: 680px; margin-left: auto; margin-right: auto; }

.notice {
  font: 14px/1.5 ${BRAND.font};
  color: var(--muted);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 28px;
}
.title { font-size: 2.1em; line-height: 1.2; letter-spacing: -0.01em; margin: 0 auto 12px; font-weight: 700; }
.byline { color: var(--muted); font-size: 0.9em; margin: 0 auto 32px; font-family: ${BRAND.font}; }

.article { overflow-wrap: break-word; }
.article p, .article ul, .article ol, .article blockquote, .article pre, .article table, .article figure { margin: 0 0 1.15em; }
.article h1, .article h2, .article h3, .article h4 { line-height: 1.3; margin: 1.8em 0 0.6em; }
.article h2 { font-size: 1.4em; }
.article h3 { font-size: 1.2em; }
.article a { color: var(--accent); text-underline-offset: 2px; }
.article img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0 auto; }
.article figcaption { color: var(--muted); font-size: 0.85em; text-align: center; margin-top: 8px; }
.article blockquote { border-left: 3px solid var(--rule); padding-left: 1em; color: var(--muted); font-style: italic; }
.article pre, .article code { font: 0.85em/1.5 ui-monospace, 'SF Mono', Menlo, monospace; }
.article pre { background: var(--sheet); border: 1px solid var(--rule); border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
.article table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
.article th, .article td { border: 1px solid var(--rule); padding: 6px 10px; text-align: left; }
.article hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 32px;
  margin: 0 auto 24px;
  padding: 14px 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  font-family: ${BRAND.font};
}
.fact dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 2px; }
.fact dd { margin: 0; font-size: 15px; font-weight: 600; }
.hero { display: block; width: 100%; max-height: 420px; object-fit: cover; border-radius: 10px; margin-bottom: 24px; }
.description { color: var(--muted); margin-bottom: 32px; }

.recipe { display: grid; grid-template-columns: minmax(0, 1fr); gap: 40px; }
.recipe h2 { font-size: 1.3em; margin: 0 0 14px; }
.recipe h3 { font-size: 1em; margin: 20px 0 8px; color: var(--muted); }
.ingredients ul { list-style: none; padding: 0; margin: 0; }
.ingredients li { border-bottom: 1px solid var(--rule); }
.ingredients label { display: flex; gap: 12px; align-items: baseline; padding: 9px 0; cursor: pointer; }
.ingredients input { accent-color: var(--accent); width: 16px; height: 16px; flex-shrink: 0; transform: translateY(2px); }
.ingredients input:checked + span { color: var(--faint); text-decoration: line-through; }
.steps ol { margin: 0; padding-left: 1.4em; }
.steps li { margin-bottom: 1em; padding-left: 0.3em; }
.steps li::marker { color: var(--accent); font-weight: 700; }

@media (min-width: 900px) {
  .sheet--recipe > * { max-width: 920px; }
  .recipe { grid-template-columns: minmax(240px, 1fr) minmax(0, 1.6fr); }
}

.reopen {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  color: #fff;
  background: ${BRAND.accent};
  border-color: transparent;
}
`;
