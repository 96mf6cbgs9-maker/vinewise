/* Vinewise: rules, level parsing, solver and level generator.
 *
 * Rules: every seed has an arrow. Tapping a seed grows a vine in that direction
 * until it hits the edge, a rock, another seed or an existing vine. Cover every
 * patch of soil to win. Vines block each other, so the tap order matters.
 *
 * Works in the browser (window.BloomLevels) and in Node (require) so levels can
 * be generated and checked offline by tools/build-levels.js.
 */
(function (root) {
  'use strict';

  const DIRS = [
    { dx: 0, dy: -1, ch: '^' },
    { dx: 1, dy: 0, ch: '>' },
    { dx: 0, dy: 1, ch: 'v' },
    { dx: -1, dy: 0, ch: '<' },
  ];
  const VOID = 0, SOIL = 1, ROCK = 2;
  // Owner value for a patch filled by a Flower Seed helper (not by any seed's vine).
  const PLANT = 30000;

  const PALETTE = ['#ff6fa3', '#ffc23d', '#a77bff', '#ff8a3d', '#ff5a6e', '#58b4ff', '#3ed6c0'];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashInts(a, b) {
    let h = (2166136261 ^ a) >>> 0;
    h = Math.imul(h, 16777619) ^ b;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return (h ^ (h >>> 15)) >>> 0;
  }

  const FACT = [1];
  for (let i = 1; i <= 20; i++) FACT[i] = FACT[i - 1] * i;

  // ---------------------------------------------------------------- Board

  class Board {
    constructor(level) {
      this.level = level;
      this.w = level.w;
      this.h = level.h;
      this.cells = level.cells;
      // Each board gets its own copy, so a Breeze helper can turn a seed in this game only.
      this.seeds = level.seeds.map((s) => Object.assign({}, s));
      const n = this.w * this.h;
      this.owner = new Int16Array(n).fill(-1); // seed index covering this cell
      this.seedAt = new Int16Array(n).fill(-1);
      this.lens = new Int16Array(this.seeds.length).fill(-1); // -1 = not tapped
      this.mark = new Int32Array(n);
      this.stamp = 0;
      this.soil = 0;
      for (let k = 0; k < n; k++) if (this.cells[k] === SOIL) this.soil++;
      this.seeds.forEach((s, i) => {
        const k = s.y * this.w + s.x;
        this.owner[k] = i;
        this.seedAt[k] = i;
      });
      this.covered = this.seeds.length;
      this.used = 0;
    }

    isTapped(i) { return this.lens[i] >= 0; }

    seedIndexAt(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
      return this.seedAt[y * this.w + x];
    }

    /** Cells (as indices) the vine of seed i would cover if tapped now. */
    ray(i) {
      const s = this.seeds[i], d = DIRS[s.dir], w = this.w, h = this.h;
      const out = [];
      let x = s.x + d.dx, y = s.y + d.dy;
      while (x >= 0 && y >= 0 && x < w && y < h) {
        const k = y * w + x;
        if (this.cells[k] !== SOIL || this.owner[k] >= 0) break;
        out.push(k);
        x += d.dx;
        y += d.dy;
      }
      return out;
    }

    apply(i) {
      const r = this.ray(i);
      for (const k of r) this.owner[k] = i;
      this.lens[i] = r.length;
      this.covered += r.length;
      this.used++;
      return r;
    }

    unapply(i) {
      const s = this.seeds[i], d = DIRS[s.dir];
      for (let j = 1; j <= this.lens[i]; j++) {
        this.owner[(s.y + d.dy * j) * this.w + (s.x + d.dx * j)] = -1;
      }
      this.covered -= this.lens[i];
      this.lens[i] = -1;
      this.used--;
    }

    /** Flower Seed helper: fill one bare patch. It counts as covered and blocks vines, like a vine does. */
    plant(k) {
      if (this.cells[k] !== SOIL || this.owner[k] >= 0) return false;
      this.owner[k] = PLANT;
      this.covered++;
      return true;
    }

    /** Breeze helper: turn an unplanted seed's arrow 90 degrees clockwise. */
    turnSeed(i) {
      if (this.lens[i] >= 0) return false;
      this.seeds[i].dir = (this.seeds[i].dir + 1) % 4;
      return true;
    }

    isComplete() { return this.covered === this.soil; }
    remaining() { return this.soil - this.covered; }
    key() { return this.lens.join(','); }

    /** True when no unused seed can grow anything and soil is still bare. */
    isStuck() {
      if (this.isComplete()) return false;
      for (let i = 0; i < this.seeds.length; i++) {
        if (this.lens[i] < 0 && this.ray(i).length > 0) return false;
      }
      return true;
    }

    /** Every bare patch must still lie on the free path of some unused seed. */
    allReachable() {
      const st = ++this.stamp, w = this.w, h = this.h;
      for (let i = 0; i < this.seeds.length; i++) {
        if (this.lens[i] >= 0) continue;
        const s = this.seeds[i], d = DIRS[s.dir];
        let x = s.x + d.dx, y = s.y + d.dy;
        while (x >= 0 && y >= 0 && x < w && y < h) {
          const k = y * w + x;
          if (this.cells[k] !== SOIL || this.owner[k] >= 0) break;
          this.mark[k] = st;
          x += d.dx;
          y += d.dy;
        }
      }
      for (let k = 0; k < this.cells.length; k++) {
        if (this.cells[k] === SOIL && this.owner[k] < 0 && this.mark[k] !== st) return false;
      }
      return true;
    }
  }

  // ---------------------------------------------------------------- Solver

  /** Number of tap orders (of the unused seeds) that finish the garden. */
  function countSolutions(board, memo) {
    const unused = board.seeds.length - board.used;
    if (board.isComplete()) return FACT[unused];
    if (unused === 0 || !board.allReachable()) return 0;
    const key = board.key();
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let total = 0;
    for (let i = 0; i < board.seeds.length; i++) {
      if (board.lens[i] >= 0) continue;
      board.apply(i);
      total += countSolutions(board, memo);
      board.unapply(i);
    }
    memo.set(key, total);
    return total;
  }

  /** One winning tap order from the current state, or null if there is none. */
  function findSolution(board, dead) {
    dead = dead || new Set();
    if (board.isComplete()) return [];
    if (board.used === board.seeds.length || !board.allReachable()) return null;
    const key = board.key();
    if (dead.has(key)) return null;
    for (let i = 0; i < board.seeds.length; i++) {
      if (board.lens[i] >= 0) continue;
      board.apply(i);
      const rest = findSolution(board, dead);
      board.unapply(i);
      if (rest) return [i].concat(rest);
    }
    dead.add(key);
    return null;
  }

  /**
   * How many of the most recent taps to take back so the garden can bloom again.
   * One if the board is still winnable; more when the mistake came earlier (the
   * board often looks fine for a few taps after the fatal one). Leaves the board
   * as it found it. `history` is the tap order, oldest first.
   */
  function stepsToWinnable(board, history) {
    const popped = [];
    while (popped.length < history.length) {
      const i = history[history.length - 1 - popped.length];
      board.unapply(i);
      popped.push(i);
      if (findSolution(board)) break;
    }
    for (let k = popped.length - 1; k >= 0; k--) board.apply(popped[k]);
    return popped.length;
  }

  function analyze(level) {
    const b = new Board(level);
    const memo = new Map();
    const solutions = countSolutions(b, memo);
    const n = level.seeds.length;
    let traps = 0;
    for (let i = 0; i < n; i++) {
      b.apply(i);
      if (countSolutions(b, memo) === 0) traps++;
      b.unapply(i);
    }
    let rocks = 0;
    for (const c of level.cells) if (c === ROCK) rocks++;
    return { solutions, p: solutions / FACT[n], traps, rocks, soil: b.soil, states: memo.size };
  }

  // ---------------------------------------------------------------- Text format
  // ' ' grass, '.' soil, '#' rock, '^ > v <' seed (on soil).

  function parseLevel(rows, colorSalt) {
    const h = rows.length;
    const w = Math.max.apply(null, rows.map((r) => r.length));
    const cells = new Uint8Array(w * h);
    const seeds = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x] || ' ';
        const k = y * w + x;
        if (ch === '.') cells[k] = SOIL;
        else if (ch === '#') cells[k] = ROCK;
        else {
          const dir = DIRS.findIndex((d) => d.ch === ch);
          if (dir >= 0) {
            cells[k] = SOIL;
            seeds.push({ x, y, dir });
          }
        }
      }
    }
    const salt = colorSalt || 0;
    seeds.forEach((s, i) => { s.color = PALETTE[(i * 3 + salt) % PALETTE.length]; });
    return { w, h, cells, seeds, rows: rows.slice() };
  }

  function levelToRows(level) {
    const rows = [];
    for (let y = 0; y < level.h; y++) {
      let r = '';
      for (let x = 0; x < level.w; x++) {
        const c = level.cells[y * level.w + x];
        r += c === SOIL ? '.' : c === ROCK ? '#' : ' ';
      }
      rows.push(r);
    }
    for (const s of level.seeds) {
      const r = rows[s.y];
      rows[s.y] = r.slice(0, s.x) + DIRS[s.dir].ch + r.slice(s.x + 1);
    }
    return rows;
  }

  // ---------------------------------------------------------------- Generator
  // Builds a garden in a valid tap order: each new vine must stop against
  // something already there (edge, rock, seed or an earlier vine). Vines that
  // stop against an earlier vine are what make the order matter.

  function buildCandidate(rng, w, h, n, maxLen) {
    const U = 0, S = 1, V = 2, B = 3;
    const g = new Uint8Array(w * h);
    const seeds = [];
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const touches = (x, y) => {
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (inb(nx, ny)) {
          const v = g[ny * w + nx];
          if (v === S || v === V) return true;
        }
      }
      return false;
    };

    for (let k = 0; k < n; k++) {
      const cands = [];
      let wsum = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (g[y * w + x] !== U) continue;
          const t0 = k === 0 || touches(x, y);
          for (let dir = 0; dir < 4; dir++) {
            const d = DIRS[dir];
            let t = t0;
            for (let L = 1; L <= maxLen; L++) {
              const px = x + d.dx * L, py = y + d.dy * L;
              if (!inb(px, py) || g[py * w + px] !== U) break;
              if (!t && touches(px, py)) t = true;
              if (!t) continue;
              const bx = px + d.dx, by = py + d.dy;
              let s;
              if (!inb(bx, by)) s = 1.2;
              else {
                const v = g[by * w + bx];
                s = v === V ? 3.2 : v === S ? 0.6 : v === B ? 0.9 : -1.6;
              }
              s += 0.45 * Math.min(L, 4);
              const wgt = Math.exp(s);
              cands.push({ x, y, dir, L, wgt });
              wsum += wgt;
            }
          }
        }
      }
      if (!cands.length) return null;
      let r = rng() * wsum;
      let c = cands[cands.length - 1];
      for (const cand of cands) {
        r -= cand.wgt;
        if (r <= 0) { c = cand; break; }
      }
      const d = DIRS[c.dir];
      g[c.y * w + c.x] = S;
      for (let j = 1; j <= c.L; j++) g[(c.y + d.dy * j) * w + (c.x + d.dx * j)] = V;
      const bx = c.x + d.dx * (c.L + 1), by = c.y + d.dy * (c.L + 1);
      if (inb(bx, by) && g[by * w + bx] === U) g[by * w + bx] = B;
      seeds.push({ x: c.x, y: c.y, dir: c.dir });
    }

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (g[y * w + x] === U) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const cells = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const v = g[(y + minY) * w + (x + minX)];
        cells[y * cw + x] = v === S || v === V ? SOIL : v === B ? ROCK : VOID;
      }
    }
    return {
      w: cw,
      h: ch,
      cells,
      seeds: seeds.map((s) => ({ x: s.x - minX, y: s.y - minY, dir: s.dir })),
    };
  }

  // Difficulty plan: [seeds, max chance that random tapping wins, min share of trap seeds]
  const PLAN = {
    3: [3, 0.34, 0.3], 4: [3, 0.34, 0.3], 5: [4, 0.25, 0.25], 6: [4, 0.2, 0.25],
    7: [5, 0.15, 0.3], 8: [5, 0.12, 0.3], 9: [6, 0.1, 0.3], 10: [4, 0.25, 0.25],
    11: [6, 0.08, 0.3], 12: [7, 0.06, 0.3], 13: [7, 0.05, 0.35], 14: [8, 0.04, 0.35],
    15: [5, 0.15, 0.3], 16: [8, 0.03, 0.35], 17: [9, 0.03, 0.35], 18: [9, 0.02, 0.4],
    19: [10, 0.02, 0.4], 20: [6, 0.1, 0.3],
  };

  function specFor(num) {
    let n, pMax, minTrap;
    if (PLAN[num]) [n, pMax, minTrap] = PLAN[num];
    else {
      const cyc = (num - 21) % 5;
      n = cyc === 4 ? 7 : 9 + (cyc % 3);
      pMax = cyc === 4 ? 0.06 : 0.02;
      minTrap = 0.4;
    }
    return sizedSpec(n, pMax, minTrap);
  }

  function sizedSpec(n, pMax, minTrap) {
    const w = n <= 3 ? 4 : n <= 5 ? 5 : n <= 7 ? 6 : 7;
    const h = n <= 3 ? 5 : n <= 5 ? 6 : n <= 7 ? 7 : 9;
    return { n, w, h, maxLen: Math.max(w, h) - 1, pMax, minTrap, maxRocks: Math.ceil(n / 3) };
  }

  function generateLevel(num, maxAttempts) {
    return generateFrom(specFor(num), num, maxAttempts);
  }

  function generateFrom(spec, salt, maxAttempts) {
    let best = null, bestPenalty = Infinity, bestStats = null;
    for (let attempt = 0; attempt < (maxAttempts || 80); attempt++) {
      const rng = mulberry32(hashInts(salt, attempt));
      const lvl = buildCandidate(rng, spec.w, spec.h, spec.n, spec.maxLen);
      if (!lvl) continue;
      const st = analyze(lvl);
      if (st.solutions === 0) continue; // never happens by construction, but be safe
      const fill = (st.soil + st.rocks) / (lvl.w * lvl.h);
      const penalty =
        Math.max(0, st.p - spec.pMax) * 10 +
        Math.max(0, spec.minTrap - st.traps / spec.n) * 3 +
        Math.max(0, st.rocks - spec.maxRocks) * 0.5 +
        Math.max(0, 0.55 - fill) * 3;
      if (penalty < bestPenalty) {
        best = lvl;
        bestPenalty = penalty;
        bestStats = st;
        if (penalty === 0) break;
      }
    }
    return { rows: levelToRows(best), stats: bestStats, penalty: bestPenalty };
  }

  // ---------------------------------------------------------------- Levels

  const TUTORIAL = [
    ['>...', '>...'],
    [' v  ', ' .  ', '>...'],
  ];

  // ---------------------------------------------------------------- Daily Garden
  // One garden per calendar day, the same for everyone. It gets harder through
  // the week: Monday is gentle, Sunday is tough. Days are named 'YYYY-MM-DD'.
  // [seeds, max chance that random tapping wins, min share of trap seeds], Sunday first.
  const DAILY_PLAN = [
    [9, 0.02, 0.4], [6, 0.1, 0.3], [7, 0.06, 0.3], [7, 0.05, 0.35],
    [8, 0.04, 0.35], [8, 0.03, 0.35], [9, 0.03, 0.4],
  ];
  const DAY_MS = 86400000;
  const DAILY_SALT = 1000000; // keeps daily gardens apart from numbered levels

  /** 'YYYY-MM-DD' -> whole days since 1 Jan 1970 (a calendar date, no time zone). NaN if invalid. */
  function dayNumber(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
    if (!m) return NaN;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return dayKey(t / DAY_MS) === key ? t / DAY_MS : NaN; // rejects 2026-02-31
  }

  function dayKey(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }

  function dailySpec(key) {
    const [n, pMax, minTrap] = DAILY_PLAN[new Date(dayNumber(key) * DAY_MS).getUTCDay()];
    return sizedSpec(n, pMax, minTrap);
  }

  function generateDaily(key, maxAttempts) {
    return generateFrom(dailySpec(key), DAILY_SALT + dayNumber(key), maxAttempts);
  }

  const cache = new Map();

  /** The Daily Garden for a day: from js/daily-data.js when it's there (built and
   *  checked ahead by tools/build-dailies.js), otherwise generated on the spot. */
  function getDaily(key) {
    const ck = 'daily:' + key;
    if (cache.has(ck)) return cache.get(ck);
    const day = dayNumber(key);
    if (isNaN(day)) throw new Error('Not a day: ' + key);
    const data = root.VINEWISE_DAILY;
    let rows = null;
    if (data && data.rows) {
      const i = day - dayNumber(data.start);
      if (i >= 0 && i < data.rows.length) rows = data.rows[i];
    }
    if (!rows) rows = generateDaily(key, 30).rows;
    const lvl = parseLevel(rows, day);
    cache.set(ck, lvl);
    return lvl;
  }

  function getLevel(num) {
    if (cache.has(num)) return cache.get(num);
    let rows;
    const data = root.BLOOM_LEVEL_DATA;
    if (num <= TUTORIAL.length) rows = TUTORIAL[num - 1];
    else if (data && data[num - TUTORIAL.length - 1]) rows = data[num - TUTORIAL.length - 1];
    else rows = generateLevel(num, 30).rows;
    const lvl = parseLevel(rows, num);
    cache.set(num, lvl);
    return lvl;
  }

  const api = {
    DIRS, VOID, SOIL, ROCK, PLANT, PALETTE,
    Board, countSolutions, findSolution, stepsToWinnable, analyze,
    parseLevel, levelToRows, generateLevel, specFor, getLevel, mulberry32,
    TUTORIAL, DAILY_PLAN, dayNumber, dayKey, dailySpec, generateDaily, getDaily,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BloomLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
