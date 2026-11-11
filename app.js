/*
 * loom — a tilt-to-read card revelation.
 *
 * The picture is a "weave" of threads drawn on a 1000 × 1000 unit canvas.
 * Two hidden messages are woven in:
 *   – Each message is rasterised as ordinary text, then sampled column by
 *     column on a fixed thread grid. Every run of ink becomes one thread,
 *     stretched S times along the reading axis. Viewed at a grazing angle
 *     from the right edge of the phone, the foreshortening squashes the
 *     threads back into letters.
 *   – Decoy threads (long warp/weft lines, diagonals, fringe) hide the text.
 *
 * Secret input:
 *   – Pinch: each `pinchStep` change of finger distance steps the value.
 *   – Rotate: every quarter turn steps the suit (the image snaps to 90°).
 * When the fingers lift, the message is rewoven for the new card.
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
  const MASK_RES = 2; // mask pixels per (unstretched) image unit
  const MAX_STRETCH = 40;

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
    phraseA: 'YOU WILL PICK',
    phraseB: 'THE {value} OF {suit}',
    edgeA: 'bottom',
    edgeB: 'left',
    valueStyle: 'words',
    letterCase: 'sentence',
    suitOrder: 'CHSD',
    pinchStep: 1.22,
    gestureLock: true,
    liveUpdate: false,
    haptics: true,
    indicator: 'card',
    startCard: 'random',
    stretch: 17,
    pitch: 6,
    density: 1,
    layout: 'overlap',
    letters: 'solid',
    weight: 400,
    theme: 'linen',
    holdOrientation: true,
  };
  const STORE_KEY = 'loom.settings.v4';

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
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) { /* storage unavailable */ }
    return { ...DEFAULTS };
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (_) { /* ignore */ }
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
  };

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const ind = document.getElementById('ind');
  const hap = document.getElementById('hap');
  let view = { w: 0, h: 0, dpr: 1, cx: 0, cy: 0, fit: 1 };

  let scene = null;    // { weave, msg }
  let fade = null;     // { prev, start, dur }
  let anim = null;     // settle animation
  let raf = 0;

  // ---------------------------------------------------------------- cards
  const suitKeys = () => S.suitOrder.split('');
  const quadrant = (theta = state.theta) => Math.round(theta / Q);
  function currentCard() {
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
  function clipToSquare(px, py, dx, dy, lo, hi) {
    let t0 = -Infinity, t1 = Infinity;
    for (const [p, d] of [[px, dx], [py, dy]]) {
      if (Math.abs(d) < 1e-9) continue;
      const a = (lo - p) / d, b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    return [t0, t1];
  }

  function buildWeave(seed) {
    const r = mulberry32(seed);
    const p = S.pitch;
    const dens = S.density;
    const half = Math.round(CLOTH / 2 / p) * p;
    const lo = MID - half, hi = MID + half;
    const span = hi - lo;
    const snap = (v) => MID + Math.round((v - MID) / p) * p;
    const thin = p * 0.34, mid = p * 0.5;

    const mk = () => [new Path2D(), new Path2D()]; // [thin, mid]
    const L = { dU: mk(), hA: mk(), wA: mk(), hB: mk(), wB: mk(), dO: mk() };
    const seg = (path, x0, y0, x1, y1) => { path.moveTo(x0, y0); path.lineTo(x1, y1); };
    const pick = (a, b) => (r() < 0.5 ? a : b);
    const overhang = () => (r() < 0.3 ? 30 + r() * 150 : 3 + r() * 16);

    // selvedge: the four edge threads
    seg(L.wA[1], lo, lo - overhang(), lo, hi + overhang());
    seg(L.wB[1], hi, lo - overhang(), hi, hi + overhang());
    seg(L.hA[1], lo - overhang(), lo, hi + overhang(), lo);
    seg(L.hB[1], lo - overhang(), hi, hi + overhang(), hi);

    // long warp (vertical) and weft (horizontal) threads, on the grid
    const nLong = Math.round((7 + r() * 5) * dens);
    for (let i = 0; i < nLong; i++) {
      const x = snap(lo + p + r() * (span - 2 * p));
      seg(pick(L.wA, L.wB)[r() < 0.6 ? 0 : 1], x, lo - overhang(), x, hi + overhang());
      const y = snap(lo + p + r() * (span - 2 * p));
      seg(pick(L.hA, L.hB)[r() < 0.6 ? 0 : 1], lo - overhang(), y, hi + overhang(), y);
    }

    // fringe: short loose threads along all four edges
    const fr = 0.3 * Math.min(1.4, dens);
    for (let v = lo; v <= hi + 0.01; v += p) {
      if (r() < fr) seg(pick(L.wA, L.wB)[0], v, lo - 6 - r() * 60, v, lo + r() * 12);
      if (r() < fr) seg(pick(L.wA, L.wB)[0], v, hi + 6 + r() * 60, v, hi - r() * 12);
      if (r() < fr) seg(pick(L.hA, L.hB)[0], lo - 6 - r() * 60, v, lo + r() * 12, v);
      if (r() < fr) seg(pick(L.hA, L.hB)[0], hi + 6 + r() * 60, v, hi - r() * 12, v);
    }

    // diagonals, kept well away from the two reading axes
    const nDiag = Math.round((8 + r() * 6) * dens);
    for (let i = 0; i < nDiag; i++) {
      const deg = 27 + r() * 36 + (r() < 0.5 ? 90 : 0);
      const a = (deg * Math.PI) / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      const px = lo + r() * span, py = lo + r() * span;
      const [t0, t1] = clipToSquare(px, py, dx, dy, lo - 4, hi + 4);
      if (!(t1 > t0)) continue;
      const len = t1 - t0;
      const ta = t0 + (r() < 0.55 ? 0 : r() * 0.35 * len);
      const tb = t1 - (r() < 0.55 ? 0 : r() * 0.35 * len);
      seg(r() < 0.6 ? L.dO[r() < 0.5 ? 0 : 1] : L.dU[r() < 0.5 ? 0 : 1],
        px + dx * ta, py + dy * ta, px + dx * tb, py + dy * tb);
    }

    const layers = (pair) => [{ path: pair[0], w: thin }, { path: pair[1], w: mid }];
    return {
      under: [...layers(L.dU), ...layers(L.hA), ...layers(L.wA), ...layers(L.hB), ...layers(L.wB)],
      over: layers(L.dO),
      // message placement jitter, so reweaving moves everything
      jitter: { u: (r() - 0.5) * 2, r: (r() - 0.5) * 2 },
    };
  }

  // ---------------------------------------------------------------- messages
  const maskCanvas = document.createElement('canvas');
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  function lineCandidates(text) {
    const t = text.replace(/[ \t]+/g, ' ').trim();
    if (!t) return [];
    if (/[|\n]/.test(t)) return [t.split(/\s*[|\n]\s*/).filter(Boolean)];
    const words = t.split(' ');
    const out = [[t]];
    for (let i = 1; i < words.length; i++) {
      out.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
    }
    return out;
  }

  /**
   * Size `text` the way tilt-to-read posters are made: set it as wide as the
   * box allows, then stretch it along the reading axis until it fills the
   * box's length. Each phrase gets its own stretch (never less than minS).
   */
  function fitText(text, budgetW, budgetL, minS, maxS) {
    mctx.font = `${S.weight} 100px ${FONT}`;
    let best = null;
    for (const lines of lineCandidates(text)) {
      let maxW = 0, asc = 0, desc = 0;
      for (const ln of lines) {
        const m = mctx.measureText(ln);
        maxW = Math.max(maxW, m.width);
        asc = Math.max(asc, m.actualBoundingBoxAscent || 72);
        desc = Math.max(desc, m.actualBoundingBoxDescent || 0);
      }
      const lineH = asc + desc;
      const gap = lineH * 0.45;
      const total = lines.length * lineH + (lines.length - 1) * gap;
      const k = Math.min(budgetW / maxW, budgetL / (minS * total));
      const St = clamp(budgetL / (total * k), minS, maxS);
      const score = k * (1 - 0.06 * (lines.length - 1)); // prefer fewer lines
      if (!best || score > best.score) best = { lines, k, St, maxW, asc, lineH, gap, total, score };
    }
    return best;
  }

  /**
   * Lay a phrase out the way the classic tilt-to-read images are built:
   * small, normal-weight, mostly lowercase type, stretched `S.stretch`× along
   * the reading axis only. The size is chosen so the stretched x-height band
   * fills ~80% of the box: the bodies of the letters form the dense block,
   * ascenders and descenders hang out of it as loose threads. Where a curved
   * stroke turns horizontal (tops of n, o, e, a…) the stretch makes it S×
   * thicker, which gives the fat tapered spikes at the top and bottom.
   */
  function layoutSolid(text, budgetW, budgetL) {
    const t = text.replace(/[ \t]+/g, ' ').trim();
    if (!t) return null;
    const lines = t.split(/\s*[|\n]\s*/).filter(Boolean);
    const n = lines.length;
    mctx.font = `${S.weight} 100px ${FONT}`;
    const xh = (mctx.measureText('x').actualBoundingBoxAscent || 52) / 100; // of the em
    const lineGap = 0.8;                       // gap between lines, in x-heights
    const band = budgetL * 0.8;                // stretched length of all x-height bands
    const bandLine = band / (n + (n - 1) * lineGap);
    const adv = lines.map((ln) => [...ln].map((ch) => mctx.measureText(ch).width / 100));
    const natW = Math.max(...adv.map((a) => a.reduce((x, v) => x + v, 0)));
    let em = bandLine / (S.stretch * xh);
    if (natW * em > budgetW) em = budgetW / natW; // long phrase: smaller type, more stretch
    const St = Math.min(MAX_STRETCH, bandLine / (xh * em));
    const xhU = (bandLine / St);               // x-height in unstretched units
    const pitch = xhU * (1 + lineGap);
    const total = n * xhU + (n - 1) * xhU * lineGap;
    let textW = 0;
    const out = lines.map((ln, i) => {
      const chars = [...ln];
      const w = adv[i].reduce((x, v) => x + v, 0) * em;
      // short phrases: open the letter-spacing a little so the block is not a sliver
      const track = chars.length > 1
        ? clamp((budgetW * 0.85 - w) / (chars.length - 1), 0, 0.1 * em) : 0;
      const full = w + track * (chars.length - 1);
      textW = Math.max(textW, full);
      let x = -full / 2;
      const placed = chars.map((ch, ci) => {
        const o = { ch, x };
        x += adv[i][ci] * em + track;
        return o;
      });
      return { chars: placed.filter((o) => o.ch !== ' '), y: -total / 2 + i * pitch + xhU };
    });
    return { lines: out, text: lines, font: `${S.weight} ${em}px ${FONT}`, St, textW, bandLen: total * St };
  }

  /**
   * Weave `text` so it can be read from `edgeName`; c is the band centre in
   * image units.
   *  – 'solid' letters: the real glyphs, stretched S× along the reading axis
   *    (for the default bottom edge that is a plain vertical stretch).
   *  – 'threads' letters: the glyphs sampled into parallel threads (added to
   *    `path`).
   */
  function weaveText(path, glyphs, text, edgeName, c, budgetW, budgetL) {
    const edge = EDGES[edgeName];
    if (S.letters !== 'threads') {
      const g = layoutSolid(text, budgetW, budgetL);
      if (!g) return null;
      glyphs.push({ lines: g.lines, font: g.font, St: g.St, ox: c[0], oy: c[1], U: edge.U, R: edge.R });
      return { textW: g.textW, bandLen: g.bandLen, lines: g.text, count: 0, St: g.St, edge: edgeName };
    }
    const p = S.pitch;
    const w = p * 0.6;
    const f = fitText(text, budgetW, budgetL, S.stretch, MAX_STRETCH);
    if (!f) return null;
    const St = f.St;

    const k = f.k;
    const textW = f.maxW * k;    // along R, image units
    const bandH = f.total * k;   // along U, unstretched units
    const pad = 4;
    const mw = Math.ceil(textW * MASK_RES) + pad * 2;
    const mh = Math.ceil(bandH * MASK_RES) + pad * 2;
    maskCanvas.width = mw;
    maskCanvas.height = mh;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = '#000';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'alphabetic';
    mctx.font = `${S.weight} ${100 * k * MASK_RES}px ${FONT}`;
    f.lines.forEach((ln, i) => {
      const y = pad + (i * (f.lineH + f.gap) + f.asc) * k * MASK_RES;
      mctx.fillText(ln, mw / 2, y);
    });
    const data = mctx.getImageData(0, 0, mw, mh).data;

    // Snap the band centre onto the thread grid along R.
    const [Ux, Uy] = edge.U, [Rx, Ry] = edge.R;
    const cr = (c[0] - MID) * Rx + (c[1] - MID) * Ry;
    const cu = (c[0] - MID) * Ux + (c[1] - MID) * Uy;
    const crSnap = Math.round(cr / p) * p;
    const ox = MID + crSnap * Rx + cu * Ux;
    const oy = MID + crSnap * Ry + cu * Uy;

    const halfWin = (p / 2) * MASK_RES;
    const thresh = 0.42 * 255;
    const kMax = Math.ceil(textW / 2 / p) + 1;
    let count = 0;
    for (let ki = -kMax; ki <= kMax; ki++) {
      const u = ki * p;
      const mx = pad + (u + textW / 2) * MASK_RES;
      const x0 = Math.max(0, Math.floor(mx - halfWin));
      const x1 = Math.min(mw, Math.ceil(mx + halfWin));
      if (x1 <= x0) continue;
      const n = x1 - x0;
      let runStart = -1;
      for (let y = 0; y <= mh; y++) {
        let on = false;
        if (y < mh) {
          let sum = 0;
          const row = y * mw * 4 + 3;
          for (let x = x0; x < x1; x++) sum += data[row + x * 4];
          on = sum / n >= thresh;
        }
        if (on && runStart < 0) runStart = y;
        else if (!on && runStart >= 0) {
          // rows [runStart, y) → offsets along U (stretched)
          const va = (runStart - pad) / MASK_RES, vb = (y - pad) / MASK_RES;
          let ta = (bandH / 2 - va) * St, tb = (bandH / 2 - vb) * St;
          if (ta - tb > w) { ta -= w / 2; tb += w / 2; } else { const m = (ta + tb) / 2; ta = tb = m; }
          path.moveTo(ox + u * Rx + ta * Ux, oy + u * Ry + ta * Uy);
          path.lineTo(ox + u * Rx + tb * Ux, oy + u * Ry + tb * Uy);
          count++;
          runStart = -1;
        }
      }
    }
    return { textW, bandLen: bandH * St, lines: f.lines, count, St, edge: edgeName };
  }

  function buildMessage(card, weave, q) {
    const vPath = new Path2D(); // warp (vertical threads)
    const hPath = new Path2D(); // weft (horizontal threads)
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
        return { c: at([s * A.U[0], s * A.U[1]], j.u * 10, j.r * 8, e), bw: ext(e.R) * 0.9, bl };
      });
    } else if (S.layout === 'overlap') {
      // Classic look: both messages cross in the centre.
      regions = msgs.map((m, i) => {
        const e = EDGES[m.edge];
        return { c: at([0, 0], j.u * 24 * (i ? -1 : 1), j.r * 14, e), bw: ext(e.R) * 0.9, bl: ext(e.U) * 0.84 };
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
          ? { c: at(d, j.u * 20, 0, e), bw: ext(e.R) * 0.44, bl: ext(e.U) * 0.84 }
          : { c: at(d, 0, j.r * 20, e), bw: ext(e.R) * 0.9, bl: ext(e.U) * 0.43 };
      });
    }
    const glyphs = [];
    const info = msgs.map((m, i) => weaveText(axisOf(m.edge) === 'v' ? vPath : hPath, glyphs,
      m.text, m.edge, regions[i].c, regions[i].bw, regions[i].bl));
    return { v: vPath, h: hPath, glyphs, q, key: cardKey(card), info, card };
  }

  // ---------------------------------------------------------------- scene
  function rebuild({ fadeMs = 0, newWeave = true } = {}) {
    const weave = newWeave || !scene ? buildWeave(state.seed) : scene.weave;
    const msg = buildMessage(currentCard(), weave, quadrant());
    setScene({ weave, msg }, fadeMs);
  }
  function setScene(next, fadeMs) {
    if (scene && fadeMs > 0) fade = { prev: scene, start: performance.now(), dur: fadeMs };
    else fade = null;
    scene = next;
    requestDraw();
  }

  /** After a gesture settles: reweave the message if the card changed. */
  function commit(fadeMs = 380) {
    if (!scene) return;
    const card = currentCard();
    const q = quadrant();
    if (cardKey(card) !== scene.msg.key) {
      setScene({ weave: scene.weave, msg: buildMessage(card, scene.weave, q) }, fadeMs);
    } else if (scene.msg.q !== q) {
      // Same card ⇒ same suit ⇒ q differs by whole turns: visually identical.
      scene.msg.q = q;
    }
    updateIndicator();
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
    const prevVis = view.visW;
    view = {
      w, h, dpr, fit,
      cx: w / 2,
      cy: top + avail / 2,
      visW: physW / fit,
    };
    if (scene && Math.abs((prevVis || 0) - view.visW) > 1) {
      scene = { weave: scene.weave, msg: buildMessage(currentCard(), scene.weave, scene.msg.q) };
      fade = null;
    }
    requestDraw();
  }

  function drawScene(c, sc, alpha, xf) {
    const theme = THEMES[S.theme] || THEMES.linen;
    const pad = S.pitch * 0.22;
    const msgW = S.pitch * 0.6;
    c.save();
    xf(c);
    c.globalAlpha = alpha;
    c.lineCap = 'round';
    const stroke = (path, w, halo = true) => {
      if (halo) {
        c.strokeStyle = theme.bg;
        c.lineWidth = w + 2 * pad;
        c.stroke(path);
      }
      c.strokeStyle = theme.ink;
      c.lineWidth = w;
      c.stroke(path);
    };
    for (const L of sc.weave.under) stroke(L.path, L.w);

    c.save();
    c.translate(MID, MID);
    c.rotate(-sc.msg.q * Q);
    c.translate(-MID, -MID);
    // halos for both message layers first, then ink, so the two messages
    // never cut each other (only the decoys underneath get "woven").
    c.strokeStyle = theme.bg;
    c.lineWidth = msgW + 2 * pad;
    c.stroke(sc.msg.h);
    c.stroke(sc.msg.v);
    c.strokeStyle = theme.ink;
    c.lineWidth = msgW;
    c.stroke(sc.msg.h);
    c.stroke(sc.msg.v);
    // Solid stretched words. Halos for every phrase first, then the ink, so
    // the crossing phrases never cut into each other.
    for (const pass of ['halo', 'ink']) {
      for (const g of sc.msg.glyphs) {
        c.save();
        // local x → reading direction R; local y (down the glyph) → −U, ×St
        c.transform(g.R[0], g.R[1], -g.U[0] * g.St, -g.U[1] * g.St, g.ox, g.oy);
        c.font = g.font;
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.lineJoin = 'round';
        c.lineWidth = pad * 0.9;
        c.strokeStyle = theme.bg;
        c.fillStyle = theme.ink;
        for (const ln of g.lines) {
          for (const o of ln.chars) {
            if (pass === 'halo') c.strokeText(o.ch, o.x, ln.y);
            else c.fillText(o.ch, o.x, ln.y);
          }
        }
        c.restore();
      }
    }
    c.restore();

    for (const L of sc.weave.over) stroke(L.path, L.w);
    c.restore();
  }

  function viewTransform(c) {
    const { dpr } = view;
    const k = view.fit * state.s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.translate(view.cx + state.pan.x, view.cy + state.pan.y);
    c.rotate(state.theta - (screenAngle() * Math.PI) / 180);
    c.scale(k, k);
    c.translate(-MID, -MID);
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
      if (t < 1) drawScene(ctx, fade.prev, 1 - easeOut(t), viewTransform);
      else fade = null;
    }
    drawScene(ctx, scene, t < 1 ? easeOut(t) : 1, viewTransform);
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
    const s = clamp(state.s, 0.6, 3.2);
    const limX = view.w * 0.45, limY = view.h * 0.4;
    const px = clamp(state.pan.x, -limX, limX), py = clamp(state.pan.y, -limY, limY);
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
    state.value = mod(state.value + d, 13);
    haptic();
    updateIndicator();
    if (S.liveUpdate) liveRebuild();
  }

  let lastQuadrant = 0;
  function trackQuadrant() {
    const q = quadrant();
    if (q !== lastQuadrant) {
      lastQuadrant = q;
      haptic();
      updateIndicator();
      if (S.liveUpdate) liveRebuild();
    }
  }

  function liveRebuild() {
    // keep the message in its current frame while the fingers are down
    if (!scene) return;
    const card = currentCard();
    if (cardKey(card) === scene.msg.key) return;
    setScene({ weave: scene.weave, msg: buildMessage(card, scene.weave, scene.msg.q) }, 140);
  }

  function updateIndicator() {
    const c = currentCard();
    const v = VALUES[c.value];
    const suitIdx = suitKeys().indexOf(c.suitKey);
    ind.dataset.card = cardKey(c);
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
    state.s = clamp(G.s0 * Math.exp(effLog), 0.3, 6);
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
        animateTo({ s: 1, px: 0, py: 0, theta: quadrant() * Q }, 300, () => commit());
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
      state.s = clamp(state.s * Math.exp(dl), 0.3, 6);
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
    form.elements.pitchOut.value = (+S.pitch).toFixed(1);
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
    if (fitHeight) {
      const inf = (scene.msg.info || []).find((i) => i && i.edge === edge);
      cv.height = Math.round((cv.width * 1.05) / (inf ? inf.St : S.stretch)) + 24;
    }
    const size = 900;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const c = off.getContext('2d');
    const theme = THEMES[S.theme] || THEMES.linen;
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, size, size);
    const k = size / (CLOTH + 60);
    drawScene(c, scene, 1, (cc) => {
      cc.setTransform(1, 0, 0, 1, 0, 0);
      cc.translate(size / 2, size / 2);
      cc.rotate(EDGES[edge].toBottom + scene.msg.q * Q);
      cc.scale(k, k);
      cc.translate(-MID, -MID);
    });
    const out = cv.getContext('2d');
    out.fillStyle = theme.bg;
    out.fillRect(0, 0, cv.width, cv.height);
    const info = (scene.msg.info || []).find((i) => i && i.edge === edge);
    const St = info ? info.St : S.stretch;
    const dw = cv.width * 1.05;
    const dh = (size / St) * (dw / size);
    out.imageSmoothingQuality = 'high';
    out.drawImage(off, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  }
  function drawPreviews() {
    if (!setupDlg.open) return;
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
    settings: () => ({ ...S }),
    setCard(value, suitKey) {
      state.value = mod(value, 13);
      state.suitOffset = mod(S.suitOrder.indexOf(suitKey) - quadrant(), 4);
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
    document.fonts.ready.then(() => { if (scene) rebuild({ newWeave: false }); });
  } else init();
})();
