// A1 전지를 '아웃라인 PDF'로 만든다. 글꼴을 넣지 않고 모든 글자를 선(벡터 도형)으로 그린다.
// 화면에 그려진 전지의 상자·선·글자 위치를 그대로 읽어서, 같은 글꼴 파일의 글자 모양으로 옮겨 그린다.
// 그래서 화면용 글꼴(style.css)과 아래 글꼴 파일이 꼭 같은 글꼴이어야 한다.

const OPENTYPE = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.min.js';
const PRETENDARD = w => `https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-${w}.otf`;
const FONT_FILES = {
  sans400: PRETENDARD('Regular'),
  sans500: PRETENDARD('Medium'),
  sans700: PRETENDARD('Bold'),
  sans900: PRETENDARD('Black'),
  hand: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumpenscript/NanumPenScript-Regular.ttf',
  poorstory: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poorstory/PoorStory-Regular.ttf',
  himelody: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/himelody/HiMelody-Regular.ttf'
};

let fontsLoading = null;
function loadFonts() {
  if (!fontsLoading) {
    fontsLoading = (async () => {
      const mod = await import(OPENTYPE);
      const opentype = mod.default || mod;
      const list = await Promise.all(Object.entries(FONT_FILES).map(async ([key, url]) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`글꼴을 받지 못함: ${key}`);
        return [key, opentype.parse(await res.arrayBuffer())];
      }));
      return Object.fromEntries(list);
    })();
    fontsLoading.catch(() => { fontsLoading = null; });
  }
  return fontsLoading;
}

function pickFont(fonts, cs) {
  if (/Poor Story/i.test(cs.fontFamily)) return fonts.poorstory;
  if (/Hi Melody/i.test(cs.fontFamily)) return fonts.himelody;
  if (/Nanum Pen/i.test(cs.fontFamily)) return fonts.hand;
  const w = parseInt(cs.fontWeight, 10) || 400;
  return w >= 800 ? fonts.sans900 : w >= 650 ? fonts.sans700 : w >= 450 ? fonts.sans500 : fonts.sans400;
}

// 글자 상자 맨 위에서 기준선까지의 거리 (글자 크기 대비 비율). 글꼴마다 한 번 재서 기억한다.
const baselineCache = new Map();
function baselineRatio(cs) {
  const key = cs.fontFamily + '|' + cs.fontWeight;
  if (!baselineCache.has(key)) {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;left:-100000px;top:0;white-space:nowrap;line-height:normal;font-size:100px;font-family:${cs.fontFamily};font-weight:${cs.fontWeight}`;
    probe.textContent = '가';
    const mark = document.createElement('i');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    probe.appendChild(mark);
    document.body.appendChild(probe);
    const range = document.createRange();
    range.selectNodeContents(probe.firstChild);
    const top = range.getClientRects()[0].top;
    baselineCache.set(key, (mark.getBoundingClientRect().top - top) / 100);
    probe.remove();
  }
  return baselineCache.get(key);
}

const n = v => String(Math.round(v * 100) / 100);
function rgb(css) {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return a < 0.05 ? null : [r, g, b].map(v => n(v / 255)).join(' ');
}
const px = v => parseFloat(v) || 0;

function radius(value, w, h) {
  const r = value.endsWith('%') ? parseFloat(value) / 100 * Math.min(w, h) : px(value);
  return Math.max(0, Math.min(r, w / 2, h / 2));
}

function roundRect(x, y, w, h, [tl, tr, br, bl]) {
  const k = 0.5523;
  return [
    `${n(x + tl)} ${n(y)} m`,
    `${n(x + w - tr)} ${n(y)} l`,
    `${n(x + w - tr + tr * k)} ${n(y)} ${n(x + w)} ${n(y + tr - tr * k)} ${n(x + w)} ${n(y + tr)} c`,
    `${n(x + w)} ${n(y + h - br)} l`,
    `${n(x + w)} ${n(y + h - br + br * k)} ${n(x + w - br + br * k)} ${n(y + h)} ${n(x + w - br)} ${n(y + h)} c`,
    `${n(x + bl)} ${n(y + h)} l`,
    `${n(x + bl - bl * k)} ${n(y + h)} ${n(x)} ${n(y + h - bl + bl * k)} ${n(x)} ${n(y + h - bl)} c`,
    `${n(x)} ${n(y + tl)} l`,
    `${n(x)} ${n(y + tl - tl * k)} ${n(x + tl - tl * k)} ${n(y)} ${n(x + tl)} ${n(y)} c`,
    'h'
  ].join('\n');
}

function glyphOps(path) {
  const out = [];
  let cx = 0, cy = 0;
  for (const c of path.commands) {
    if (c.type === 'M') { out.push(`${n(c.x)} ${n(c.y)} m`); cx = c.x; cy = c.y; }
    else if (c.type === 'L') { out.push(`${n(c.x)} ${n(c.y)} l`); cx = c.x; cy = c.y; }
    else if (c.type === 'C') { out.push(`${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)} c`); cx = c.x; cy = c.y; }
    else if (c.type === 'Q') {
      const x1 = cx + 2 / 3 * (c.x1 - cx), y1 = cy + 2 / 3 * (c.y1 - cy);
      const x2 = c.x + 2 / 3 * (c.x1 - c.x), y2 = c.y + 2 / 3 * (c.y1 - c.y);
      out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(c.x)} ${n(c.y)} c`);
      cx = c.x; cy = c.y;
    } else if (c.type === 'Z') out.push('h');
  }
  return out.join('\n');
}

