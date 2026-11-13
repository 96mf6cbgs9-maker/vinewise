/* Vinewise: the home screen's little garden. Tiny flowers grow in from the corners and
 * sides and bloom, butterflies flit from flower to flower and rest on them, bees buzz,
 * fairy dust drifts up and the odd petal floats down. Drawn on its own canvas behind
 * the home buttons; it runs only while the home screen is open.
 * HomeScene.start(canvas) / HomeScene.stop()
 */
(function () {
  'use strict';

  const PETALS = ['#ff6fa3', '#ffc23d', '#a77bff', '#ff8a3d', '#58b4ff', '#ffffff', '#ff9ec4', '#3ed6c0'];
  const WINGS = [['#ffd34d', '#e69a12'], ['#8fd3ff', '#3f8fd6'], ['#ffb3d1', '#e05a92'], ['#ffffff', '#c9b8e8'], ['#c9a6ff', '#7a4fd6']];
  const TAU = Math.PI * 2;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas = null, ctx = null, raf = 0, observer = null;
  let W = 0, H = 0, dpr = 1, t0 = 0, last = 0;
  let flowers = [], bushes = [], grass = [], flyers = [], bees = [], dust = [], petals = [];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

  // The same layout every time for a given screen size.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------ layout

  function build() {
    const rnd = seeded(Math.round(W) * 7 + Math.round(H));
    const R = (a, b) => a + rnd() * (b - a);
    const s = clamp(Math.min(W, H) / 400, 0.8, 1.35); // size scale for bigger screens
    flowers = [];
    bushes = [];

    // Where flowers grow from: edge, position along it (0..1), how many, how far in, how spread out.
    const clusters = [
      { edge: 'bottom', at: 0, n: 8, reach: [26, 170], spread: 160, size: [7, 15] },
      { edge: 'bottom', at: 1, n: 8, reach: [26, 170], spread: 160, size: [7, 15] },
      { edge: 'top', at: 0, n: 3, reach: [78, 140], spread: 70, size: [6, 10] },
      { edge: 'top', at: 1, n: 3, reach: [78, 140], spread: 70, size: [6, 10] },
      { edge: 'left', at: 0.36, n: 4, reach: [14, 54], spread: 120, size: [5, 10] },
      { edge: 'right', at: 0.4, n: 4, reach: [14, 54], spread: 120, size: [5, 10] },
      { edge: 'left', at: 0.68, n: 3, reach: [12, 44], spread: 90, size: [5, 9] },
      { edge: 'right', at: 0.72, n: 3, reach: [12, 44], spread: 90, size: [5, 9] },
    ];
    clusters.forEach((c, ci) => {
      const horizontal = c.edge === 'top' || c.edge === 'bottom';
      const len = horizontal ? W : H;
      const nx = c.edge === 'left' ? 1 : c.edge === 'right' ? -1 : 0;
      const ny = c.edge === 'top' ? 1 : c.edge === 'bottom' ? -1 : 0;
      for (let i = 0; i < c.n; i++) {
        const along = clamp(c.at * len + (c.at === 0 ? 1 : c.at === 1 ? -1 : 0) * R(0, c.spread) + (c.at > 0 && c.at < 1 ? R(-c.spread / 2, c.spread / 2) : 0), 4, len - 4);
        const bx = horizontal ? along : c.edge === 'left' ? 0 : W;
        const by = horizontal ? (c.edge === 'top' ? 0 : H) : along;
        // Taller near the corner, shorter further along the edge, so bushes look rounded.
        const nearCorner = c.at === 0 || c.at === 1 ? 1 - Math.abs(along - c.at * len) / c.spread : 1;
        const reach = (c.reach[0] + (c.reach[1] - c.reach[0]) * clamp(nearCorner, 0, 1) * R(0.55, 1)) * s;
        const side = R(-18, 18) * s;
        const hx = bx + nx * reach + (horizontal ? side : 0);
        const hy = by + ny * reach + (horizontal ? 0 : side);
        flowers.push({
          bx, by, hx, hy,
          cx: (bx + hx) / 2 + R(-22, 22) * s, cy: (by + hy) / 2 + R(-22, 22) * s,
          r: R(c.size[0], c.size[1]) * s,
          color: PETALS[Math.floor(rnd() * PETALS.length)],
          petals: rnd() < 0.25 ? 6 : 5,
          delay: ci * 110 + i * 85 + R(0, 160),
          sway: R(0.6, 1.2), phase: R(0, TAU), spin: R(-0.15, 0.15),
          leaf: rnd() < 0.8 ? R(0.35, 0.65) : -1, leafSide: rnd() < 0.5 ? -1 : 1,
          bud: rnd() < 0.35, rebloom: -1e9,
        });
      }
      if (c.edge === 'bottom') bushes.push({ x: c.at * W, y: H, flip: c.at === 1 ? -1 : 1, s });
    });

    grass = [];
    for (let x = -4; x < W + 8; x += 7 + rnd() * 6) grass.push({ x, h: R(8, 24) * s, lean: R(-0.25, 0.25), phase: R(0, TAU), dark: rnd() < 0.5 });

    // Butterflies start resting on flowers; bees circle a bush each.
    flyers = [];
    for (let i = 0; i < 4; i++) {
      const f = flowers[Math.floor(rnd() * flowers.length)];
      const wc = WINGS[i % WINGS.length];
      flyers.push({ x: f.hx, y: f.hy, vx: 0, vy: 0, on: f, tx: f.hx, ty: f.hy, state: 'rest', until: R(600, 2600),
        size: R(5.5, 7.5) * s, wing: wc[0], edge: wc[1], phase: R(0, TAU), wob: R(0, TAU) });
    }
    bees = [];
    // Bees buzz around the side flowers and the bottom-left bush, clear of the buttons.
    const hives = [[42 * s, H * 0.37], [W - 42 * s, H * 0.41], [70 * s, H - 120 * s]];
    for (const [cx, cy] of hives) bees.push({ cx, cy, a: R(0, TAU), rx: R(22, 34) * s, ry: R(12, 20) * s, speed: R(1.6, 2.3), x: 0, y: 0, size: 3.2 * s });
    dust = [];
    for (let i = 0; i < 16; i++) dust.push(newDust(R, true));
    petals = [];
    for (let i = 0; i < 5; i++) petals.push(newPetal(R, true));
  }

  function newDust(R, anywhere) {
    R = R || ((a, b) => a + Math.random() * (b - a));
    return { x: R(0, W), y: anywhere ? R(0, H) : H + R(0, 30), vy: R(-14, -6), r: R(0.8, 1.9), phase: R(0, TAU), tw: R(1.5, 3.5) };
  }

  function newPetal(R, anywhere) {
    R = R || ((a, b) => a + Math.random() * (b - a));
    return { x: R(0, W), y: anywhere ? R(0, H) : R(-40, -10), vy: R(10, 18), vx: R(4, 12), rot: R(0, TAU), vr: R(-1.2, 1.2), phase: R(0, TAU), r: R(2.6, 4.2), color: Math.random() < 0.6 ? '#ff9ec4' : '#ffffff' };
  }

  // ------------------------------------------------------------ drawing

  function leaf(x, y, ang, len, color) {
    if (len <= 0.5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color || '#3f9a44';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -len * 0.45, len, 0);
    ctx.quadraticCurveTo(len * 0.5, len * 0.45, 0, 0);
    ctx.fill();
    ctx.restore();
  }

  function bloomHead(x, y, r, color, n, rot) {
    if (r <= 0.3) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    for (let p = 0; p < n; p++) {
      ctx.rotate(TAU / n);
      ctx.beginPath();
      ctx.ellipse(r * 0.52, 0, r * 0.52, r * 0.33, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = color === '#ffc23d' ? '#ff8a3d' : '#ffe066';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function flowerScale(f, t) {
    const since = t - f.rebloom;
    if (since >= 0 && since < 1100) {
      // A flower closing to a bud and opening again.
      return since < 300 ? 1 - 0.7 * (since / 300) : 0.3 + 0.7 * easeOutBack(clamp((since - 300) / 650, 0, 1));
    }
    return easeOutBack(clamp((t - f.delay - 260) / 620, 0, 1));
  }

  function drawFlowers(t) {
    // Stems and leaves first, so every flower head sits on top.
    ctx.lineCap = 'round';
    for (const f of flowers) {
      const grow = clamp((t - f.delay) / 420, 0, 1);
      if (grow <= 0) continue;
      const sw = reduced ? 0 : Math.sin(t / 1000 * f.sway + f.phase) * 3;
      const hx = f.bx + (f.hx + sw - f.bx) * grow, hy = f.by + (f.hy - f.by) * grow;
      const cx = f.bx + (f.cx - f.bx) * grow, cy = f.by + (f.cy - f.by) * grow;
      ctx.strokeStyle = '#3c8f3f';
      ctx.lineWidth = Math.max(1.4, f.r * 0.22);
      ctx.beginPath();
      ctx.moveTo(f.bx, f.by);
      ctx.quadraticCurveTo(cx, cy, hx, hy);
      ctx.stroke();
      if (f.leaf > 0) {
        const lx = f.bx + (cx - f.bx) * f.leaf * 1.6, ly = f.by + (cy - f.by) * f.leaf * 1.6;
        const ang = Math.atan2(hy - f.by, hx - f.bx) + f.leafSide * 0.9;
        leaf(lx, ly, ang, f.r * 1.5 * grow, '#4aa84a');
      }
      f.x = hx;
      f.y = hy;
    }
    for (const f of flowers) {
      if (f.x === undefined) continue;
      const k = flowerScale(f, t);
      if (f.bud) {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 0.42 * clamp((t - f.delay - 200) / 400, 0, 1), 0, TAU);
        ctx.fill();
        // A bud that opens a little later than the rest.
        bloomHead(f.x, f.y, f.r * easeOutBack(clamp((t - f.delay - 1400) / 700, 0, 1)), f.color, f.petals, f.phase + t / 1000 * f.spin);
      } else {
        bloomHead(f.x, f.y, f.r * k, f.color, f.petals, f.phase + t / 1000 * f.spin);
      }
    }
  }

  function drawBushes(t) {
    for (const b of bushes) {
      for (let i = 0; i < 7; i++) {
        const ang = -Math.PI / 2 + b.flip * (0.15 + i * 0.2);
        const sw = reduced ? 0 : Math.sin(t / 900 + i) * 0.04;
        const len = (34 + (i % 3) * 12) * b.s * clamp((t - i * 60) / 500, 0, 1);
        leaf(b.x + b.flip * i * 7 * b.s, b.y + 4, ang + sw, len, i % 2 ? '#3f9a44' : '#56b04f');
      }
    }
  }

  function drawGrass(t) {
    for (const g of grass) {
      const sw = reduced ? 0 : Math.sin(t / 700 + g.phase) * 2.2;
      ctx.fillStyle = g.dark ? 'rgba(62, 138, 52, 0.85)' : 'rgba(92, 170, 70, 0.85)';
      ctx.beginPath();
      ctx.moveTo(g.x - 3, H + 1);
      ctx.quadraticCurveTo(g.x + g.lean * g.h * 0.5, H - g.h * 0.6, g.x + g.lean * g.h + sw, H - g.h);
      ctx.quadraticCurveTo(g.x + 1 + g.lean * g.h * 0.4, H - g.h * 0.5, g.x + 3, H + 1);
      ctx.fill();
    }
  }

  function drawButterfly(b, t) {
    // Wings open and close: fast in flight, slow while resting on a flower.
    const flap = b.state === 'rest' ? 0.55 + 0.45 * Math.sin(t / 1000 * 2.4 + b.phase) : Math.abs(Math.sin(t / 1000 * 17 + b.phase));
    const k = Math.max(0.12, flap), s = b.size;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.state === 'rest' ? 0 : clamp(b.vx / 160, -0.4, 0.4));
    for (const side of [-1, 1]) {
      ctx.fillStyle = b.wing;
      ctx.strokeStyle = b.edge;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(side * s * 0.55 * k, -s * 0.28, s * 0.62 * k, s * 0.5, side * 0.35, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(side * s * 0.42 * k, s * 0.38, s * 0.42 * k, s * 0.34, -side * 0.4, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = Math.max(1, s * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.lineTo(0, s * 0.6);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.quadraticCurveTo(-s * 0.2, -s * 0.95, -s * 0.38, -s * 1.05);
    ctx.moveTo(0, -s * 0.55);
    ctx.quadraticCurveTo(s * 0.2, -s * 0.95, s * 0.38, -s * 1.05);
    ctx.stroke();
    ctx.restore();
  }

  function drawBee(b, t) {
    const s = b.size;
    ctx.save();
    ctx.translate(b.x, b.y);
    // Wings: a quick shimmer.
    ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.55 + 0.35 * Math.abs(Math.sin(t / 30))) + ')';
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, -s * 0.9, s * 0.55, s * 0.8, -0.4, 0, TAU);
    ctx.ellipse(s * 0.4, -s * 0.9, s * 0.55, s * 0.8, 0.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffc928';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.25, s * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(-s * 0.2, -s * 0.8, s * 0.35, s * 1.6);
    ctx.fillRect(s * 0.55, -s * 0.6, s * 0.3, s * 1.2);
    ctx.restore();
  }

  // ------------------------------------------------------------ movement

  function pickTarget(b) {
    const open = flowers.filter((f) => f.x !== undefined && !f.bud);
    if (open.length && Math.random() < 0.8) {
      const f = open[Math.floor(Math.random() * open.length)];
      b.on = f;
      b.tx = f.x;
      b.ty = f.y;
    } else {
      // Sometimes just a wander across the edges of the garden.
      b.on = null;
      b.tx = Math.random() < 0.5 ? 20 + Math.random() * W * 0.28 : W - 20 - Math.random() * W * 0.28;
      b.ty = 80 + Math.random() * (H - 160);
    }
  }

  function step(dt, t) {
    for (const b of flyers) {
      if (b.state === 'rest') {
        if (b.on && b.on.x !== undefined) { b.x = b.on.x; b.y = b.on.y - b.on.r * 0.2; }
        if (t > b.until) { b.state = 'fly'; pickTarget(b); }
        continue;
      }
      if (b.on && b.on.x !== undefined) { b.tx = b.on.x; b.ty = b.on.y - b.on.r * 0.2; }
      const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy) || 1;
      const speed = 46;
      b.vx += ((dx / d) * speed - b.vx) * Math.min(1, dt * 2.2);
      b.vy += ((dy / d) * speed - b.vy) * Math.min(1, dt * 2.2);
      // The fluttery, bobbing flight of a butterfly.
      const wob = Math.sin(t / 1000 * 6 + b.wob) * 26;
      b.x += (b.vx + (-b.vy / speed) * wob) * dt;
      b.y += (b.vy + (b.vx / speed) * wob) * dt;
      if (d < 5) {
        if (b.on) { b.state = 'rest'; b.until = t + 1400 + Math.random() * 2600; } else pickTarget(b);
      }
    }
    for (const b of bees) {
      b.a += dt * b.speed;
      b.x = b.cx + Math.cos(b.a) * b.rx + Math.sin(t / 90) * 1.5;
      b.y = b.cy + Math.sin(b.a * 2) * b.ry + Math.cos(t / 70) * 1.5;
    }
    for (const p of dust) {
      p.y += p.vy * dt;
      p.x += Math.sin(t / 1300 + p.phase) * 6 * dt;
      if (p.y < -10) Object.assign(p, newDust(null, false));
    }
    for (const p of petals) {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t / 900 + p.phase) * 14) * dt;
      p.rot += p.vr * dt;
      if (p.y > H + 10 || p.x > W + 20) Object.assign(p, newPetal(null, false));
    }
    // Now and then a flower closes and opens again.
    if (!reduced && Math.random() < dt * 0.5) {
      const f = flowers[Math.floor(Math.random() * flowers.length)];
      if (f && t - f.rebloom > 3000 && t > f.delay + 1500) f.rebloom = t;
    }
  }

  function drawDust(t) {
    for (const p of dust) {
      const a = 0.35 + 0.45 * Math.abs(Math.sin(t / 1000 * p.tw + p.phase));
      ctx.fillStyle = 'rgba(255, 252, 214, ' + (a * 0.28) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 253, 230, ' + a + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawPetals() {
    for (const p of petals) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ loop

  function resize() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    build();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    render(now);
  }

  function render(now) {
    if (!ctx || !W) return;
    const t = now - t0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!reduced) step(dt, t);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawDust(t);
    drawBushes(t);
    drawFlowers(reduced ? 1e6 : t);
    drawGrass(t);
    drawPetals();
    for (const b of bees) if (t > 900) drawBee(b, t);
    for (const b of flyers) if (t > 700) drawButterfly(b, t);
  }

  window.HomeScene = {
    /** Starts (or restarts) the scene: the flowers bloom in again each time home opens. */
    start(c) {
      canvas = c;
      ctx = canvas.getContext('2d');
      resize();
      t0 = performance.now();
      last = 0;
      for (const f of flowers) f.rebloom = -1e9;
      if (!observer && window.ResizeObserver) { observer = new ResizeObserver(resize); observer.observe(canvas); }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    render, // draw one frame by hand (tests)
  };
})();
