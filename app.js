/*
 * loom — a tilt-to-read card revelation.
 *
 * The page is an endless loom made of stretched lettering: page after page
 * of it, one phrase across each page and one down, all nonsense. It can be
 * dragged, zoomed, turned and re-rolled, and zooming in keeps finding new
 * pages the same size on screen. Nothing is hidden in it.
 *
 * Secret input (shown only in the faint corner indicator):
 *   – Pinch: each `pinchStep` change of finger distance steps the value.
 *   – Rotate: every quarter turn steps the suit (the image snaps to 90°).
 *   – Double-tap: lock the card in. The lettering on screen is rewoven into
 *     two real phrases that fill the screen and stay part of the loom;
 *     pinching and turning now only move the picture.
 *
 * All the lettering is built the way classic tilt-to-read images are: small,
 * light, lowercase type, stretched ~24× along one axis only (one phrase down
 * the screen, the other across). Viewed at a grazing angle along that axis,
 * foreshortening squashes a phrase back into letters.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- constants
  const Q = Math.PI / 2;
  const IMG = 1000;
  const MID = IMG / 2;
  const CLOTH = 820;
  // Bundled variable font (fonts/), so the letters look the same on every device.
  const FONT = '"Loom Thread", "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
  const MAX_STRETCH = 40;
  const ZOOM_MIN = 1 / 8, ZOOM_MAX = 64;   // the loom is endless; this is just a sane range
  const ROAM = 40000;                      // how far (image units) the view may wander

  const SUITS = {
    S: { name: 'SPADES', sym: '♠' },
    H: { name: 'HEARTS', sym: '♥' },
    C: { name: 'CLUBS', sym: '♣' },
    D: { name: 'DIAMONDS', sym: '♦' },
  };
  const VALUES = [
    ['A', 'ACE', 'ACE'], ['2', '2', 'TWO'], ['3', '3', 'THREE'], ['4', '4', 'FOUR'],
    ['5', '5', 'FIVE'], ['6', '6', 'SIX'], ['7', '7', 'SEVEN'], ['8', '8', 'EIGHT'],
    ['9', '9', 'NINE'], ['10', '10', 'TEN'], ['J', 'JACK', 'JACK'], ['Q', 'QUEEN', 'QUEEN'],
    ['K', 'KING', 'KING'],
  ].map(([short, digits, words]) => ({ short, digits, words }));

  // For a viewer at each edge: U points "away" from them (text up),
  // R points to their right (reading direction). Canvas coords, y down.
  const EDGES = {
    bottom: { U: [0, -1], R: [1, 0], toBottom: 0 },
    right: { U: [-1, 0], R: [0, -1], toBottom: Q },
    top: { U: [0, 1], R: [-1, 0], toBottom: 2 * Q },
    left: { U: [1, 0], R: [0, 1], toBottom: -Q },
  };
  const axisOf = (edge) => (edge === 'bottom' || edge === 'top' ? 'v' : 'h');

  const THEMES = {
    linen: { bg: '#f3efe6', ink: '#1d1b18' },
    paper: { bg: '#ffffff', ink: '#000000' },
    night: { bg: '#111113', ink: '#ebe6dc' },
  };

  const DEFAULTS = {
    phraseA: 'The card you chose was',
    phraseB: 'THE {value} OF {suit}',
    edgeA: 'bottom',
    edgeB: 'left',
    valueStyle: 'words',
    letterCase: 'lower',
    suitOrder: 'CHSD',
    pinchStep: 1.22,
    gestureLock: true,
    liveUpdate: false,
    haptics: true,
    indicator: 'card',
    startCard: 'random',
    stretch: 24,
    density: 1,
    loomOn: true,
    revealOn: 'lock',   // 'lock' (double-tap), 'input' (first pinch/twist) or 'start'
    layout: 'overlap',
    weight: 300,
    theme: 'linen',
    holdOrientation: true,
  };
  const STORE_KEY = 'loom.settings.v5';

  // ---------------------------------------------------------------- utils
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (n, m) => ((n % m) + m) % m;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const newSeed = () => (Math.random() * 0xffffffff) >>> 0;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.loom === 0) saved.loomOn = false;
        delete saved.loom;
        if (saved.hideUntilInput === false) saved.revealOn = 'start';
        delete saved.hideUntilInput;
        // carry the old default phrase forward to the current one
        if (/^you will pick$/i.test((saved.phraseA || '').trim())) delete saved.phraseA;
        // settings saved before all-lowercase became the default pick it up once
        if (!(saved.rev >= 2)) delete saved.letterCase;
        // …and the stronger default stretch
        if (!(saved.rev >= 3)) delete saved.stretch;
        delete saved.rev;
        return { ...DEFAULTS, ...saved };
      }
    } catch (_) { /* storage unavailable */ }
    return { ...DEFAULTS };
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...S, rev: 3 })); } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------- state
  let S = loadSettings();

  const state = {
    value: 0,          // 0..12
    suitOffset: 0,     // suit index when theta's quadrant is 0
    theta: 0,          // image rotation (radians, relative to the device)
    s: 1,              // zoom
    pan: { x: 0, y: 0 },
    seed: newSeed(),
    revealed: false,   // has the hidden message been woven in yet?
    locked: null,      // { value, suitKey } once the revelation is locked in
  };

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const ind = document.getElementById('ind');
  const hap = document.getElementById('hap');
  let view = { w: 0, h: 0, dpr: 1, cx: 0, cy: 0, fit: 1 };

  let scene = null;    // { weave, msg } — msg is null until a card is input
  let fade = null;     // { prev, start, dur }
  let anim = null;     // settle animation
  let raf = 0;

  // ---------------------------------------------------------------- cards
  const suitKeys = () => S.suitOrder.split('');
  const quadrant = (theta = state.theta) => Math.round(theta / Q);
  function currentCard() {
    if (state.locked) return state.locked;
    const keys = suitKeys();
    const suitKey = keys[mod(state.suitOffset + quadrant(), 4)];
    return { value: state.value, suitKey };
  }
  const cardKey = (c) => `${c.value}${c.suitKey}`;
  function cardPhrase(c) {
    const v = VALUES[c.value][S.valueStyle === 'words' ? 'words' : 'digits'];
    return S.phraseB
      .replace(/\{value\}/gi, v)
      .replace(/\{suit\}/gi, SUITS[c.suitKey].name);
  }
  /** Lowercase letters stretch into loops and loose ends; capitals into obvious bars. */
  function applyCase(text, first) {
    if (S.letterCase === 'upper') return text.toUpperCase();
    const low = text.toLowerCase();
    if (S.letterCase === 'sentence' && first) return low.replace(/[a-z]/, (ch) => ch.toUpperCase());
    return low;
  }

  // ---------------------------------------------------------------- weave
  /**
   * A weave is the random part of the picture: the seed of the loom that
   * covers the page, plus the numbers that place the two phrases and decide
   * which letter stems run on as loose threads.
   */
  function buildWeave(seed) {
    const r = mulberry32(seed);
    return { seed, jitter: { u: (r() - 0.5) * 2, r: (r() - 0.5) * 2, band: r() } };
  }

  /** Deterministic pseudo-random number in [0, 1) from five integers. */
  function hash(seed, a, b, c, d) {
    let h = (seed ^ Math.imul(a + 0x7f4a7c15, 0x9e3779b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) ^ Math.imul(c + 0x1b873593, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(d + 0x2545f491, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- the page
  /**
   * How a phrase read from `edge` fills the screen (layout units, zoom 1):
   * it runs the full length of one side and is stretched across the other.
   * The stretched bodies of the letters can only take up a little over half
   * of that, because the ascenders and descenders have to fit on screen too,
   * or an h reads as an n.
   */
  function pageSlot(edge) {
    const W = view.visW * 0.97, H = view.visH * 0.97;
    const sideways = Math.abs(EDGES[edge].U[0]) > 0.5; // stretched across the screen
    return sideways ? { width: H * 0.985, maxBand: W * 0.58 } : { width: W * 0.985, maxBand: H * 0.58 };
  }

  const GAP = '    '; // between repeats of a phrase
  /**
   * A short phrase cannot reach the far end of a long side however far it is
   * letter-spaced, so it is repeated along the line until it does.
   */
  function repeatToFill(text, slot) {
    if (/[|\n]/.test(text) || !text.trim()) return text;
    const St = Math.min(MAX_STRETCH, S.stretch);
    const m = measurePhrase(text);
    const em = Math.min(slot.width / m.nat, slot.maxBand / (St * m.xh));
    const one = (m.nat + 1) * em;                        // one copy plus its gap
    const n = Math.max(1, Math.ceil(slot.width / (1.7 * one) - 0.2));
    return n > 1 ? Array(n).fill(text.trim()).join(GAP) : text;
  }

  // Letters in roughly the proportions of English, without the diagonal ones.
  const LETTERS = 'eeeeeeeeeeeettttttttaaaaaaaaoooooooiiiiiiinnnnnnnsssssshhhhhhrrrrrrddddllllcccuuummffggppbbyw';
  /** Nonsense words, about `ems` wide at the current weight. */
  function gibberish(rnd, ems) {
    let out = '';
    for (let guard = 0; guard < 60; guard++) {
      const len = 2 + Math.floor(rnd() * rnd() * 7);
      let word = '';
      for (let n = 0; n < len; n++) word += LETTERS[Math.floor(rnd() * LETTERS.length)];
      out += (out ? ' ' : '') + word;
      if (measurePhrase(out).nat >= ems) break;
    }
    return out;
  }

  /**
   * The loom is made of the same thing as the message: pages of stretched
   * lettering, one phrase across and one down, except that the letters are
   * nonsense. Pages tile the plane, so the loom has no edges, and they exist
   * at every power-of-two scale, so zooming in keeps finding new ones the
   * same size on screen. Each page is generated from (seed, scale, column,
   * row) when first needed and then cached.
   */
  const pageCache = new Map();
  function loomPage(seed, L, ci, cj) {
    const key = `${seed}|${L}|${ci}|${cj}`;
    let page = pageCache.get(key);
    if (page) return page;
    if (pageCache.size > 120) pageCache.clear();
    const St = Math.min(MAX_STRETCH, S.stretch);
    const xh = measurePhrase('x').xh;
    const glyphs = [S.edgeA, S.edgeB].map((edge, i) => {
      const e = EDGES[edge];
      const slot = pageSlot(edge);
      const rnd = mulberry32(Math.floor(hash(seed, L + 64, ci, cj, i) * 4294967296));
      const em = slot.maxBand / (St * xh);
      const g = layoutSolid(gibberish(rnd, slot.width / (em * 1.3)), slot.width, slot.maxBand, rnd, 1, 0.7);
      return g && { lines: g.lines, extras: g.extras, box: g.box, font: g.font, em: g.em, St: g.St, ox: MID, oy: MID, U: e.U, R: e.R };
    }).filter(Boolean);
    page = { glyphs };
    pageCache.set(key, page);
    return page;
  }

  // ---------------------------------------------------------------- messages
  const maskCanvas = document.createElement('canvas');
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  // Letters whose stem can run on as a loose thread and still be the same
  // letter (a taller l is still an l; a taller n would turn into an h).
  const UP_STEMS = 'bdhklt';
  const DOWN_STEMS = 'pq';
  const stemCache = new Map();

  /**
   * Find the stem of a letter in the font itself: its left/right edges and
   * where it ends (all in ems; y is height above the baseline).
   * end = 'top' for ascenders, 'bottom' for descenders.
   */
  function measureStem(ch, end) {
    const key = `${S.weight}|${ch}|${end}`;
    if (stemCache.has(key)) return stemCache.get(key);
    const size = 200, ox = 60, base = 240, W = 320, H = 340;
    maskCanvas.width = W;
    maskCanvas.height = H;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = '#000';
    mctx.textAlign = 'left';
    mctx.textBaseline = 'alphabetic';
    mctx.font = `${S.weight} ${size}px ${FONT}`;
    mctx.fillText(ch, ox, base);
    const data = mctx.getImageData(0, 0, W, H).data;
    const inked = (x, y) => data[(y * W + x) * 4 + 3] > 127;
    const rowHasInk = (y) => { for (let x = 0; x < W; x++) if (inked(x, y)) return true; return false; };
    let y = -1;
    if (end === 'top') { for (let yy = 0; yy < H; yy++) if (rowHasInk(yy)) { y = yy; break; } }
    else { for (let yy = H - 1; yy >= 0; yy--) if (rowHasInk(yy)) { y = yy; break; } }
    let out = null;
    if (y >= 0) {
      const probe = end === 'top' ? y + 8 : y - 8; // a little inside the stem's cut end
      let x0 = -1, x1 = -1;
      for (let x = 0; x < W; x++) {
        if (inked(x, probe)) { if (x0 < 0) x0 = x; x1 = x + 1; } else if (x0 >= 0) break;
      }
      if (x0 >= 0) {
        out = { x0: (x0 - ox) / size, x1: (x1 - ox) / size, y: (base - (end === 'top' ? y : y + 1)) / size };
      }
    }
    stemCache.set(key, out);
    return out;
  }

  /**
   * Lay a phrase out the way the classic tilt-to-read images are built:
   * small, normal-weight, mostly lowercase type, stretched `S.stretch`× along
   * the reading axis only. The letter size comes from the width the phrase
   * fills (`budgetW`); the stretch then sets how long the block is, up to
   * `maxBand`. The bodies of the letters form the dense block, ascenders
   * and descenders hang out of it as loose threads. Where a curved
   * stroke turns horizontal (tops of n, o, e, a…) the stretch makes it S×
   * thicker, which gives the fat tapered spikes at the top and bottom.
   *
   * The extra lines all grow out of the words: some ascenders and descenders
   * run on past the block for a random distance. Returns glyph positions plus
   * `extras`, a Path2D (in the phrase's own unstretched coordinates) holding
   * those run-on stems and the redrawn k's.
   */
  function layoutSolid(text, budgetW, maxBand, rnd, sizeJitter, maxTrack = 0.05) {
    const t = text.replace(/[ \t]+/g, ' ').trim();
    if (!t) return null;
    const lines = t.split(/\s*[|\n]\s*/).filter(Boolean);
    const n = lines.length;
    const setFont = () => { mctx.font = `${S.weight} 100px ${FONT}`; };
    setFont();
    const xh = (mctx.measureText('x').actualBoundingBoxAscent || 52) / 100; // of the em
    const kRight = {};
    for (const ch of 'kK') kRight[ch] = (mctx.measureText(ch).actualBoundingBoxRight || 50) / 100;
    const lineGap = 0.8;                       // gap between lines, in x-heights
    const lineUnits = n + (n - 1) * lineGap;
    const adv = lines.map((ln) => [...ln].map((ch) => mctx.measureText(ch).width / 100));
    const natW = Math.max(...adv.map((a) => a.reduce((x, v) => x + v, 0)));
    // The letter size comes from the width the phrase has to fill. The stretch
    // then sets how long the block is: more stretch = longer words, same
    // letter width. Only when the block would not fit does the type shrink.
    const St = Math.min(MAX_STRETCH, S.stretch);
    let em = (budgetW / natW) * sizeJitter;
    if (St * xh * em * lineUnits > maxBand) em = maxBand / (St * xh * lineUnits);
    const bandLine = St * xh * em;             // stretched x-height of one line
    const xhU = xh * em;                       // x-height in unstretched units
    const pitch = xhU * (1 + lineGap);
    const total = n * xhU + (n - 1) * xhU * lineGap;

    const extras = new Path2D();
    // Every shape is wound the same way, so overlapping pieces add up
    // instead of cancelling under the non-zero fill rule.
    const quad = (pts) => {
      let area = 0;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (area < 0) pts = pts.slice().reverse();
      extras.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) extras.lineTo(pts[k][0], pts[k][1]);
      extras.closePath();
    };
    const rect = (x0, y0, x1, y1) => quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    const dens = S.density;
    const pRun = clamp(0.7 * dens, 0, 1);
    // how far a run-on stem goes, in stretched units
    const runLength = () => {
      const v = rnd();
      if (v < 0.4) return budgetW * (0.04 + rnd() * 0.22);
      if (v < 0.82) return budgetW * (0.26 + rnd() * 0.5);
      return budgetW * (0.9 + rnd() * 1.1); // a few run right off the cloth
    };

    let textW = 0;
    const out = lines.map((ln, i) => {
      const chars = [...ln];
      const w = adv[i].reduce((x, v) => x + v, 0) * em;
      // spread the letters to fill the width, up to maxTrack ems between them
      const track = chars.length > 1
        ? clamp((budgetW - w) / (chars.length - 1), 0, maxTrack * em) : 0;
      const full = w + track * (chars.length - 1);
      textW = Math.max(textW, full);
      const base = -total / 2 + i * pitch + xhU;   // baseline (y grows downwards)
      let x = -full / 2;
      const placed = [];
      chars.forEach((ch, ci) => {
        const a = adv[i][ci] * em;
        const X = (ex) => x + ex * em, Y = (ey) => base - ey * em;
        if (ch === ' ') {
          // above 100%, some word gaps get a stray thread right through the block
          if (n === 1 && dens > 1 && rnd() < (dens - 1) * 0.8) {
            const l = measureStem('l', 'top');
            const hw = l ? (l.x1 - l.x0) * em / 2 : em * 0.045;
            const cx = x + a / 2;
            rect(cx - hw, base - xhU - (bandLine * (0.6 + rnd() * 1.4)) / St,
              cx + hw, base + (bandLine * (0.5 + rnd() * 1.3)) / St);
          }
        } else if (ch === 'k' || ch === 'K') {
          // The font's k has diagonals that stretch into heavy wedges. Draw it
          // as three threads instead: stem, arm and leg, each one stem wide.
          const st = measureStem(ch, 'top');
          if (!st) placed.push({ ch, x });
          else {
            const sw = st.x1 - st.x0, wk = sw * 0.95;
            const top = ch === 'k' ? xh : st.y;
            const a0 = [st.x1 - sw * 0.5, top * 0.3];
            const a1 = [kRight[ch] * 0.97 - wk / 2, top];
            const f = 0.36;
            const P = [a0[0] + (a1[0] - a0[0]) * f, a0[1] + (a1[1] - a0[1]) * f];
            const l1 = [kRight[ch] - wk / 2, 0];
            const para = (p, q) => quad([
              [X(p[0] - wk / 2), Y(p[1])], [X(p[0] + wk / 2), Y(p[1])],
              [X(q[0] + wk / 2), Y(q[1])], [X(q[0] - wk / 2), Y(q[1])],
            ]);
            rect(X(st.x0), Y(0), X(st.x1), Y(st.y));
            para(a0, a1);
            para(P, l1);
          }
        } else placed.push({ ch, x });

        // run some ascenders / descenders on, away from any neighbouring line
        if (i === 0 && UP_STEMS.includes(ch) && rnd() < pRun) {
          const st = measureStem(ch, 'top');
          if (st) rect(X(st.x0), Y(st.y) + em * 0.02, X(st.x1), Y(st.y) - runLength() / St);
        }
        if (i === n - 1 && DOWN_STEMS.includes(ch) && rnd() < pRun) {
          const st = measureStem(ch, 'bottom');
          if (st) rect(X(st.x0), Y(st.y) - em * 0.02, X(st.x1), Y(st.y) + runLength() / St);
        }
        x += a + track;
      });
      return { chars: placed, y: base };
    });
    // the area the phrase needs clear of loom threads (unstretched, y down)
    const box = { hw: textW / 2 + em * 0.25, up: total / 2 + (0.83 - xh) * em, down: total / 2 + 0.31 * em };
    return { lines: out, extras, box, em, text: lines, font: `${S.weight} ${em}px ${FONT}`, St, textW, bandLen: total * St };
  }

  /** Width of a phrase in ems (its longest line), and the font's x-height. */
  function measurePhrase(text) {
    mctx.font = `${S.weight} 100px ${FONT}`;
    const lines = text.replace(/[ \t]+/g, ' ').trim().split(/\s*[|\n]\s*/).filter(Boolean);
    const nat = Math.max(0.01, ...lines.map((ln) => mctx.measureText(ln).width / 100));
    return { nat, xh: (mctx.measureText('x').actualBoundingBoxAscent || 52) / 100 };
  }

  /**
   * Where a newly woven message goes: centred on whatever is in the middle
   * of the screen right now, and scaled so it fits the screen at the current
   * zoom. (Image coordinates; k is the scale applied to the layout.)
   */
  function currentFrame() {
    const kv = view.fit * state.s;
    const a = state.theta - (screenAngle() * Math.PI) / 180;
    const dx = -state.pan.x / kv, dy = -state.pan.y / kv;
    const cos = Math.cos(-a), sin = Math.sin(-a);
    return { x: MID + dx * cos - dy * sin, y: MID + dx * sin + dy * cos, k: 1 / state.s };
  }

  function buildMessage(card, weave, q, frame) {
    const msgs = [
      { text: applyCase(S.phraseA, true), edge: S.edgeA },
      { text: applyCase(cardPhrase(card), false), edge: S.edgeB },
    ];
    const same = axisOf(msgs[0].edge) === axisOf(msgs[1].edge);
    const j = weave.jitter;
    const A = EDGES[msgs[0].edge];
    // Usable extent along an axis: the cloth height, and whatever part of the
    // cloth width is actually on screen.
    const Wx = Math.min(CLOTH, view.visW * 0.94);
    const ext = (vec) => (Math.abs(vec[0]) > 0.5 ? Wx : CLOTH);
    const at = (d, along, across, e) => [
      MID + d[0] + along * e.U[0] + across * e.R[0],
      MID + d[1] + along * e.U[1] + across * e.R[1],
    ];
    // Regions: { centre, budget along R (text width), budget along U (stretched) }
    let regions;
    if (same) {
      // Both read along the same axis: stack them, phrase 1 farther away.
      const gap = 50;
      const bl = (ext(A.U) * 0.88 - gap) / 2;
      const off = bl / 2 + gap / 2;
      regions = msgs.map((m, i) => {
        const e = EDGES[m.edge];
        const s = i === 0 ? off : -off;
        return { c: at([s * A.U[0], s * A.U[1]], j.u * 10, j.r * 8, e), bw: ext(e.R) * 0.9, mb: bl * 0.8 };
      });
    } else if (S.layout === 'overlap') {
      // The message takes up the whole screen. Phrase 1 runs the full width
      // and is stretched down the screen; phrase 2 runs the full height and
      // is stretched across. A phrase too short to reach is repeated.
      regions = msgs.map((m) => {
        const slot = pageSlot(m.edge);
        m.text = repeatToFill(m.text, slot);
        return { c: [MID, MID], bw: slot.width, mb: slot.maxBand, track: 0.7, exact: true };
      });
    } else {
      // Split: each message gets its own half of the cloth, so the two
      // never overlap and each reads cleanly.
      const q4 = ext(A.R) / 4 + 4;
      regions = msgs.map((m, i) => {
        const e = EDGES[m.edge];
        const s = i === 0 ? -q4 : q4;
        const d = [s * A.R[0], s * A.R[1]];
        return i === 0
          ? { c: at(d, j.u * 20, 0, e), bw: ext(e.R) * 0.44, mb: ext(e.U) * 0.67 }
          : { c: at(d, 0, j.r * 20, e), bw: ext(e.R) * 0.9, mb: ext(e.U) * 0.34 };
      });
    }
    const glyphs = [];
    const info = msgs.map((m, i) => {
      const e = EDGES[m.edge];
      const rnd = mulberry32((weave.seed + 0x9e3779b9 * (i + 1)) >>> 0);
      const sizeJitter = regions[i].exact ? 1 : 0.94 + 0.06 * (i ? 1 - j.band : j.band);
      const g = layoutSolid(m.text, regions[i].bw, regions[i].mb, rnd, sizeJitter, regions[i].track);
      if (!g) return null;
      glyphs.push({ lines: g.lines, extras: g.extras, box: g.box, font: g.font, em: g.em, St: g.St, ox: regions[i].c[0], oy: regions[i].c[1], U: e.U, R: e.R });
      return { textW: g.textW, bandLen: g.bandLen, lines: g.text, St: g.St, edge: m.edge };
    });
    return { glyphs, q, frame: frame || { x: MID, y: MID, k: 1 }, key: cardKey(card), info, card };
  }

  // ---------------------------------------------------------------- scene
  function rebuild({ fadeMs = 0, newWeave = true } = {}) {
    pageCache.clear(); // pages depend on the settings and the screen
    const weave = newWeave || !scene ? buildWeave(state.seed) : scene.weave;
    // an existing message stays where it was woven; a new one goes mid-screen
    const frame = scene && scene.msg ? scene.msg.frame : currentFrame();
    const msg = state.revealed ? buildMessage(currentCard(), weave, quadrant(), frame) : null;
    setScene({ weave, msg }, fadeMs);
  }
  function setScene(next, fadeMs) {
    if (scene && fadeMs > 0) fade = { prev: scene, start: performance.now(), dur: fadeMs };
    else fade = null;
    scene = next;
    requestDraw();
  }

  /**
   * After a gesture settles: weave the message in (the first time a card is
   * input) or reweave it if the card changed. It is always laid out for the
   * view as it is now: mid-screen, upright, sized to fit.
   */
  function commit(fadeMs) {
    if (!scene) return;
    updateIndicator();
    if (!state.revealed) return;
    const card = currentCard();
    const q = quadrant();
    if (!scene.msg || cardKey(card) !== scene.msg.key) {
      const dur = fadeMs !== undefined ? fadeMs : (scene.msg ? 380 : 900);
      setScene({ weave: scene.weave, msg: buildMessage(card, scene.weave, q, currentFrame()) }, dur);
    } else if (scene.msg.q !== q) {
      // Same card ⇒ same suit ⇒ q differs by whole turns: visually identical.
      // (Once locked the message is part of the sheet and turns with it.)
      if (!state.locked) scene.msg.q = q;
    }
  }

  // ---------------------------------------------------------------- rendering
  function screenAngle() {
    if (!S.holdOrientation) return 0;
    const so = window.screen && window.screen.orientation;
    if (so && typeof so.angle === 'number') return so.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const top = document.getElementById('top').getBoundingClientRect().bottom;
    const bottom = document.getElementById('bottom').getBoundingClientRect().top;
    const avail = Math.max(120, bottom - top);
    // Fit the cloth's height to the screen's long axis (as the phone is held);
    // on a portrait phone the sides of the weave run off the screen.
    const turned = Math.abs(screenAngle()) % 180 === 90;
    const physW = turned ? avail : w;
    const physH = turned ? w : avail;
    const fit = Math.min(physW, physH) * 0.96 / (CLOTH + 40);
    const prevVis = view.visW, prevVisH = view.visH;
    view = {
      w, h, dpr, fit,
      cx: w / 2,
      cy: top + avail / 2,
      visW: physW / fit,
      visH: physH / fit,
    };
    if (scene && (Math.abs((prevVis || 0) - view.visW) > 1 || Math.abs((prevVisH || 0) - view.visH) > 1)) {
      pageCache.clear();
      const old = scene.msg;
      scene = { weave: scene.weave, msg: old ? buildMessage(currentCard(), scene.weave, old.q, old.frame) : null };
      fade = null;
    }
    requestDraw();
  }

  const msgTransform = (c, m) => {
    c.translate(m.frame.x, m.frame.y);
    c.rotate(-m.q * Q);
    c.scale(m.frame.k, m.frame.k);
    c.translate(-MID, -MID);
  };
  // local x → reading direction R; local y (down the glyph) → −U, ×St
  const glyphTransform = (c, g) => c.transform(g.R[0], g.R[1], -g.U[0] * g.St, -g.U[1] * g.St, g.ox, g.oy);

  /**
   * Where the loom must keep clear of the message. A thread only gets in the
   * way of the phrase that is stretched along it (tilted, it would look like
   * a letter stem), so each layer is cleared from that phrase's box only and
   * runs right up to the block everywhere else.
   */
  function clearZones(sc, dir) {
    const m = sc && sc.msg;
    if (!m) return [];
    const turned = mod(m.q, 2) === 1;
    return m.glyphs
      .filter((g) => ((Math.abs(g.U[1]) > 0.5) !== turned) === (dir === 0))
      .map((g) => ({ m, g }));
  }
  /** Image coordinates → canvas pixels for view V. */
  function worldTransform(c, V) {
    const k = V.px * V.zoom;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.translate(V.cx, V.cy);
    c.rotate(V.rot);
    c.scale(k, k);
    c.translate(-V.camX, -V.camY);
  }
  function addZone(c, V, z) {
    const b = z.g.box;
    c.save();
    worldTransform(c, V);
    msgTransform(c, z.m);
    glyphTransform(c, z.g);
    c.rect(-b.hw, -b.up, b.hw * 2, b.up + b.down);
    c.restore();
  }
  /**
   * Draw one stretched phrase. `vis` = [x0, x1, u0, u1]: the part of it on
   * screen, along its reading direction and along its stretch axis (layout
   * units from its centre). Letters outside are skipped.
   */
  function drawGlyphs(c, g, vis) {
    c.save();
    glyphTransform(c, g);
    c.font = g.font;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const onScreen = !vis || (vis[2] < g.box.up * g.St && vis[3] > -g.box.down * g.St);
    for (const ln of g.lines) {
      if (!onScreen) break;
      for (const o of ln.chars) {
        if (vis && (o.x > vis[1] || o.x + g.em * 1.2 < vis[0])) continue;
        c.fillText(o.ch, o.x, ln.y);
      }
    }
    c.fill(g.extras); // run-on stems and the redrawn k's
    c.restore();
  }

  /**
   * One layer of the loom (dir 0 = the phrases stretched down the image,
   * 1 = those stretched across), for whatever pages are on screen. Near the
   * zoom where one scale of pages hands over to the next, both are drawn and
   * crossfaded.
   */
  function paintLoom(c, V, seed, dir, alpha) {
    if (!S.loomOn || alpha <= 0) return;
    const theme = THEMES[S.theme] || THEMES.linen;
    const k = V.px * V.zoom;
    // the screen's bounding box in image coordinates
    const cos = Math.cos(-V.rot), sin = Math.sin(-V.rot);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of [[0, 0], [V.w, 0], [V.w, V.h], [0, V.h]]) {
      const dx = (x - V.cx) / k, dy = (y - V.cy) / k;
      const wx = V.camX + dx * cos - dy * sin, wy = V.camY + dx * sin + dy * cos;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx);
      y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    const lz = Math.log2(V.zoom);
    const L0 = Math.round(lz), d = lz - L0;        // d in [-0.5, 0.5]
    const near = 0.5 - Math.abs(d);                // 0 right at the hand-over
    const scales = [[L0, 1]];
    if (near < 0.08) {
      const t = 0.5 + (0.5 * near) / 0.08;
      scales[0][1] = t;
      scales.push([L0 + (d > 0 ? 1 : -1), 1 - t]);
    }
    const W = view.visW * 0.97, H = view.visH * 0.97;
    c.save();
    c.fillStyle = theme.ink;
    for (const [L, a] of scales) {
      const sc = Math.pow(2, -L);
      const cw = W * sc, ch = H * sc;
      const pad = 0.6; // lettering runs on past its page a little
      const i0 = Math.floor((x0 - MID) / cw + 0.5 - pad), i1 = Math.ceil((x1 - MID) / cw - 0.5 + pad);
      const j0 = Math.floor((y0 - MID) / ch + 0.5 - pad), j1 = Math.ceil((y1 - MID) / ch - 0.5 + pad);
      c.globalAlpha = alpha * a;
      for (let ci = i0; ci <= i1; ci++) {
        for (let cj = j0; cj <= j1; cj++) {
          const px = MID + ci * cw, py = MID + cj * ch;
          for (const g of loomPage(seed, L, ci, cj).glyphs) {
            if ((Math.abs(g.U[1]) > 0.5) !== (dir === 0)) continue;
            // which of its letters are on screen
            const ax = (x0 - px) / sc, bx = (x1 - px) / sc, ay = (y0 - py) / sc, by = (y1 - py) / sc;
            const p = ax * g.R[0] + ay * g.R[1], q = bx * g.R[0] + by * g.R[1];
            const up = ax * g.U[0] + ay * g.U[1], uq = bx * g.U[0] + by * g.U[1];
            worldTransform(c, V);
            c.translate(px, py);
            c.scale(sc, sc);
            c.translate(-MID, -MID);
            drawGlyphs(c, g, [Math.min(p, q), Math.max(p, q), Math.min(up, uq), Math.max(up, uq)]);
          }
        }
      }
    }
    c.restore();
  }

  /** Paint one layer of the loom, optionally only inside one zone, and outside others. */
  function fillLayer(c, V, seed, dir, alpha, inside, outside) {
    if (alpha <= 0) return;
    c.save();
    if (inside) {
      c.beginPath();
      addZone(c, V, inside);
      c.clip();
    }
    for (const z of outside) {
      c.beginPath();
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.rect(0, 0, V.w, V.h);
      c.restore();
      addZone(c, V, z);
      c.clip('evenodd');
    }
    paintLoom(c, V, seed, dir, alpha);
    c.restore();
  }

  /**
   * The loom. With `prev` (a scene on the same weave) and 0 ≤ e ≤ 1 it draws
   * a crossfade: lettering outside every clear zone stays steady, and only
   * what is entering or leaving a zone fades.
   */
  function drawSheet(c, sc, alpha, V, prev = null, e = 1) {
    const seed = sc.weave.seed;
    for (const dir of [0, 1]) {
      const now = clearZones(sc, dir), was = clearZones(prev, dir);
      fillLayer(c, V, seed, dir, alpha, null, [...now, ...was]);
      if (!prev) continue;
      for (const z of now) fillLayer(c, V, seed, dir, alpha * (1 - e), z, was); // being cleared
      for (const z of was) fillLayer(c, V, seed, dir, alpha * e, z, now);       // growing back
    }
  }

  /** The hidden message, if it has been woven in. */
  function drawMsg(c, sc, alpha, V) {
    const m = sc.msg;
    if (!m || alpha <= 0) return;
    const theme = THEMES[S.theme] || THEMES.linen;
    c.save();
    worldTransform(c, V);
    c.globalAlpha = alpha;
    msgTransform(c, m);
    c.fillStyle = theme.ink;
    for (const g of m.glyphs) drawGlyphs(c, g, null);
    c.restore();
  }

  function drawScene(c, sc, alpha, V) {
    drawSheet(c, sc, alpha, V);
    drawMsg(c, sc, alpha, V);
  }

  /** The view the main canvas shows right now. */
  function mainView() {
    const f = currentFrame();
    return {
      w: canvas.width, h: canvas.height,
      cx: view.cx * view.dpr, cy: view.cy * view.dpr,
      rot: state.theta - (screenAngle() * Math.PI) / 180,
      zoom: state.s, px: view.fit * view.dpr,
      camX: f.x, camY: f.y,
    };
  }

  function render(now) {
    const theme = THEMES[S.theme] || THEMES.linen;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!scene) return;
    let t = 1;
    if (fade) {
      t = clamp((now - fade.start) / fade.dur, 0, 1);
      if (t >= 1) fade = null;
    }
    const V = mainView();
    if (!fade) { drawScene(ctx, scene, 1, V); return; }
    const e = easeOut(t);
    if (fade.prev.weave === scene.weave) {
      // same loom, only the message changes: keep the threads steady
      drawSheet(ctx, scene, 1, V, fade.prev, e);
      drawMsg(ctx, fade.prev, 1 - e, V);
      drawMsg(ctx, scene, e, V);
    } else {
      drawScene(ctx, fade.prev, 1 - e, V);
      drawScene(ctx, scene, e, V);
    }
  }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    stepAnim(now);
    render(now);
    if (anim || fade) requestDraw();
  }

  // ---------------------------------------------------------------- settle animation
  function stepAnim(now) {
    if (!anim) return;
    const t = clamp((now - anim.start) / anim.dur, 0, 1);
    const e = easeOut(t);
    state.theta = lerp(anim.from.theta, anim.to.theta, e);
    state.s = lerp(anim.from.s, anim.to.s, e);
    state.pan.x = lerp(anim.from.px, anim.to.px, e);
    state.pan.y = lerp(anim.from.py, anim.to.py, e);
    if (t >= 1) {
      const done = anim.done;
      anim = null;
      if (done) done();
    }
  }
  function animateTo(to, dur, done) {
    anim = {
      start: performance.now(), dur,
      from: { theta: state.theta, s: state.s, px: state.pan.x, py: state.pan.y },
      to: {
        theta: to.theta ?? state.theta, s: to.s ?? state.s,
        px: to.px ?? state.pan.x, py: to.py ?? state.pan.y,
      },
      done,
    };
    requestDraw();
  }

  function settle() {
    const theta = quadrant() * Q;
    const s = clamp(state.s, ZOOM_MIN, ZOOM_MAX);
    const lim = ROAM * view.fit * s;
    const px = clamp(state.pan.x, -lim, lim), py = clamp(state.pan.y, -lim, lim);
    const moved = Math.abs(theta - state.theta) > 1e-4 || Math.abs(s - state.s) > 1e-4 ||
      px !== state.pan.x || py !== state.pan.y;
    if (moved) animateTo({ theta, s, px, py }, 260, () => commit());
    else commit();
  }

  // ---------------------------------------------------------------- secret input
  let lastHapticAt = 0;
  function haptic() {
    if (!S.haptics) return;
    const now = performance.now();
    if (now - lastHapticAt < 35) return;
    lastHapticAt = now;
    try {
      if (navigator.vibrate) navigator.vibrate(9);
      else hap.click();
    } catch (_) { /* ignore */ }
  }

  function stepValue(d) {
    if (state.locked) return; // locked in: gestures only move the picture
    state.value = mod(state.value + d, 13);
    if (S.revealOn === 'input') state.revealed = true;
    haptic();
    updateIndicator();
    if (S.liveUpdate) liveRebuild();
  }

  let lastQuadrant = 0;
  function trackQuadrant() {
    const q = quadrant();
    if (q !== lastQuadrant) {
      lastQuadrant = q;
      if (state.locked) return;
      if (S.revealOn === 'input') state.revealed = true;
      haptic();
      updateIndicator();
      if (S.liveUpdate) liveRebuild();
    }
  }

  /**
   * Double-tap: lock the revelation in. The card can no longer change, the
   * message stays woven into the loom where it is, and pinching and turning
   * just move the picture. Reweave clears it.
   */
  function lockIn() {
    if (state.locked || !scene) return;
    state.locked = currentCard();
    state.revealed = true;
    commit();
    try { if (S.haptics && navigator.vibrate) navigator.vibrate([12, 60, 12]); else { lastHapticAt = 0; haptic(); } } catch (_) { /* ignore */ }
    updateIndicator();
  }
  /** Bring the woven message back to the middle of the screen, upright. */
  function recentre() {
    const to = { s: 1, px: 0, py: 0, theta: quadrant() * Q };
    if (scene && scene.msg) {
      const m = scene.msg, f = m.frame;
      to.theta = m.q * Q + Math.round((state.theta - m.q * Q) / (4 * Q)) * 4 * Q;
      const a = to.theta - (screenAngle() * Math.PI) / 180;
      to.s = 1 / f.k;
      const kv = view.fit * to.s;
      const ux = (f.x - MID) * kv, uy = (f.y - MID) * kv;
      to.px = -(ux * Math.cos(a) - uy * Math.sin(a));
      to.py = -(ux * Math.sin(a) + uy * Math.cos(a));
    }
    animateTo(to, 320, () => commit());
  }

  function liveRebuild() {
    // keep the message in its current frame while the fingers are down
    if (!scene || !scene.msg) return; // nothing woven yet: it appears on release
    const card = currentCard();
    if (cardKey(card) === scene.msg.key) return;
    setScene({ weave: scene.weave, msg: buildMessage(card, scene.weave, scene.msg.q, scene.msg.frame) }, 140);
  }

  function updateIndicator() {
    const c = currentCard();
    const v = VALUES[c.value];
    const suitIdx = suitKeys().indexOf(c.suitKey);
    ind.dataset.card = cardKey(c);
    ind.classList.toggle('locked', !!state.locked);
    switch (S.indicator) {
      case 'card':
        ind.textContent = `${v.short}${SUITS[c.suitKey].sym}`;
        break;
      case 'code':
        ind.textContent = `no. ${String(c.value + 1).padStart(2, '0')}·${suitIdx + 1}`;
        break;
      case 'dots': {
        let html = '<span class="dots">';
        for (let i = 0; i < 4; i++) html += `<i class="${i === suitIdx ? 'on' : ''}"></i>`;
        html += '<span class="sep"></span>';
        for (let i = 0; i < 13; i++) html += `<i class="${i === c.value ? 'on' : ''}"></i>`;
        ind.innerHTML = html + '</span>';
        break;
      }
      default:
        ind.textContent = '';
    }
  }

  // ---------------------------------------------------------------- gestures
  const pointers = new Map();
  let G = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  function pts() { return [...pointers.values()]; }

  function beginGesture() {
    const P = pts();
    if (P.length === 0) { G = null; return; }
    if (P.length === 1) {
      G = { n: 1, p0: { ...P[0] }, pan0: { ...state.pan }, moved: false, t0: performance.now() };
      return;
    }
    const [a, b] = P;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    G = {
      n: 2,
      c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      d0: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)),
      angPrev: ang, dAng: 0,
      pan0: { ...state.pan }, s0: state.s, th0: state.theta,
      lock: null, lgFrozen: 0, angFrozen: 0, tickBase: 0,
    };
  }

  function moveGesture() {
    if (!G) return;
    const P = pts();
    if (G.n === 1) {
      const p = P[0];
      const dx = p.x - G.p0.x, dy = p.y - G.p0.y;
      if (Math.hypot(dx, dy) > 6) G.moved = true;
      state.pan.x = G.pan0.x + dx;
      state.pan.y = G.pan0.y + dy;
      requestDraw();
      return;
    }
    const [a, b] = P;
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y));
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    G.dAng += wrapPi(ang - G.angPrev);
    G.angPrev = ang;
    const lg = Math.log(d / G.d0);

    if (S.gestureLock && !G.lock) {
      if (Math.abs(G.dAng) > (15 * Math.PI) / 180) { G.lock = 'rotate'; G.lgFrozen = lg; }
      else if (Math.abs(lg) > Math.log(1.1)) { G.lock = 'pinch'; G.angFrozen = G.dAng; }
    }
    let effLog = lg, effAng = G.dAng;
    if (G.lock === 'rotate') effLog = G.lgFrozen;
    if (G.lock === 'pinch') effAng = G.angFrozen;

    // value ticks
    if (!S.gestureLock || G.lock === 'pinch') {
      const st = Math.log(S.pinchStep);
      while (lg - G.tickBase >= st) { G.tickBase += st; stepValue(+1); }
      while (lg - G.tickBase <= -st) { G.tickBase -= st; stepValue(-1); }
    }

    // visual transform, anchored at the finger centroid
    state.theta = G.th0 + effAng;
    state.s = clamp(G.s0 * Math.exp(effLog), ZOOM_MIN / 1.25, ZOOM_MAX * 1.25);
    const ratio = state.s / G.s0;
    const rot = state.theta - G.th0;
    const P0x = view.cx + G.pan0.x, P0y = view.cy + G.pan0.y;
    const vx = (G.c0.x - P0x) * ratio, vy = (G.c0.y - P0y) * ratio;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    state.pan.x = c.x - (vx * cos - vy * sin) - view.cx;
    state.pan.y = c.y - (vx * sin + vy * cos) - view.cy;
    trackQuadrant();
    requestDraw();
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic / already gone */ }
    requestWakeLock();
    if (anim) { anim = null; } // grab mid-animation: keep current pose
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture();
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moveGesture();
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = G && G.n === 1 && pointers.size === 1;
    const tapLike = wasSingle && !G.moved && performance.now() - G.t0 < 280;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) { beginGesture(); return; }
    G = null;
    if (tapLike) {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap.t = 0;
        // first double-tap locks the revelation in; after that it recentres
        if (!state.locked) { lockIn(); settle(); } else recentre();
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    settle();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) onUp(e); });

  // Stop the browser from zooming / scrolling the page itself.
  const stop = (e) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!setupDlg.open) e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!setupDlg.open) e.preventDefault(); });

  // Desktop: wheel = pinch, shift/alt + wheel = rotate.
  let wheelG = null, wheelTimer = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (anim) anim = null;
    if (!wheelG) wheelG = { lg: 0, tickBase: 0, ang: 0, th0: state.theta };
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.shiftKey || e.altKey) {
      wheelG.ang += delta * 0.004;
      state.theta = wheelG.th0 + wheelG.ang;
      trackQuadrant();
    } else {
      const dl = -delta * 0.0022;
      wheelG.lg += dl;
      state.s = clamp(state.s * Math.exp(dl), ZOOM_MIN / 1.25, ZOOM_MAX * 1.25);
      const st = Math.log(S.pinchStep);
      while (wheelG.lg - wheelG.tickBase >= st) { wheelG.tickBase += st; stepValue(+1); }
      while (wheelG.lg - wheelG.tickBase <= -st) { wheelG.tickBase -= st; stepValue(-1); }
    }
    requestDraw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelG = null; settle(); }, 260);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (setupDlg.open) return;
    switch (e.key) {
      case 'ArrowUp': stepValue(+1); commit(); break;
      case 'ArrowDown': stepValue(-1); commit(); break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const target = (quadrant() + (e.key === 'ArrowRight' ? 1 : -1)) * Q;
        animateTo({ theta: target }, 260, () => commit());
        // count the suit change at once
        const saved = state.theta; state.theta = target; trackQuadrant(); state.theta = saved;
        break;
      }
      case 'r': case 'R': reweave(); break;
      case 's': case 'S': openSetup(); break;
      default: return;
    }
    e.preventDefault();
  });

  // ---------------------------------------------------------------- reweave
  function reweave() {
    state.seed = newSeed();
    if (state.locked) {
      // unlock, keeping the indicator on the card that was locked
      const card = state.locked;
      state.locked = null;
      state.value = card.value;
      state.suitOffset = mod(S.suitOrder.indexOf(card.suitKey) - quadrant(), 4);
    }
    state.revealed = S.revealOn === 'start'; // back to a bare loom
    rebuild({ fadeMs: 650 });
    updateIndicator();
  }
  document.getElementById('reweave').addEventListener('click', reweave);

  // ---------------------------------------------------------------- wake lock
  let wakeLock = null;
  async function requestWakeLock() {
    if (wakeLock || !('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { wakeLock = null; requestWakeLock(); }
  });

  // ---------------------------------------------------------------- setup panel
  const setupDlg = document.getElementById('setup');
  const form = document.getElementById('setup-form');

  function fillForm() {
    for (const [k, v] of Object.entries(S)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
    updateOutputs();
  }
  function updateOutputs() {
    form.elements.stretchOut.value = `${(+S.stretch).toFixed(0)}× · view at ~${(Math.asin(1 / S.stretch) * 180 / Math.PI).toFixed(1)}°`;
    form.elements.densityOut.value = `${Math.round(S.density * 100)}%`;
    form.elements.weightOut.value = `${Math.round(S.weight)}`;
    form.elements.pinchStepOut.value = `${Math.round((S.pinchStep - 1) * 100)}%`;
  }
  function readForm() {
    const next = { ...S };
    for (const k of Object.keys(DEFAULTS)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') next[k] = el.checked;
      else if (el.type === 'range') next[k] = parseFloat(el.value);
      else next[k] = el.value;
    }
    return next;
  }

  let formTimer = 0;
  form.addEventListener('input', () => {
    const before = S;
    S = readForm();
    updateOutputs();
    applyTheme();
    saveSettings();
    // keep the same card when the suit order changes
    if (before.suitOrder !== S.suitOrder) {
      const c = cardWith(before.suitOrder);
      state.suitOffset = mod(S.suitOrder.indexOf(c) - quadrant(), 4);
    }
    if (S.revealOn === 'start') state.revealed = true;
    clearTimeout(formTimer);
    formTimer = setTimeout(() => { rebuild({ newWeave: true }); updateIndicator(); drawPreviews(); }, 60);
  });
  function cardWith(order) { return order[mod(state.suitOffset + quadrant(), 4)]; }

  document.getElementById('reset-defaults').addEventListener('click', () => {
    S = { ...DEFAULTS };
    saveSettings();
    fillForm();
    applyTheme();
    rebuild();
    updateIndicator();
    drawPreviews();
  });

  function openSetup() {
    if (setupDlg.open) return;
    fillForm();
    setupDlg.showModal();
    requestAnimationFrame(drawPreviews);
  }
  setupDlg.addEventListener('close', () => { rebuild({ newWeave: false }); });

  // long-press the wordmark
  const mark = document.getElementById('mark');
  let pressTimer = 0;
  mark.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    clearTimeout(pressTimer);
    pressTimer = setTimeout(openSetup, 650);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    mark.addEventListener(ev, () => clearTimeout(pressTimer));
  }

  /** Simulated foreshortening: what the eye sees from `edge` at a grazing angle. */
  function drawPreview(cv, edge, fitHeight = false) {
    if (!scene) return;
    // Before a card is input nothing is woven in; preview what would be.
    const sc = scene.msg ? scene
      : { weave: scene.weave, msg: buildMessage(currentCard(), scene.weave, quadrant(), currentFrame()) };
    const m = sc.msg;
    const info = (m.info || []).find((i) => i && i.edge === edge);
    const St = info ? info.St : S.stretch;
    // The message fills the screen, so the preview shows one screen's worth:
    // the long way of the phrase across, the stretched way squashed.
    const sideways = Math.abs(EDGES[edge].U[0]) > 0.5;
    // (the setup panel's small previews show the first 900 units of a long line)
    const cropW = fitHeight ? Math.min(900, sideways ? view.visH : view.visW) : (sideways ? view.visH : view.visW);
    const need = sideways ? view.visW : view.visH;    // units along the stretched axis
    const full = sideways ? view.visH : view.visW;    // the whole line
    const span = Math.max(full, need) + 40;           // layout units rendered, square
    const scale = cv.width / cropW;                   // preview px per unit, across
    if (fitHeight) cv.height = Math.round((need / St) * scale) + 20;
    const size = 1600;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const c = off.getContext('2d');
    const theme = THEMES[S.theme] || THEMES.linen;
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, size, size);
    const k = size / span;
    drawScene(c, sc, 1, {
      w: size, h: size, cx: size / 2, cy: size / 2,
      rot: EDGES[edge].toBottom + m.q * Q,
      zoom: 1 / m.frame.k, px: k,
      camX: m.frame.x, camY: m.frame.y,
    });
    const out = cv.getContext('2d');
    out.fillStyle = theme.bg;
    out.fillRect(0, 0, cv.width, cv.height);
    const dh = (need / St) * scale;
    out.imageSmoothingQuality = 'high';
    out.drawImage(off, ((span - full) / 2) * k, ((span - need) / 2) * k, cropW * k, need * k,
      0, (cv.height - dh) / 2, cv.width, dh);
  }
  function drawPreviews() {
    if (!setupDlg.open) return;
    for (const id of ['pv-a', 'pv-b']) document.getElementById(id).width = 640;
    drawPreview(document.getElementById('pv-a'), S.edgeA, true);
    drawPreview(document.getElementById('pv-b'), S.edgeB, true);
    document.getElementById('pv-a-cap').textContent = `Phrase 1 · from the ${S.edgeA} edge`;
    document.getElementById('pv-b-cap').textContent = `Phrase 2 · from the ${S.edgeB} edge`;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = S.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = (THEMES[S.theme] || THEMES.linen).bg;
  }

  // ---------------------------------------------------------------- boot
  function init() {
    if (S.startCard === 'first') {
      state.value = 0;
      state.suitOffset = 0;
    } else {
      state.value = Math.floor(Math.random() * 13);
      state.suitOffset = Math.floor(Math.random() * 4);
    }
    state.revealed = S.revealOn === 'start';
    applyTheme();
    resize();
    rebuild();
    updateIndicator();
    if (/[?&#]setup\b/.test(location.search + location.hash)) openSetup();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (window.screen?.orientation?.addEventListener) {
    window.screen.orientation.addEventListener('change', () => setTimeout(resize, 60));
  }

  // Test / debugging hook.
  window.loom = {
    get state() { return { ...state, card: cardKey(currentCard()), phrase: cardPhrase(currentCard()) }; },
    get scene() { return scene; },
    bench(n = 20) { const t = performance.now(); for (let i = 0; i < n; i++) render(performance.now()); return (performance.now() - t) / n; },
    lockIn, recentre,
    settings: () => ({ ...S }),
    setCard(value, suitKey) {
      state.value = mod(value, 13);
      state.suitOffset = mod(S.suitOrder.indexOf(suitKey) - quadrant(), 4);
      state.revealed = true;
      commit(0);
    },
    preview(edge, w = 640, h = 260) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      drawPreview(cv, edge);
      return cv.toDataURL('image/png');
    },
    reweave,
  };

  // The words are canvas text, so the font must be loaded before the first draw.
  if (document.fonts && document.fonts.load) {
    const timeout = new Promise((res) => setTimeout(res, 2500));
    Promise.race([document.fonts.load(`${S.weight} 100px "Loom Thread"`, 'YOU'), timeout])
      .catch(() => {})
      .then(init);
    // If the font arrives late (slow connection), reweave the words with it.
    document.fonts.ready.then(() => { stemCache.clear(); if (scene) rebuild({ newWeave: false }); });
  } else init();
})();