// posterEl: 크기를 줄이지 않은(596×842mm 그대로) 전지 요소
export async function outlinePdf(posterEl, onStep = () => {}) {
  onStep('글꼴 받는 중… (처음 한 번은 10초쯤)');
  const fonts = await loadFonts();
  await document.fonts.ready;
  onStep('글자를 선으로 바꾸는 중…');

  const origin = posterEl.getBoundingClientRect();
  const W = origin.width, H = origin.height; // 화면 픽셀(1px = 0.75pt)
  const ops = [`0.75 0 0 -0.75 0 ${n(H * 0.75)} cm`]; // 위→아래 좌표를 그대로 쓰도록 뒤집기
  const range = document.createRange();
  let missing = 0;

  const box = el => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };

  function drawBox(el, cs) {
    const { x, y, w, h } = box(el);
    if (!w || !h) return;
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(v => radius(v, w, h));
    const bg = rgb(cs.backgroundColor);
    if (bg) ops.push(`${bg} rg`, roundRect(x, y, w, h, radii), 'f');

    const sides = ['Top', 'Right', 'Bottom', 'Left'].map(s => ({
      s, width: px(cs[`border${s}Width`]), style: cs[`border${s}Style`], color: rgb(cs[`border${s}Color`])
    })).filter(b => b.width > 0 && b.style !== 'none' && b.color);
    if (!sides.length) return;

    const same = sides.length === 4 && sides.every(b => b.width === sides[0].width && b.style === 'solid' && b.color === sides[0].color);
    if (same) {
      const bw = sides[0].width;
      ops.push(`${sides[0].color} RG`, `${n(bw)} w`, roundRect(x + bw / 2, y + bw / 2, w - bw, h - bw, radii.map(r => Math.max(0, r - bw / 2))), 'S');
      return;
    }
    for (const b of sides) {
      const half = b.width / 2;
      const line = {
        Top: [x, y + half, x + w, y + half], Bottom: [x, y + h - half, x + w, y + h - half],
        Left: [x + half, y, x + half, y + h], Right: [x + w - half, y, x + w - half, y + h]
      }[b.s];
      const dash = b.style === 'dashed' ? `[${n(b.width * 3)} ${n(b.width * 3)}] 0 d` : b.style === 'dotted' ? `[${n(b.width)} ${n(b.width)}] 0 d` : '[] 0 d';
      ops.push(`${b.color} RG`, `${n(b.width)} w`, dash, `${n(line[0])} ${n(line[1])} m ${n(line[2])} ${n(line[3])} l S`, '[] 0 d');
    }
  }

  function drawText(node, cs) {
    const color = rgb(cs.color);
    if (!color) return;
    const font = pickFont(fonts, cs);
    const size = px(cs.fontSize);
    const base = baselineRatio(cs) * size;
    ops.push(`${color} rg`);
    const text = node.data;
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i);
      const len = cp > 0xffff ? 2 : 1;
      const ch = String.fromCodePoint(cp);
      if (!/\s/.test(ch)) {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const r = range.getClientRects()[0];
        if (r && r.width) {
          let f = font, glyph = font.charToGlyph(ch);
          if (!glyph || glyph.index === 0) {
            f = [fonts.sans500, fonts.hand].find(o => o.charToGlyph(ch)?.index > 0) || font;
            glyph = f.charToGlyph(ch);
            if (!glyph || glyph.index === 0) missing++;
          }
          const path = glyph.getPath(r.left - origin.left, r.top - origin.top + base, size);
          const g = glyphOps(path);
          if (g) ops.push(g, 'f');
        }
      }
      i += len;
    }
  }

  function paint(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    drawBox(el, cs);
    const clip = cs.overflow !== 'visible' && cs.overflow !== '';
    if (clip) {
      const { x, y, w, h } = box(el);
      ops.push('q', `${n(x)} ${n(y)} ${n(w)} ${n(h)} re W n`);
    }
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) drawText(child, cs);
      else if (child.nodeType === Node.ELEMENT_NODE) paint(child);
    }
    if (clip) ops.push('Q');
  }

  paint(posterEl);
  onStep('PDF 만드는 중…');
  const blob = await buildPdf(ops.join('\n'), W * 0.75, H * 0.75);
  return { blob, missing };
}

// 글꼴 없는 1쪽짜리 PDF (도형만)
async function buildPdf(content, wPt, hPt) {
  const enc = new TextEncoder();
  let body = enc.encode(content);
  let filter = '';
  if ('CompressionStream' in window) {
    const zipped = new Blob([body]).stream().pipeThrough(new CompressionStream('deflate'));
    body = new Uint8Array(await new Response(zipped).arrayBuffer());
    filter = '/Filter /FlateDecode ';
  }
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = chunk => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (num, text) => { offsets[num] = length; push(`${num} 0 obj\n${text}\nendobj\n`); };

  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  // 인쇄소 가이드 파일처럼 모든 페이지 박스를 작업 크기(재단 여백 포함)로 같게 둔다
  const box = `[0 0 ${n(wPt)} ${n(hPt)}]`;
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /CropBox ${box} /TrimBox ${box} /BleedBox ${box} /ArtBox ${box} /Resources << >> /Contents 4 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Length ${body.length} ${filter}>>\nstream\n`);
  push(body);
  push('\nendstream\nendobj\n');
  const xref = length;
  let table = 'xref\n0 5\n0000000000 65535 f \n';
  for (let i = 1; i <= 4; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(`${table}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
