/*
 * loom — a tilt-to-read card revelation.
 *
 * The picture is two phrases drawn on a 1000 × 1000 unit canvas, built the
 * way classic tilt-to-read images are:
 *   – Each phrase is small, light, mostly lowercase type, stretched ~24× along
 *     one axis only (phrase 1 vertically, phrase 2 horizontally) and laid over
 *     the other. Viewed at a grazing angle along that axis, foreshortening
 *     squashes it back into letters.
 *   – There are no separate decoy lines. The loose threads are letter stems
 *     (ascenders and descenders) that run on past the block.
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
  /**
   * There are no separate decoy lines. A "weave" is only the random numbers
   * that place the two phrases and decide which letter stems run on as loose
   * threads, so Reweave changes all of those at once.
   */
  function buildWeave(seed) {
    const r = mulberry32(seed);
    return { seed, jitter: { u: (r() - 0.5) * 2, r: (r() - 0.5) * 2, band: r() } };
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
  function layoutSolid(text, budgetW, maxBand, rnd, sizeJitter) {
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
      // only a touch of extra letter-spacing: tight letters hide the words better
      const track = chars.length > 1
        ? clamp((budgetW * 0.97 - w) / (chars.length - 1), 0, 0.05 * em) : 0;
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
    return { lines: out, extras, text: lines, font: `${S.weight} ${em}px ${FONT}`, St, textW, bandLen: total * St };
  }

  function buildMessage(card, weave, q) {
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
      // Classic look: the two phrases cross in the centre. Each is set to the
      // same width and then stretched along its own axis as far as the
      // stretch setting says, up to what the screen can show.
      const side = Math.min(ext(A.U), ext(A.R)) * 0.72;
      regions = msgs.map((m, i) => {
        const e = EDGES[m.edge];
        // Across the screen there is less room: the ascenders and descenders
        // (about 0.4 of the block each side) must mostly stay on screen, or an
        // h reads as an n. Down the screen there is plenty.
        const room = Math.abs(e.U[0]) > 0.5 ? view.visW * 0.676 : view.visH * 0.56;
        return { c: at([0, 0], j.u * 22 * (i ? -1 : 1), j.r * 16, e), bw: side, mb: room };
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
      const sizeJitter = 0.94 + 0.06 * (i ? 1 - j.band : j.band);
      const g = layoutSolid(m.text, regions[i].bw, regions[i].mb, rnd, sizeJitter);
      if (!g) return null;
      glyphs.push({ lines: g.lines, extras: g.extras, font: g.font, St: g.St, ox: regions[i].c[0], oy: regions[i].c[1], U: e.U, R: e.R });
      return { textW: g.textW, bandLen: g.bandLen, lines: g.text, St: g.St, edge: m.edge };
    });
    return { glyphs, q, key: cardKey(card), info, card };
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
    const prevVis = view.visW, prevVisH = view.visH;
    view = {
      w, h, dpr, fit,
      cx: w / 2,
      cy: top + avail / 2,
      visW: physW / fit,
      visH: physH / fit,
    };
    if (scene && (Math.abs((prevVis || 0) - view.visW) > 1 || Math.abs((prevVisH || 0) - view.visH) > 1)) {
      scene = { weave: scene.weave, msg: buildMessage(currentCard(), scene.weave, scene.msg.q) };
      fade = null;
    }
    requestDraw();
  }

  function drawScene(c, sc, alpha, xf) {
    const theme = THEMES[S.theme] || THEMES.linen;
    c.save();
    xf(c);
    c.globalAlpha = alpha;
    c.translate(MID, MID);
    c.rotate(-sc.msg.q * Q);
    c.translate(-MID, -MID);
    c.fillStyle = theme.ink;
    for (const g of sc.msg.glyphs) {
      c.save();
      // local x → reading direction R; local y (down the glyph) → −U, ×St
      c.transform(g.R[0], g.R[1], -g.U[0] * g.St, -g.U[1] * g.St, g.ox, g.oy);
      c.font = g.font;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      for (const ln of g.lines) {
        for (const o of ln.chars) c.fillText(o.ch, o.x, ln.y);
      }
      c.fill(g.extras); // run-on stems and the redrawn k's
      c.restore();
    }
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
    const info = (scene.msg.info || []).find((i) => i && i.edge === edge);
    const St = info ? info.St : S.stretch;
    const span = 2000;                       // image units rendered, square
    const cropW = CLOTH + 80;                // units shown across the preview
    const scale = cv.width / cropW;          // preview px per unit, across
    // enough of the stretched axis for the block plus its ascenders/descenders
    const need = Math.min(span, (info ? info.bandLen : CLOTH) * 1.9);
    if (fitHeight) cv.height = Math.round((need / St) * scale) + 20;
    const size = 1600;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const c = off.getContext('2d');
    const theme = THEMES[S.theme] || THEMES.linen;
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, size, size);
    const k = size / span;
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
    const dh = (span / St) * scale;
    out.imageSmoothingQuality = 'high';
    out.drawImage(off, ((span - cropW) / 2) * k, 0, cropW * k, size,
      0, (cv.height - dh) / 2, cv.width, dh);
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
    document.fonts.ready.then(() => { stemCache.clear(); if (scene) rebuild({ newWeave: false }); });
  } else init();
})();
