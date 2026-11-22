// Generates src/styles/theme-dark.generated.css: the dark version of every
// rule of the site's stylesheets that sets a colour, scoped to
// html[data-theme="dark"]. It is not an inversion: each colour is mapped by its
// role (background, text, border, shadow) and hue to the FBF dark palette
// (warm dark surfaces, brand orange kept, readable text levels).
//   node scripts/build-dark-theme.mjs
// Hand-written adjustments live in src/styles/theme-dark.css (loaded after).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const SOURCES = ['index.css', 'styles/site.css', 'styles/replay.css'];
const SCOPE = 'html[data-theme="dark"]';

// ---------------------------------------------------------------- colours
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function parse(token) {
  const t = token.toLowerCase();
  if (NAMED[t]) return [...NAMED[t]];
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hex(rgb, a = 1) {
  const s = '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return a >= 1 ? s : `rgba(${rgb.map(Math.round).join(', ')}, ${+a.toFixed(3)})`;
}
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// chroma (max - min channel) separates real tints from creams and greys better than HSL saturation
const chroma = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
// warm hues need more chroma to count as a tint (the base palette is warm beige);
// green, blue and red tints are rare and meaningful (status pills), so lower thresholds
const family = (h, s, c = 1, warmMin = 0.14) => {
  if (s < 0.22 || c < 0.04) return 'neutral';
  if (h < 15 || h >= 330) return 'red';
  if (h < 50) return c < warmMin ? 'neutral' : 'orange';
  if (h < 70) return c < warmMin ? 'neutral' : 'yellow';
  if (h < 175) return 'green';
  if (h < 260) return 'blue';
  return 'red';
};

// FBF dark palette
const P = {
  page: '#16130f', surface: '#211b17', surface2: '#16130f', raised: '#2e2721', line: '#3a3129', lineStrong: '#4d4136',
  text: '#f3ebe0', text2: '#d8cbbb', muted: '#ab9d8c', faint: '#857767',
  orangeBg: '#3b2918', greenBg: '#1d2a20', redBg: '#3a1f1b', blueBg: '#1a2433', yellowBg: '#3a3016',
  orangeText: '#f2a35e', greenText: '#93c79e', redText: '#f29d92', blueText: '#9cbcf2', yellowText: '#ffd36a',
  orangeLine: '#6a4826', greenLine: '#35503b', redLine: '#6a3029', blueLine: '#2f4466',
};

function mapBg(c) {
  const [h, s, l] = hsl(c);
  const a = c[3];
  if (a === 0) return null;
  const f = family(h, s, chroma(c));
  if (l >= 0.86) {
    if (f === 'orange') return hex(rgbOf(P.orangeBg), a);
    if (f === 'yellow') return hex(rgbOf(P.yellowBg), a);
    if (f === 'green') return hex(rgbOf(P.greenBg), a);
    if (f === 'red') return hex(rgbOf(P.redBg), a);
    if (f === 'blue') return hex(rgbOf(P.blueBg), a);
    // light theme: page cream < white cards; chips darker than the page. Same hierarchy in dark.
    if (l >= 0.985) return hex(rgbOf(P.surface), a);
    if (l >= 0.95) return hex(rgbOf(P.page), a);
    return hex(rgbOf(P.raised), a);
  }
  if (l >= 0.62) {
    if (f === 'neutral' || s < 0.45) return hex(rgbOf(P.lineStrong), a);
    return hex(rgbOf(P[`${f}Line`] ?? P.lineStrong), a);
  }
  if (l < 0.2 && f === 'neutral') return hex(rgbOf('#0d0b09'), a); // dark heroes stay dark, a step below the page
  if (l < 0.2) return hex(c.slice(0, 3), a);
  return null; // saturated accents (buttons, badges) keep their colour
}

function mapText(c) {
  const [h, s, l] = hsl(c);
  const a = c[3];
  const f = family(h, s, chroma(c));
  if (l >= 0.86) return null; // light text already sits on dark or coloured backgrounds
  if (f === 'neutral' || (l < 0.22 && s < 0.5)) {
    if (l < 0.22) return hex(rgbOf(P.text), a);
    if (l < 0.4) return hex(rgbOf(P.text2), a);
    if (l < 0.6) return hex(rgbOf(P.muted), a);
    return hex(rgbOf(P.faint), a);
  }
  return hex(rgbOf(P[`${f}Text`] ?? P.text2), a);
}

function mapLine(c) {
  const [h, s, l] = hsl(c);
  const a = c[3];
  if (a === 0) return null;
  const f = family(h, s, chroma(c), 0.3);
  if (l >= 0.6) return hex(rgbOf(f === 'neutral' || s < 0.35 ? P.line : P[`${f}Line`] ?? P.line), a);
  if (l < 0.2) return hex(rgbOf(P.lineStrong), a);
  return null;
}

function mapShadow(c) {
  const a = c[3];
  return `rgba(0, 0, 0, ${+Math.min(0.6, Math.max(0.25, a * 3)).toFixed(2)})`;
}

const ROLE = (prop) => {
  if (prop === 'color' || prop === 'caret-color' || prop === 'accent-color' || prop === '-webkit-text-fill-color') return mapText;
  if (prop.startsWith('background') || prop === 'fill') return mapBg;
  if (prop.startsWith('border') || prop.startsWith('outline') || prop === 'stroke' || prop === 'column-rule' || prop === 'text-decoration-color') return mapLine;
  if (prop === 'box-shadow' || prop === 'text-shadow') return mapShadow;
  return null;
};

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
function mapValue(prop, value) {
  const fn = ROLE(prop);
  if (!fn) return null;
  let changed = false;
  const out = value.replace(COLOR_RE, (tok) => {
    const c = parse(tok);
    if (!c) return tok;
    const m = fn(c);
    if (m && m.toLowerCase() !== tok.toLowerCase()) { changed = true; return m; }
    return tok;
  });
  return changed ? out : null;
}

// ---------------------------------------------------------------- CSS walk
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

function scopeSelector(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    if (s === ':root' || s === 'html') return SCOPE;
    if (s === 'body') return `${SCOPE} body`;
    if (s.startsWith('html')) return `${SCOPE}${s.slice(4)}`;
    if (s.startsWith('body') || s.startsWith('::')) return `${SCOPE} ${s}`;
    return `${SCOPE} ${s}`;
  }).join(', ');
}

function walk(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // find matching brace
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) {
      const inner = walk(body);
      if (inner.length) out.push(`${head} {\n${inner.map((r) => '  ' + r).join('\n')}\n}`);
    } else if (!head.startsWith('@')) {
      const decls = [];
      for (const part of body.split(';')) {
        const k = part.indexOf(':');
        if (k < 0) continue;
        const prop = part.slice(0, k).trim().toLowerCase();
        const value = part.slice(k + 1).trim();
        const mapped = mapValue(prop, value);
        if (mapped) decls.push(`${prop}: ${mapped}`);
      }
      if (decls.length && head) out.push(`${scopeSelector(head)} { ${decls.join('; ')}; }`);
    }
    i = j;
  }
  return out;
}

const parts = ['/* Gerado por scripts/build-dark-theme.mjs a partir das folhas de estilo do site. Não edite à mão: rode o script. */'];
for (const file of SOURCES) {
  const rules = walk(stripComments(readFileSync(root + file, 'utf8')));
  parts.push(`/* ${file} (${rules.length} regras) */`, ...rules);
}
writeFileSync(root + 'styles/theme-dark.generated.css', parts.join('\n') + '\n');
console.log(`theme-dark.generated.css: ${parts.length - 1 - SOURCES.length} regras`);
