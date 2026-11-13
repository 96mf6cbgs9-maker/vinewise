/* Vinewise: rendering, input, game flow and mock ads. */
(function () {
  'use strict';

  const L = window.BloomLevels;
  const Sound = window.Sound;
  const { DIRS, SOIL, ROCK, VOID } = L;

  const GROW_MS = 70; // time for a vine to grow one patch
  const LAST_DATA_LEVEL = L.TUTORIAL.length + (window.BLOOM_LEVEL_DATA || []).length;
  const TIPS = {
    1: 'Tap a seed 🌱',
    2: 'Vines block each other. Order matters!',
    3: 'Cover every brown patch',
  };

  // ------------------------------------------------------------ persistence

  // Coins and garden helpers. Numbers live in js/config.js (economy); these are the fallbacks.
  const ECON = Object.assign({
    startCoins: 100, startItems: { seed: 1, shears: 1, breeze: 1 }, coinsPerLevel: 10,
    coinsPerAd: 25, adCoinsPerDay: 5, unlockLevel: 4, dailyGift: true, quietGardenPrice: '$3.99', dailyCoins: 20,
    prices: { seed: 50, shears: 30, breeze: 30 },
    packs: [{ id: 'pouch', coins: 500, price: '$0.99' }, { id: 'basket', coins: 1200, price: '$1.99' }, { id: 'barrow', coins: 3000, price: '$4.99' }],
  }, cfg().economy || {});
  const ITEMS = {
    seed: { icon: '🌸', name: 'Flower Seed', desc: 'Fill any bare patch.', help: 'Tap a bare patch to plant a flower on it.' },
    shears: { icon: '✂️', name: 'Shears', desc: 'Cut one vine you grew.', help: 'Tap a vine to cut it. Its seed can grow again.' },
    breeze: { icon: '🍃', name: 'Breeze', desc: 'Turn a seed’s arrow 90°.', help: 'Tap a seed that hasn’t grown to turn its arrow.' },
  };
  const PLANT_COLOR = '#ff6fa3';

  const STORE_KEY = 'bloom.v1';
  const saved = (function () {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  })();
  const prefs = {
    level: saved.level || 1,
    maxLevel: saved.maxLevel || 1,
    sound: saved.sound !== false,
    ads: saved.ads !== false,
    coins: typeof saved.coins === 'number' ? saved.coins : ECON.startCoins,
    items: Object.assign({}, ECON.startItems, saved.items || {}),
    completed: typeof saved.completed === 'number' ? saved.completed : (saved.maxLevel || 1) - 1, // highest level finished
    adCoins: saved.adCoins || { day: '', n: 0 },
    helpersIntro: !!saved.helpersIntro,
    giftDay: saved.giftDay || '',   // the day the last free helper was given
    hintDay: saved.hintDay || '',   // the day the free hint was last used
    quiet: !!saved.quiet,           // owns Quiet Garden: no ads at all, no coin prompts
    // Daily Garden: results by day ('YYYY-MM-DD' -> { taps, undos, hints, seeds, onDay })
    // and the attempt in progress ({ key, taps, undos, hints }).
    daily: saved.daily && saved.daily.results ? saved.daily : { results: {}, run: null },
  };
  const today = () => new Date().toDateString();
  /** Today's date on this phone as 'YYYY-MM-DD' (the Daily Garden changes at local midnight). */
  function localKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
  }

  // ------------------------------------------------------------ DOM

  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const handEl = $('hand');
  const toastEl = $('toast');

  // ------------------------------------------------------------ state

  let level = null;
  let board = null;
  let history = [];
  let vines = new Map(); // seed index -> { i, cells, start, played }
  let phase = 'play'; // play | ending | won | lost
  let pendingEnd = null; // { type: 'win' | 'lose', at }
  let token = 0; // bumps on restart/undo so stale timers do nothing
  let handSeed = -1;
  let hintSeed = -1;
  let speckles = [];
  let bloomStart = 0;
  let bloomDelay = null;
  let bloomPlayed = null;
  let failStart = 0;
  let fx = [];
  let lastFrame = 0;
  let aiming = null; // the helper waiting for a target: 'seed' | 'shears' | 'breeze'
  let plants = new Map(); // patch index -> time a Flower Seed was planted there
  let mode = 'levels'; // levels | daily
  let boardLevel = 0; // the numbered level on the board (0 = none yet)
  const daily = { key: '', friend: null }; // the Daily Garden on screen, and a friend's result from a shared link
  const view = { cs: 40, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  // ------------------------------------------------------------ helpers

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

  function rgb(a, b, t) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  function darker(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function rr(x, y, w, h, r) {
    r = clamp(r, 0, Math.max(0, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  }

  function cellCenter(x, y) {
    return [view.ox + (x + 0.5) * view.cs, view.oy + (y + 0.5) * view.cs];
  }

  function vibrate(p) {
    const ua = navigator.userActivation;
    if (ua && !ua.hasBeenActive) return; // browsers block vibration before the first real touch
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ }
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms || 2200);
  }

  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }

  // ------------------------------------------------------------ level flow

  /** Puts a garden on the board, fresh: shared by numbered levels and the Daily Garden. */
  function loadGarden(lvl, salt) {
    leaveHome();
    token++;
    level = lvl;
    board = new L.Board(level);
    history = [];
    vines = new Map();
    phase = 'play';
    pendingEnd = null;
    hintSeed = -1;
    fx = [];
    bloomDelay = null;
    failStart = 0;
    aiming = null;
    plants = new Map();
    hide('win');
    hide('fail');
    hide('shop');
    hide('daily-win');
    shopClosed = null;

    const rng = L.mulberry32(salt);
    speckles = [];
    for (let k = 0; k < level.w * level.h; k++) {
      const s = [];
      for (let j = 0; j < 3; j++) s.push([0.2 + rng() * 0.6, 0.2 + rng() * 0.5, 0.035 + rng() * 0.03]);
      speckles.push(s);
    }
    layout();
  }

  function setTitle(text, kicker) {
    $('level-label').textContent = text;
    $('level-label').classList.toggle('small', !!kicker);
    $('title-kicker').textContent = kicker || '';
    $('title-kicker').hidden = !kicker;
  }

  function startLevel(num) {
    mode = 'levels';
    prefs.level = num;
    prefs.maxLevel = Math.max(prefs.maxLevel, num);
    save();
    loadGarden(L.getLevel(num), num * 7919);
    boardLevel = num;
    setTitle('Level ' + num);
    $('boosters').hidden = num < ECON.unlockLevel;
    updateDailyBtn();
    handSeed = num === 1 ? 0 : -1;
    placeHand();
    if (TIPS[num]) toast(TIPS[num], 2800);
    else if (num >= ECON.unlockLevel && !prefs.helpersIntro) {
      prefs.helpersIntro = true;
      prefs.giftDay = today(); // the starter helpers count as today's gift
      save();
      toast('New: garden helpers 🌸 ✂️ 🍃. You have one of each, plus a free one every day.', 3800);
    } else if (!dailyGift()) toastEl.hidden = true;
    updateHud();
    updateCoins();
    updateBoosters();
  }

  // ------------------------------------------------------------ Daily Garden

  const DAY_NAMES = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
  const prettyDay = (key, opts) => new Date(L.dayNumber(key) * 86400000).toLocaleDateString('en-GB', opts || DAY_NAMES);

  /** The attempt in progress for this day's garden (taps count every tap, including undone ones). */
  function dailyRun() {
    const r = prefs.daily.run;
    if (r && r.key === daily.key) return r;
    prefs.daily.run = { key: daily.key, taps: 0, undos: 0, hints: 0 };
    return prefs.daily.run;
  }

  function count(what) {
    if (mode !== 'daily') return;
    dailyRun()[what]++;
    save();
  }

  /** opts: { src: 'button' | 'link' | 'win' | 'again', friend, retry } */
  function startDaily(key, opts) {
    opts = opts || {};
    mode = 'daily';
    daily.key = key;
    if ('friend' in opts) daily.friend = opts.friend;
    if (opts.src === 'again') prefs.daily.run = null; // a new attempt; the first bloom stays the one that's shared
    dailyRun();
    save();
    loadGarden(L.getDaily(key), L.dayNumber(key) * 7919);
    const isToday = key === localKey();
    setTitle(isToday ? prettyDay(key, { weekday: 'long', timeZone: 'UTC' }) : prettyDay(key, { day: 'numeric', month: 'short', timeZone: 'UTC' }), 'Daily Garden');
    $('boosters').hidden = true; // the same garden for everyone, so no helpers
    updateDailyBtn();
    handSeed = -1;
    placeHand();
    if (opts.retry) toastEl.hidden = true;
    else {
      const f = daily.friend;
      const newbie = prefs.completed < 2;
      const how = newbie ? ' Tap a seed to grow its vine, and cover all the brown soil.' : '';
      if (f) toast('Your friend bloomed this garden in ' + f.t + ' taps. Your turn!' + how, 4200);
      else if (newbie) toast(how.trim(), 4200);
      else toast(isToday ? 'Today’s garden. Everyone gets the same one.' : 'The Daily Garden for ' + prettyDay(key), 2800);
      if (window.Telemetry) window.Telemetry.dailyStart(opts.src || 'button');
    }
    updateHud();
    updateCoins();
  }

  /** "Home" on the Daily Garden card. */
  function leaveDaily() {
    hide('daily-win');
    if ($('home').hidden) showHome(); // otherwise the card was opened from home: stay there
  }

  /** Days in a row with that day's garden bloomed on the day, counting from today (or yesterday). */
  function dailyStreak() {
    const won = (d) => { const r = prefs.daily.results[L.dayKey(d)]; return !!(r && r.onDay); };
    let d = L.dayNumber(localKey()), n = 0;
    if (!won(d)) d--;
    while (won(d)) { n++; d--; }
    return n;
  }

  function updateDailyBtn() {
    updateHomeDaily();
  }

  /** Today's Daily Garden: its result card if it's already bloomed, otherwise the garden. */
  function openTodaysDaily(src) {
    daily.key = localKey();
    daily.friend = null;
    if (prefs.daily.results[daily.key]) showDailyCard(false);
    else startDaily(daily.key, { src });
  }

  // ------------------------------------------------------------ loading and home screens

  const LOADING_TIPS = [
    'Vines grow until something stops them. The order you tap is the puzzle.',
    'Undo always takes you back to a garden that can still bloom.',
    'Every garden can bloom. A solver checks each one.',
    'A new Daily Garden every day, the same for everyone.',
    'No timer, no lives. Take as long as you like.',
  ];

  /** The loading screen, only when the game starts: the bar fills as the artwork and the font
   *  arrive (at least 1.4 s, at most 6 s), then `then` runs and the loading screen fades away. */
  function runLoading(then) {
    const splash = $('loading');
    splash.hidden = false;
    $('loader-tip').textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
    const MIN = 1400, MAX = 6000, start = performance.now();
    const jobs = [
      new Promise((res) => {
        const img = new Image();
        img.onload = () => { $('splash-art').classList.add('ready'); res(); };
        img.onerror = res; // the green background still works without the art
        img.src = 'assets/home-bg.webp';
      }),
      (document.fonts && document.fonts.load ? document.fonts.load('900 48px Nunito') : Promise.resolve())
        .catch(() => {}).then(() => splash.classList.add('fonts')),
    ];
    let done = 0, shown = 0;
    jobs.forEach((p) => p.then(() => done++));
    // A timer rather than animation frames, so it still finishes if the page is in the background.
    const timer = setInterval(() => {
      const t = performance.now() - start;
      const ready = (done === jobs.length || t > MAX) && t >= MIN;
      const target = ready ? 1 : Math.min(0.94, 0.08 + 0.5 * (done / jobs.length) + 0.4 * Math.min(1, t / MIN));
      shown += (target - shown) * 0.14;
      if (ready && shown > 0.985) shown = 1;
      $('loader-fill').style.width = (shown * 100).toFixed(1) + '%';
      if (shown < 1) return;
      clearInterval(timer);
      splash.classList.add('fonts'); // show the title even if the font never arrived
      $('loader').classList.add('done');
      setTimeout(() => {
        then();
        // Fade the loading screen away over whatever comes next (home, or a friend's garden).
        splash.classList.add('leaving');
        setTimeout(() => { splash.hidden = true; }, 480);
      }, 280);
    }, 16);
  }

  function updateHomeDaily() {
    const done = !!prefs.daily.results[localKey()];
    const streak = dailyStreak();
    $('home-daily-dot').hidden = done;
    $('home-daily-check').hidden = !done;
    $('home-daily-sub').hidden = !done;
    $('home-daily-sub').textContent = streak >= 2 ? streak + ' days in a row' : 'Bloomed today';
  }

  /** The home screen: the play button with your level, the shop, the Daily Garden and settings. */
  function showHome() {
    const home = $('home');
    const wasOpen = !home.hidden && !home.classList.contains('leaving');
    home.classList.remove('leaving');
    $('home-level').textContent = prefs.level;
    $('btn-go').classList.remove('pressed');
    updateHomeDaily();
    updateCoins();
    toastEl.hidden = true;
    if (wasOpen) return;
    // Re-show it so the pop-ins and the blooming garden play each time home opens.
    home.hidden = true;
    void home.offsetWidth;
    home.hidden = false;
    if (window.HomeScene) window.HomeScene.start($('home-scene'));
  }

  function leaveHome() {
    const home = $('home');
    if (home.hidden || home.classList.contains('leaving')) return;
    home.classList.add('leaving');
    setTimeout(() => {
      if (!home.classList.contains('leaving')) return; // home was opened again meanwhile
      home.hidden = true;
      home.classList.remove('leaving');
      if (window.HomeScene) window.HomeScene.stop();
    }, 360);
  }

  /** The house button in a level: back home. The garden stays as it is, and GO carries on with it. */
  function goHomeFromLevel() {
    if (phase !== 'play') return; // not while a win or a loss is about to show
    Sound.unlock();
    Sound.click();
    cancelAim();
    hintSeed = -1;
    showHome();
  }

  function openSettings() {
    $('opt-ads').checked = prefs.ads;
    buildLevelGrid();
    show('menu');
  }

  /** GO: petals burst out of the button, then the player's level (or the one in progress) opens. */
  function play() {
    const btn = $('btn-go');
    if (btn.classList.contains('pressed')) return;
    Sound.unlock();
    Sound.bloom(4);
    vibrate(15);
    btn.classList.add('pressed');
    const r = btn.getBoundingClientRect();
    const colors = ['#ff6fa3', '#ffc23d', '#a77bff', '#58b4ff', '#3ed6c0', '#ffffff'];
    for (let j = 0; j < 16; j++) {
      const p = document.createElement('i');
      const a = (j / 16) * Math.PI * 2 + Math.random() * 0.3;
      const d = 90 + Math.random() * 90;
      p.className = 'burst';
      p.style.left = r.left + r.width / 2 + 'px';
      p.style.top = r.top + r.height / 2 + 'px';
      p.style.background = colors[j % colors.length];
      p.style.setProperty('--dx', Math.cos(a) * d * 1.4 + 'px');
      p.style.setProperty('--dy', Math.sin(a) * d + 'px');
      p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
    setTimeout(() => {
      // Carry on with the level on the board, if there is one in play; otherwise open the player's level.
      if (mode === 'levels' && phase === 'play' && boardLevel === prefs.level) leaveHome();
      else startLevel(prefs.level);
    }, 240);
  }

  /** Records the first bloom of a day's garden. Returns the coins earned. */
  function recordDaily() {
    const key = daily.key;
    if (prefs.daily.results[key]) return 0;
    const run = dailyRun();
    prefs.daily.results[key] = { taps: run.taps, undos: run.undos, hints: run.hints, seeds: board.seeds.length, onDay: key === localKey() };
    // Keep about four months of results.
    const oldest = L.dayNumber(localKey()) - 120;
    for (const k of Object.keys(prefs.daily.results)) if (!(L.dayNumber(k) >= oldest)) delete prefs.daily.results[k];
    const r = prefs.daily.results[key];
    const earned = r.onDay ? ECON.dailyCoins : 0; // only on the day, so old gardens can't be farmed for coins
    prefs.coins += earned;
    save();
    if (window.Telemetry) window.Telemetry.dailyWin(key, isPerfect(r));
    return earned;
  }

  const isPerfect = (r) => r.taps <= r.seeds && !r.undos && !r.hints;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

  /** 🌸 for each seed, 🍂 for each extra tap: the picture in the share message. */
  function dailyPicture(r) {
    const extra = Math.max(0, r.taps - r.seeds);
    return '🌸'.repeat(r.seeds) + '🍂'.repeat(Math.min(extra, 10)) + (extra > 10 ? '+' + (extra - 10) : '');
  }

  function shareMessage(key, r) {
    const how = isPerfect(r) ? 'Perfect bloom: ' + r.taps + ' taps, no undo, no hints'
      : 'Bloomed in ' + r.taps + ' taps · ' + (r.undos ? plural(r.undos, 'undo') : 'no undo') + ' · ' + (r.hints ? plural(r.hints, 'hint') : 'no hints');
    return 'Vinewise Daily Garden · ' + prettyDay(key, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) +
      '\n' + dailyPicture(r) + '\n' + how + '\n' + (isPerfect(r) ? 'Can you match it?' : 'Can you do it in fewer taps?');
  }

  function shareLink(key, r) {
    const base = cfg().shareUrl || (location.origin + location.pathname);
    return base + '?daily=' + key + '&t=' + r.taps + '&u=' + r.undos + '&h=' + r.hints + '&src=daily';
  }

  function untilTomorrow() {
    const now = new Date();
    const mins = Math.max(1, Math.ceil((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now) / 60000));
    return mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : plural(mins, 'minute');
  }

  /** The Daily Garden card: the result, the share button and the way back. */
  function showDailyCard(justWon, earned, replay) {
    const key = daily.key;
    const r = prefs.daily.results[key];
    if (!r) return;
    $('dw-title').textContent = isPerfect(r) ? 'Perfect bloom!' : 'Garden in bloom!';
    $('dw-sub').textContent = 'Daily Garden · ' + prettyDay(key);
    $('dw-taps').textContent = r.taps;
    $('dw-taps-label').textContent = r.taps === 1 ? 'tap' : 'taps';
    $('dw-undos').textContent = r.undos;
    $('dw-undos-label').textContent = r.undos === 1 ? 'undo' : 'undos';
    $('dw-hints').textContent = r.hints;
    $('dw-hints-label').textContent = r.hints === 1 ? 'hint' : 'hints';
    $('dw-picture').textContent = dailyPicture(r);
    $('dw-best').textContent = isPerfect(r) ? 'Every seed tapped once, in the right order.'
      : r.taps <= r.seeds ? 'The fewest taps possible, with ' + plural(r.hints, 'hint') + '.'
        : 'The fewest possible is ' + r.seeds + ' taps, one for each seed.';

    const f = daily.friend;
    const fr = $('dw-friend');
    fr.hidden = !f;
    if (f) {
      fr.textContent = r.taps < f.t ? 'Fewer taps than your friend: they took ' + f.t + '. 🌸'
        : r.taps === f.t ? 'Same as your friend: ' + f.t + ' taps.'
          : 'Your friend took ' + f.t + ' taps. Tomorrow’s another garden!';
    }
    const streak = dailyStreak();
    $('dw-streak').hidden = streak < 2;
    $('dw-streak').textContent = '🌼 ' + streak + ' days in a row';
    $('dw-coins').hidden = !earned;
    $('dw-coins').textContent = earned ? '+' + earned + ' coins' : '';
    $('dw-replay').hidden = !replay;
    $('btn-daily-again').hidden = justWon;
    $('btn-share').textContent = 'Share with a friend';
    $('share-text').hidden = true;
    $('dw-next').textContent = key === localKey() ? 'A new garden in ' + untilTomorrow() + '. Monday’s is gentle; Sunday’s is tough.'
      : 'Today’s garden is waiting too.';
    show('daily-win');
    if (earned) updateCoins(true);
  }

  async function shareDaily() {
    const key = daily.key;
    const r = prefs.daily.results[key];
    if (!r) return;
    const T = window.Telemetry;
    const text = shareMessage(key, r);
    const url = shareLink(key, r);
    const btn = $('btn-share');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Vinewise Daily Garden', text, url });
        if (T) T.dailyShare('share');
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // the player closed the share sheet
      }
    }
    const all = text + '\n' + url;
    try {
      await navigator.clipboard.writeText(all);
      btn.textContent = 'Copied! Paste it to a friend';
      setTimeout(() => { btn.textContent = 'Share with a friend'; }, 2600);
      if (T) T.dailyShare('copy');
      return;
    } catch (e) { /* clipboard blocked, e.g. inside an embed */ }
    // Last resort: show the message so it can be copied by hand.
    const ta = $('share-text');
    ta.value = all;
    ta.hidden = false;
    ta.focus();
    ta.select();
    btn.textContent = 'Copy this and send it to a friend';
    if (T) T.dailyShare('manual');
  }

  /** A shared link: ?daily=YYYY-MM-DD&t=9&u=1&h=0 (the friend's taps, undos, hints). */
  function linkedDaily() {
    try {
      const q = new URLSearchParams(location.search);
      let key = q.get('daily');
      if (!key) return null;
      // Tidy the address so a reload doesn't reopen the shared garden (`history` here is the taps list).
      try { window.history.replaceState(null, '', location.pathname); } catch (e) { /* not allowed in some embeds */ }
      if (isNaN(L.dayNumber(key))) return null;
      // No peeking ahead: a day after tomorrow (allowing for time zones) opens today's garden.
      if (L.dayNumber(key) > L.dayNumber(localKey()) + 1) key = localKey();
      const num = (v) => { const n = parseInt(v, 10); return n >= 0 && n < 1000 ? n : null; };
      const t = num(q.get('t'));
      const friend = t ? { t, u: num(q.get('u')) || 0, h: num(q.get('h')) || 0 } : null;
      return { key, friend };
    } catch (e) {
      return null;
    }
  }

  /** After any change to the board: schedule the win or the loss once the vines finish growing. */
  function checkEnd() {
    let endAt = performance.now();
    for (const v of vines.values()) endAt = Math.max(endAt, v.start + v.cells.length * GROW_MS);
    if (board.isComplete()) {
      phase = 'ending';
      pendingEnd = { type: 'win', at: endAt + 180 };
    } else if (board.isStuck()) {
      phase = 'ending';
      pendingEnd = { type: 'lose', at: endAt + 250 };
    }
  }

  function tapSeed(i) {
    const cells = board.apply(i);
    history.push(i);
    count('taps');
    const now = performance.now();
    vines.set(i, { i, cells, start: now, played: 0 });
    hintSeed = -1;
    Sound.tap();
    vibrate(8);

    if (cells.length === 0) {
      Sound.thud();
      puff(board.seeds[i]);
    }

    if (mode === 'levels' && prefs.level === 1) {
      handSeed = board.seeds.findIndex((_, j) => !board.isTapped(j));
    } else {
      handSeed = -1;
    }
    placeHand();
    checkEnd();
    updateHud();
  }

  /** Undo goes back to the most recent board that can still bloom: one tap while
   *  the garden is winnable, more when the mistake came earlier. */
  function undo() {
    if (!history.length || phase === 'won') return;
    count('undos');
    const steps = L.stepsToWinnable(board, history);
    for (let k = 0; k < steps; k++) {
      const i = history.pop();
      board.unapply(i);
      vines.delete(i);
    }
    token++;
    phase = 'play';
    pendingEnd = null;
    failStart = 0;
    hide('fail');
    Sound.click();
    updateHud();
    if (steps > 1 && history.length === 0) toast('Fresh start. The first tap was the tricky one.', 2600);
    else if (steps > 1) toast('Went back ' + steps + ' taps. It can bloom from here.', 2600);
  }

  function onWin(now) {
    phase = 'won';
    const isDaily = mode === 'daily';
    if (window.Telemetry && !isDaily) window.Telemetry.levelComplete(prefs.level);
    bloomStart = now;
    handSeed = -1;
    hintSeed = -1;
    aiming = null;
    placeHand();
    updateBoosters();
    let earned = 0;
    const replay = isDaily && !!prefs.daily.results[daily.key];
    if (isDaily) {
      earned = recordDaily();
      updateDailyBtn();
    } else if (prefs.level > prefs.completed) {
      // Coins only the first time a level is finished, so replays can't be farmed.
      prefs.completed = prefs.level;
      earned = ECON.coinsPerLevel;
      prefs.coins += earned;
      save();
    }
    $('win-coins').hidden = !earned;
    $('win-coins').textContent = earned ? '+' + earned + ' coins' : '';
    // After a level: point to today's Daily Garden if it's still waiting (not when the Quiet Garden offer is due).
    $('btn-win-daily').hidden = isDaily || prefs.completed < 3 || !!prefs.daily.results[localKey()] ||
      prefs.level === (cfg().offerAfterLevel || 10);
    const lastTap = history[history.length - 1];
    const last = lastTap !== undefined ? board.seeds[lastTap] : { x: level.w / 2, y: level.h / 2 };
    const n = level.w * level.h;
    bloomDelay = new Float32Array(n);
    bloomPlayed = new Uint8Array(n);
    let maxD = 0;
    for (let k = 0; k < n; k++) {
      if (level.cells[k] !== SOIL) continue;
      const x = k % level.w, y = (k / level.w) | 0;
      const d = Math.hypot(x - last.x, y - last.y) * 75 + ((k * 37) % 50);
      bloomDelay[k] = d;
      if (d > maxD) maxD = d;
    }
    setProgress(1);
    vibrate([12, 40, 12]);
    const t = token;
    setTimeout(() => { if (t === token) { Sound.win(); confetti(); } }, maxD + 250);
    setTimeout(() => {
      if (t !== token) return;
      if (isDaily) { showDailyCard(true, earned, replay); return; }
      $('win-sub').textContent = 'Level ' + prefs.level + ' complete';
      show('win');
      if (earned) updateCoins(true);
    }, maxD + 1200);
  }

  function onLose(now) {
    phase = 'lost';
    failStart = now;
    Sound.fail();
    vibrate(40);
    const n = board.remaining();
    $('fail-sub').textContent = n === 1 ? 'Just 1 patch left bare' : n + ' patches left bare';
    // A rewind all the way to the start is the same as Restart: show Try again instead,
    // and tell the player where the mistake was.
    const steps = L.stepsToWinnable(board, history);
    const fullRewind = steps === history.length;
    $('fail-undo-label').textContent = steps === 1 ? 'Undo last tap' : 'Rewind ' + steps + ' taps';
    $('btn-fail-undo').hidden = fullRewind;
    $('btn-retry').classList.toggle('primary', fullRewind);
    if (fullRewind) $('fail-sub').textContent += '. The first tap was the tricky one.';
    updateFailPlant();
    const t = token;
    setTimeout(() => { if (t === token && phase === 'lost') show('fail'); }, 1000);
  }

  function nextLevel() {
    hide('win');
    const done = prefs.level;
    const go = () => startLevel(done + 1);
    // Interstitial after level 5, then every 3 levels.
    const afterAds = () => {
      if (done >= 5 && (done - 5) % 3 === 0) runAd('interstitial', go);
      else go();
    };
    const T = window.Telemetry;
    if (T && !prefs.quiet && done === (cfg().offerAfterLevel || 10) && !T.offerSeen()) showOffer(afterAds);
    else afterAds();
  }

  // Test B (founder/launch.md): a pretend Quiet Garden offer, shown once. Nothing is sold.
  function showOffer(then) {
    const T = window.Telemetry;
    $('offer-price').textContent = T.price();
    T.offerShown();
    show('offer');
    $('btn-offer-skip').onclick = () => { hide('offer'); then(); };
    $('btn-offer-buy').onclick = () => {
      T.offerTap();
      hide('offer');
      const url = cfg().waitlistUrl;
      const link = $('btn-offer-list');
      link.hidden = !url;
      if (url) link.href = url;
      show('offer-thanks');
    };
    $('btn-offer-list').onclick = () => T.waitlistClick();
    $('btn-offer-back').onclick = () => { hide('offer-thanks'); then(); };
  }

  function cfg() { return window.VINEWISE_CONFIG || {}; }

  // ------------------------------------------------------------ coins & garden helpers

  function updateCoins(bump) {
    $('coin-count').textContent = prefs.coins.toLocaleString();
    $('home-coin-count').textContent = prefs.coins.toLocaleString();
    if (bump) {
      const pill = $('btn-coins');
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
    }
  }

  function updateBoosters() {
    for (const id of Object.keys(ITEMS)) {
      const btn = $('bst-' + id);
      const n = prefs.items[id] || 0;
      btn.classList.toggle('active', aiming === id);
      btn.classList.toggle('buy', n <= 0);
      btn.disabled = phase !== 'play';
      const badge = $('cnt-' + id);
      if (n > 0) badge.textContent = '×' + n;
      else badge.innerHTML = '<span class="coin"></span>' + ECON.prices[id];
    }
  }

  function onBooster(id) {
    Sound.unlock();
    if (phase !== 'play') return;
    if (aiming === id) { cancelAim(); toastEl.hidden = true; return; }
    if ((prefs.items[id] || 0) <= 0) { openShop(id); return; }
    aiming = id;
    hintSeed = -1;
    handSeed = -1;
    placeHand();
    toast(ITEMS[id].help, 4000);
    updateBoosters();
  }

  function cancelAim() {
    aiming = null;
    updateBoosters();
  }

  function useItem(id, where) {
    prefs.items[id] = Math.max(0, (prefs.items[id] || 0) - 1);
    save();
    if (window.Telemetry) window.Telemetry.boosterUsed(id + (where ? '-' + where : ''));
  }

  /** The player tapped the board while a helper was waiting for a target. */
  function aimAt(x, y) {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) { cancelAim(); toastEl.hidden = true; return; }
    const k = y * level.w + x;
    if (aiming === 'seed') {
      if (level.cells[k] !== SOIL || board.owner[k] >= 0) { toast('Pick a bare brown patch.', 1800); return; }
      board.plant(k);
      plants.set(k, performance.now());
      useItem('seed');
      Sound.bloom(3);
      vibrate(10);
    } else if (aiming === 'shears') {
      const i = board.owner[k];
      if (i < 0 || i === L.PLANT || !board.isTapped(i)) { toast('Pick a vine you grew.', 1800); return; }
      board.unapply(i);
      history.splice(history.indexOf(i), 1);
      vines.delete(i);
      useItem('shears');
      Sound.click();
      vibrate(10);
    } else if (aiming === 'breeze') {
      const i = board.seedIndexAt(x, y);
      if (i < 0 || board.isTapped(i)) { toast('Pick a seed that hasn’t grown yet.', 1800); return; }
      board.turnSeed(i);
      useItem('breeze');
      Sound.tap();
    }
    toastEl.hidden = true;
    cancelAim();
    checkEnd();
    updateHud();
  }

  /** Fail screen: Flower Seeds can finish a garden that's 3 or fewer patches short. */
  function updateFailPlant() {
    const n = board.remaining();
    const btn = $('btn-fail-plant');
    const have = prefs.items.seed || 0;
    // Quiet Garden owners are never offered a purchase: only seeds they already have.
    btn.hidden = !(mode === 'levels' && n <= 3 && prefs.level >= ECON.unlockLevel && (!prefs.quiet || have >= n));
    if (btn.hidden) return;
    const cost = Math.max(0, n - have) * ECON.prices.seed;
    const what = n === 1 ? 'a flower' : n + ' flowers';
    $('fail-plant-label').textContent = have >= n ? 'Plant ' + what + ' and finish'
      : prefs.coins >= cost ? 'Plant ' + what + ' and finish (' + cost + ' coins)'
        : 'Get Flower Seeds';
  }

  /** From the fail screen: plant flowers on every bare patch and finish the garden. */
  function finishWithFlowers() {
    const bare = [];
    for (let k = 0; k < level.cells.length; k++) if (level.cells[k] === SOIL && board.owner[k] < 0) bare.push(k);
    const need = Math.max(0, bare.length - (prefs.items.seed || 0));
    const cost = need * ECON.prices.seed;
    if (prefs.coins < cost) {
      hide('fail');
      openShop('seed', () => { if (phase === 'lost') { updateFailPlant(); show('fail'); } });
      return;
    }
    if (need) { prefs.coins -= cost; prefs.items.seed = (prefs.items.seed || 0) + need; updateCoins(); }
    hide('fail');
    token++;
    failStart = 0;
    phase = 'play';
    const now = performance.now();
    bare.forEach((k, j) => { board.plant(k); plants.set(k, now + j * 120); useItem('seed', 'fail'); });
    Sound.bloom(3);
    checkEnd();
    updateHud();
  }

  // ------------------------------------------------------------ the shop

  let shopClosed = null;
  function openShop(focus, onClose) {
    cancelAim();
    shopClosed = onClose || null;
    renderShop(focus);
    show('shop');
    if (window.Telemetry) window.Telemetry.shopOpen();
  }

  function closeShop() {
    hide('shop');
    const f = shopClosed;
    shopClosed = null;
    if (f) f();
  }

  function renderShop(focus) {
    // Quiet Garden leads the shop; once owned, no ad offers appear anywhere.
    $('quiet-card').hidden = prefs.quiet;
    $('quiet-owned').hidden = !prefs.quiet;
    $('btn-quiet').textContent = ECON.quietGardenPrice;
    $('btn-coins-ad').hidden = prefs.quiet;
    $('shop-coins').textContent = prefs.coins.toLocaleString();
    const list = $('shop-items');
    list.textContent = '';
    for (const id of Object.keys(ITEMS)) {
      const it = ITEMS[id], price = ECON.prices[id];
      const row = document.createElement('div');
      row.className = 'shop-row' + (id === focus ? ' focus' : '');
      const icon = document.createElement('span');
      icon.className = 's-icon';
      icon.textContent = it.icon;
      const text = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = it.name + ' · you have ' + (prefs.items[id] || 0);
      const small = document.createElement('small');
      small.textContent = it.desc;
      text.append(b, small);
      const buy = document.createElement('button');
      buy.className = 'btn s-buy';
      buy.innerHTML = '<span class="coin"></span>' + price;
      buy.disabled = prefs.coins < price;
      buy.onclick = () => {
        if (prefs.coins < price) return;
        prefs.coins -= price;
        prefs.items[id] = (prefs.items[id] || 0) + 1;
        save();
        Sound.click();
        updateCoins();
        updateBoosters();
        renderShop(id);
      };
      row.append(icon, text, buy);
      list.appendChild(row);
    }

    const packs = $('shop-packs');
    packs.textContent = '';
    for (const p of ECON.packs) {
      const btn = document.createElement('button');
      btn.className = 'btn pack';
      btn.innerHTML = '<span><span class="coin"></span> ' + p.coins.toLocaleString() + '</span><small>' + p.price + '</small>';
      btn.onclick = () => buyPack(p);
      packs.appendChild(btn);
    }

    const today = new Date().toDateString();
    if (prefs.adCoins.day !== today) prefs.adCoins = { day: today, n: 0 };
    const left = ECON.adCoinsPerDay - prefs.adCoins.n;
    $('btn-coins-ad').disabled = left <= 0;
    $('coins-ad-label').textContent = left > 0
      ? 'Watch an ad: +' + ECON.coinsPerAd + ' coins (' + left + ' left today)'
      : 'No more ad coins today';
  }

  function buyPack(p) {
    if (window.Telemetry) window.Telemetry.coinPackTap(p.id);
    if (cfg().publicDemo) {
      toast('Coin packs aren’t on sale in this demo. Nothing was charged. Thank you!', 3200);
      return;
    }
    // Private build: a mock purchase so the flow can be felt. The real game uses Google Play billing.
    prefs.coins += p.coins;
    save();
    updateCoins(true);
    renderShop();
    toast('Mock purchase: +' + p.coins.toLocaleString() + ' coins. Nothing was charged.', 2800);
  }

  function buyQuiet() {
    if (window.Telemetry) window.Telemetry.coinPackTap('quiet-garden');
    if (cfg().publicDemo) {
      toast('Quiet Garden isn’t on sale in this demo. Nothing was charged. Thank you!', 3200);
      return;
    }
    // Private build: a mock purchase. The real game uses Google Play billing.
    prefs.quiet = true;
    save();
    renderShop();
    updateHintBadge();
    toast('Mock purchase: Quiet Garden is on. No ads, ever. Nothing was charged.', 3000);
  }

  function adForCoins() {
    runAd('rewarded', () => {
      prefs.adCoins.n++;
      prefs.coins += ECON.coinsPerAd;
      save();
      updateCoins(true);
      renderShop();
      toast('+' + ECON.coinsPerAd + ' coins', 1600);
    });
  }

  // ------------------------------------------------------------ hints & ads

  function hint() {
    if (phase !== 'play') return;
    const sol = L.findSolution(board);
    if (!sol) {
      toast('This garden can’t be finished now. Try Undo.', 2600);
      return;
    }
    const showHint = () => {
      count('hints');
      hintSeed = sol[0];
      handSeed = sol[0];
      placeHand();
    };
    // One free hint a day; after that a hint is behind an optional ad (none with Quiet Garden).
    if (prefs.hintDay !== today()) {
      prefs.hintDay = today();
      save();
      updateHintBadge();
      toast('Your free hint for today 💡', 1800);
      showHint();
      return;
    }
    runAd('rewarded', showHint);
  }

  function updateHintBadge() {
    const badge = $('hint-badge');
    const free = prefs.hintDay !== today();
    badge.hidden = prefs.quiet && !free;
    badge.textContent = free ? 'FREE' : '▶ AD';
    badge.classList.toggle('free', free);
  }

  /** One free helper the first time the player opens the game each day (rotates through the three). */
  function dailyGift() {
    if (!ECON.dailyGift || prefs.level < ECON.unlockLevel || prefs.giftDay === today()) return false;
    prefs.giftDay = today();
    const ids = Object.keys(ITEMS);
    const id = ids[Math.floor(Date.now() / 86400000) % ids.length];
    prefs.items[id] = (prefs.items[id] || 0) + 1;
    save();
    updateBoosters();
    toast('Daily gift: 1 ' + ITEMS[id].name + ' ' + ITEMS[id].icon, 3000);
    return true;
  }

  function runAd(kind, done) {
    if (!prefs.ads || prefs.quiet) { done(); return; }
    const rewarded = kind === 'rewarded';
    $('ad-tag').textContent = rewarded ? 'Rewarded ad' : 'Ad';
    const skip = $('btn-ad-skip');
    skip.hidden = true;
    show('ad');
    let left = 3;
    $('ad-count').textContent = left;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      hide('ad');
      done();
    };
    const timer = setInterval(() => {
      left--;
      $('ad-count').textContent = Math.max(left, 0);
      if (!rewarded && left <= 1) skip.hidden = false;
      if (left <= 0) finish();
    }, 1000);
    skip.onclick = finish;
  }

  // ------------------------------------------------------------ HUD

  function setProgress(f) {
    $('progress-fill').style.width = Math.round(f * 100) + '%';
  }

  function updateHud() {
    let c = 0;
    for (let i = 0; i < board.seeds.length; i++) if (board.isTapped(i)) c += 1 + board.lens[i];
    setProgress(phase === 'won' ? 1 : c / board.soil);
    $('btn-undo').disabled = history.length === 0 || phase === 'won';
    $('btn-hint').disabled = phase !== 'play';
    updateBoosters();
    updateHintBadge();
  }

  function placeHand() {
    if (handSeed < 0 || !level) { handEl.hidden = true; return; }
    const s = board.seeds[handSeed];
    const [x, y] = cellCenter(s.x, s.y);
    handEl.style.left = x + 'px';
    handEl.style.top = y + 'px';
    handEl.hidden = false;
  }

  // ------------------------------------------------------------ layout & input

  function layout() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    view.dpr = dpr;
    view.w = r.width;
    view.h = r.height;
    if (!level) return;
    const pad = 8;
    view.cs = Math.floor(Math.min((r.width - pad * 2) / level.w, (r.height - pad * 2) / level.h, 92));
    view.ox = Math.round((r.width - view.cs * level.w) / 2);
    view.oy = Math.round((r.height - view.cs * level.h) / 2);
    placeHand();
  }

  canvas.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    if (phase !== 'play') return;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - view.ox) / view.cs);
    const y = Math.floor((e.clientY - r.top - view.oy) / view.cs);
    if (aiming) { aimAt(x, y); return; }
    const i = board.seedIndexAt(x, y);
    if (i >= 0 && !board.isTapped(i)) tapSeed(i);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

  // ------------------------------------------------------------ effects

  function puff(seed) {
    const [x, y] = cellCenter(seed.x, seed.y);
    for (let j = 0; j < 9; j++) {
      const a = (j / 9) * Math.PI * 2;
      fx.push({ kind: 'dust', x, y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.45, age: 0, r: view.cs * 0.07 });
    }
  }

  function confetti() {
    const colors = board.seeds.map((s) => s.color);
    for (let j = 0; j < 46; j++) {
      fx.push({
        kind: 'petal',
        x: Math.random() * view.w,
        y: -20 - Math.random() * view.h * 0.35,
        vx: (Math.random() - 0.5) * 50,
        vy: 70 + Math.random() * 90,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 6,
        sway: Math.random() * 6.28,
        color: colors[j % colors.length],
        r: view.cs * (0.1 + Math.random() * 0.08),
        life: 6,
        age: 0,
      });
    }
  }

  function drawFx(dt) {
    fx = fx.filter((p) => (p.age += dt) < p.life && p.y < view.h + 40);
    for (const p of fx) {
      if (p.kind === 'dust') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const t = p.age / p.life;
        ctx.fillStyle = 'rgba(120, 80, 50,' + (0.5 * (1 - t)) + ')';
        circle(p.x, p.y, p.r * (1 + t));
        ctx.fill();
      } else {
        p.sway += dt * 2.5;
        p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------ drawing

  const DIRT = [176, 120, 80], DIRT_SH = [116, 74, 46];
  const MOSS = [140, 204, 98], MOSS_SH = [88, 152, 64];

  function vineProgress(v, now) {
    return clamp((now - v.start) / GROW_MS, 0, v.cells.length);
  }

  /** How green each tile is right now (0 = bare dirt, 1 = covered). */
  function coverage(now) {
    const cov = new Float32Array(level.w * level.h);
    for (const v of vines.values()) {
      const s = board.seeds[v.i];
      cov[s.y * level.w + s.x] = clamp((now - v.start) / 140, 0, 1);
      const p = vineProgress(v, now);
      for (let j = 0; j < v.cells.length; j++) cov[v.cells[j]] = clamp(p - j, 0, 1);
    }
    for (const [k, start] of plants) cov[k] = clamp((now - start) / 220, 0, 1);
    return cov;
  }

  /** Flowers planted by the Flower Seed helper (during play; the win bloom draws its own). */
  function drawPlants(now) {
    if (phase === 'won') return;
    for (const [k, start] of plants) {
      const t = clamp((now - start) / 380, 0, 1);
      if (t <= 0) continue;
      const [x, y] = cellCenter(k % level.w, (k / level.w) | 0);
      drawFlower(x, y - view.cs * 0.03, view.cs * 0.3 * easeOutBack(t), PLANT_COLOR, k * 0.9);
    }
  }

  /** While a helper waits for a target, outline everything it can be used on. */
  function drawAimTargets(now) {
    if (!aiming || phase !== 'play') return;
    const cs = view.cs, a = 0.55 + 0.35 * Math.sin(now / 160);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
    ctx.lineWidth = Math.max(2, cs * 0.06);
    ctx.setLineDash([cs * 0.12, cs * 0.08]);
    for (let k = 0; k < level.cells.length; k++) {
      const x = k % level.w, y = (k / level.w) | 0;
      const o = board.owner[k];
      const target = aiming === 'seed' ? level.cells[k] === SOIL && o < 0
        : aiming === 'shears' ? o >= 0 && o !== L.PLANT && board.isTapped(o) && board.seedIndexAt(x, y) === o
          : board.seedIndexAt(x, y) >= 0 && !board.isTapped(board.seedIndexAt(x, y));
      if (!target) continue;
      const g = cs * 0.1;
      rr(view.ox + x * cs + g, view.oy + y * cs + g, cs - 2 * g, cs - 2 * g, cs * 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTiles(now, cov) {
    const { cs, ox, oy } = view;
    const g = Math.max(1.5, cs * 0.045), r = cs * 0.22, depth = cs * 0.08;
    const s = cs - 2 * g;
    const failT = phase === 'lost' ? (now - failStart) / 1000 : 0;
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        const k = y * level.w + x;
        const c = level.cells[k];
        if (c === VOID) continue;
        let px = ox + x * cs + g;
        const py = oy + y * cs + g;

        if (c === ROCK) {
          ctx.fillStyle = '#7d8890';
          rr(px, py + depth, s, s - depth, r); ctx.fill();
          ctx.fillStyle = '#b9c2c9';
          rr(px, py, s, s - depth, r); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath();
          ctx.ellipse(px + s * 0.32, py + s * 0.26, s * 0.15, s * 0.08, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(80,90,98,0.45)';
          ctx.lineWidth = Math.max(1, cs * 0.03);
          ctx.beginPath();
          ctx.moveTo(px + s * 0.56, py + s * 0.34);
          ctx.lineTo(px + s * 0.47, py + s * 0.5);
          ctx.lineTo(px + s * 0.6, py + s * 0.64);
          ctx.stroke();
          continue;
        }

        const bare = board.owner[k] < 0;
        if (failT > 0 && bare) px += Math.sin(failT * 45) * cs * 0.06 * Math.max(0, 1 - failT * 1.6);

        const t = cov[k];
        ctx.fillStyle = rgb(DIRT_SH, MOSS_SH, t);
        rr(px, py + depth, s, s - depth, r); ctx.fill();
        ctx.fillStyle = rgb(DIRT, MOSS, t);
        rr(px, py, s, s - depth, r); ctx.fill();

        if (t < 1) {
          ctx.fillStyle = 'rgba(105, 66, 38,' + (0.5 * (1 - t)) + ')';
          for (const sp of speckles[k]) { circle(px + sp[0] * s, py + sp[1] * s, sp[2] * s); ctx.fill(); }
        }
        if (phase === 'lost' && bare) {
          ctx.fillStyle = 'rgba(255, 70, 70,' + (0.22 + 0.14 * Math.sin(now / 160)) + ')';
          rr(px, py, s, s - depth, r); ctx.fill();
        }
      }
    }
  }

  function drawLeaf(x, y, ang, len) {
    if (len <= 0.5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = '#3f9a44';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -len * 0.48, len, 0);
    ctx.quadraticCurveTo(len * 0.5, len * 0.48, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(25, 90, 35, 0.55)';
    ctx.lineWidth = Math.max(1, len * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * 0.8, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawVines(now) {
    const cs = view.cs;
    for (const v of vines.values()) {
      const s = board.seeds[v.i], d = DIRS[s.dir];
      const p = vineProgress(v, now);
      const [cx, cy] = cellCenter(s.x, s.y);
      const ang = Math.atan2(d.dy, d.dx);

      const reached = Math.floor(p + 1e-6);
      while (v.played < reached) { Sound.grow(v.played); v.played++; }

      if (p > 0) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#2f7d32';
        ctx.lineWidth = cs * 0.15;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + d.dx * p * cs, cy + d.dy * p * cs);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = cs * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx - d.dy * cs * 0.03, cy + d.dx * cs * 0.03);
        ctx.lineTo(cx + d.dx * p * cs - d.dy * cs * 0.03, cy + d.dy * p * cs + d.dx * cs * 0.03);
        ctx.stroke();
      }

      for (let j = 0; j < v.cells.length; j++) {
        // Leaves sprout between patches, buds sit on each patch.
        const tl = clamp((p - j - 0.35) / 0.5, 0, 1);
        if (tl <= 0) break;
        const side = j % 2 ? 1 : -1;
        const lx = cx + d.dx * (j + 0.5) * cs, ly = cy + d.dy * (j + 0.5) * cs;
        drawLeaf(lx, ly, ang + side * 1.05, cs * 0.3 * easeOutBack(tl));
        const tb = clamp((p - j - 0.8) / 0.4, 0, 1);
        if (tb > 0 && phase !== 'won') {
          const [bx, by] = cellCenter(v.cells[j] % level.w, (v.cells[j] / level.w) | 0);
          const br = cs * 0.1 * easeOutBack(tb);
          ctx.fillStyle = s.color;
          circle(bx, by, br); ctx.fill();
          ctx.strokeStyle = darker(s.color, 0.72);
          ctx.lineWidth = Math.max(1, cs * 0.025);
          ctx.stroke();
        }
      }
    }
  }

  function drawArrow(cx, cy, dir, size) {
    const d = DIRS[dir];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(d.dy, d.dx));
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = size * 0.42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-size * 0.32, -size * 0.66);
    ctx.lineTo(size * 0.38, 0);
    ctx.lineTo(-size * 0.32, size * 0.66);
    ctx.stroke();
    ctx.restore();
  }

  function drawSeeds(now) {
    const cs = view.cs;
    board.seeds.forEach((s, i) => {
      const [cx, cy] = cellCenter(s.x, s.y);
      const y0 = cy - cs * 0.03;
      if (!board.isTapped(i)) {
        const bob = 1 + 0.05 * Math.sin(now / 260 + i * 1.7);
        const R = cs * 0.33 * bob;
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + cs * 0.27, R * 0.85, R * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = s.color;
        circle(cx, y0, R); ctx.fill();
        ctx.strokeStyle = darker(s.color, 0.72);
        ctx.lineWidth = cs * 0.045;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.beginPath();
        ctx.ellipse(cx - R * 0.38, y0 - R * 0.42, R * 0.26, R * 0.16, -0.6, 0, Math.PI * 2);
        ctx.fill();
        drawArrow(cx, y0, s.dir, R * 0.58);
      } else if (phase !== 'won') {
        const v = vines.get(i);
        const t = clamp((now - v.start) / 260, 0, 1);
        const R = cs * 0.2 * (1 + 0.35 * Math.sin(t * Math.PI));
        ctx.fillStyle = s.color;
        circle(cx, cy, R); ctx.fill();
        ctx.strokeStyle = darker(s.color, 0.72);
        ctx.lineWidth = Math.max(1, cs * 0.035);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        circle(cx - R * 0.3, cy - R * 0.3, R * 0.28); ctx.fill();
      }
    });

    if (hintSeed >= 0 && !board.isTapped(hintSeed)) {
      const s = board.seeds[hintSeed];
      const [cx, cy] = cellCenter(s.x, s.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = cs * 0.06;
      circle(cx, cy - cs * 0.03, cs * (0.44 + 0.04 * Math.sin(now / 140)));
      ctx.stroke();
    }
  }

  function drawFlower(x, y, r, color, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    for (let p = 0; p < 5; p++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.ellipse(r * 0.52, 0, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = darker(color, 0.8);
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (let p = 0; p < 5; p++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.ellipse(r * 0.52, 0, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color === '#ffc23d' ? '#ff8a3d' : '#ffe066';
    circle(0, 0, r * 0.3); ctx.fill();
    ctx.restore();
  }

  function drawBlooms(now) {
    const cs = view.cs;
    for (let k = 0; k < level.w * level.h; k++) {
      if (level.cells[k] !== SOIL) continue;
      const t = clamp((now - bloomStart - bloomDelay[k]) / 380, 0, 1);
      if (t <= 0) continue;
      if (!bloomPlayed[k]) { bloomPlayed[k] = 1; Sound.bloom(k % 7); }
      const o = board.owner[k];
      const color = o === L.PLANT ? PLANT_COLOR : o >= 0 ? board.seeds[o].color : '#ffffff';
      const [x, y] = cellCenter(k % level.w, (k / level.w) | 0);
      drawFlower(x, y - cs * 0.03, cs * 0.36 * easeOutBack(t), color, k * 0.9 + (now - bloomStart) / 5000);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    render(now);
  }

  function render(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (!level) return;

    // Game logic first: a win or loss must resolve even if there's nothing to draw yet.
    if (pendingEnd && now >= pendingEnd.at) {
      const type = pendingEnd.type;
      pendingEnd = null;
      if (type === 'win') onWin(now);
      else onLose(now);
      updateHud();
    }
    if (view.cs < 4) return;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    const cov = coverage(now);
    drawTiles(now, cov);
    drawVines(now);
    drawPlants(now);
    drawSeeds(now);
    drawAimTargets(now);
    if (phase === 'won') drawBlooms(now);
    drawFx(dt);
  }

  // ------------------------------------------------------------ menu

  function buildLevelGrid() {
    const grid = $('level-grid');
    grid.textContent = '';
    const last = Math.max(LAST_DATA_LEVEL, prefs.maxLevel);
    for (let n = 1; n <= last; n++) {
      const b = document.createElement('button');
      b.textContent = n;
      if (n === prefs.level) b.className = 'current';
      else if (n < prefs.maxLevel) b.className = 'done';
      b.onclick = () => { hide('menu'); startLevel(n); };
      if (cfg().publicDemo && n > prefs.maxLevel) b.disabled = true;
      grid.appendChild(b);
    }
  }

  function applySound() {
    Sound.enabled = prefs.sound;
    $('opt-sound').checked = prefs.sound;
  }

  // ------------------------------------------------------------ wiring

  const restart = () => (mode === 'daily' ? startDaily(daily.key, { retry: true }) : startLevel(prefs.level));
  $('btn-restart').onclick = () => { Sound.click(); restart(); };
  // Undo is always free: in a puzzle where the order is everything, undo is how players learn.
  $('btn-undo').onclick = () => { if (history.length) undo(); };
  $('btn-hint').onclick = hint;
  $('btn-next').onclick = nextLevel;
  $('btn-retry').onclick = () => { hide('fail'); restart(); };
  $('btn-share').onclick = shareDaily;
  $('btn-daily-back').onclick = () => { Sound.click(); leaveDaily(); };
  $('btn-daily-again').onclick = () => { Sound.click(); startDaily(daily.key, { src: 'again' }); };
  // Home screen, and the house button that leads back to it from a level.
  $('btn-go').onclick = play;
  $('home-daily').onclick = () => { Sound.unlock(); Sound.click(); openTodaysDaily('home'); };
  $('home-shop').onclick = () => { Sound.unlock(); Sound.click(); openShop(); };
  $('home-coins').onclick = () => { Sound.unlock(); openShop(); };
  $('home-menu').onclick = () => { Sound.unlock(); Sound.click(); openSettings(); };
  $('btn-home-level').onclick = goHomeFromLevel;
  // From the level's win card: move on to the next level, but play today's Daily Garden first.
  $('btn-win-daily').onclick = () => {
    hide('win');
    prefs.level += 1;
    prefs.maxLevel = Math.max(prefs.maxLevel, prefs.level);
    daily.friend = null;
    startDaily(localKey(), { src: 'win' });
  };
  $('btn-fail-undo').onclick = () => { hide('fail'); undo(); };
  $('btn-fail-plant').onclick = finishWithFlowers;
  $('btn-coins').onclick = () => { Sound.unlock(); openShop(); };
  $('btn-close-shop').onclick = closeShop;
  $('btn-coins-ad').onclick = adForCoins;
  $('btn-quiet').onclick = buyQuiet;
  for (const id of Object.keys(ITEMS)) $('bst-' + id).onclick = () => onBooster(id);
  $('btn-close-menu').onclick = () => hide('menu');
  $('opt-sound').onchange = (e) => { prefs.sound = e.target.checked; save(); applySound(); };
  $('opt-ads').onchange = (e) => { prefs.ads = e.target.checked; save(); };
  // Two-tap confirm (browser confirm() dialogs are blocked in some embeds).
  let resetArmed = 0;
  $('btn-reset').onclick = () => {
    const btn = $('btn-reset');
    if (!resetArmed) {
      btn.textContent = 'Tap again to start over';
      resetArmed = setTimeout(() => { resetArmed = 0; btn.textContent = 'Reset progress'; }, 3000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = 0;
    btn.textContent = 'Reset progress';
    prefs.level = 1;
    prefs.maxLevel = 1;
    prefs.completed = 0;
    prefs.coins = ECON.startCoins;
    prefs.items = Object.assign({}, ECON.startItems);
    prefs.helpersIntro = false;
    prefs.giftDay = '';
    prefs.hintDay = '';
    prefs.quiet = false;
    prefs.daily = { results: {}, run: null };
    save();
    hide('menu');
    showHome(); // settings open from home, so stay there, now at level 1
  };

  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  else window.addEventListener('resize', layout);

  // Boot. When hosted as a claude.ai artifact, keep the level in progress across updates.
  function boot(data) {
    applySound();
    if (cfg().publicDemo) {
      $('row-ads').hidden = true; // every public player gets the same ad schedule
      prefs.ads = true;
    }
    if (window.Telemetry) window.Telemetry.sessionStart();
    const link = linkedDaily();
    requestAnimationFrame(frame);
    if (!link && data && data.level) {
      // The artifact was updated mid-game: skip the loading and home screens and carry on.
      $('loading').hidden = true;
      if (data.daily && !isNaN(L.dayNumber(data.daily))) startDaily(data.daily, { retry: true });
      else startLevel(data.level);
      replay(data.history);
      return;
    }
    runLoading(() => {
      if (!link) { showHome(); return; }
      // A friend's shared garden: straight into it, no home screen in the way.
      startDaily(link.key, { src: 'link', friend: link.friend });
      // Already bloomed that day's garden: show how you compare straight away.
      if (prefs.daily.results[link.key]) showDailyCard(false);
    });
  }

  function replay(taps) {
    if (Array.isArray(taps)) {
      // Replaying the taps of an attempt in progress shouldn't count them twice.
      const run = prefs.daily.run, before = run && Object.assign({}, run);
      for (const i of taps) if (phase === 'play' && i < board.seeds.length && !board.isTapped(i)) tapSeed(i);
      if (before) { prefs.daily.run = before; save(); }
    }
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    hot.snapshot(() => ({
      level: prefs.level,
      daily: mode === 'daily' ? daily.key : '',
      history: phase === 'play' ? history.slice() : [],
    }));
  }
  if (hot && hot.ready) hot.ready(boot);
  else boot((hot && hot.data) || {});

  // Exposed for quick testing from the console.
  window.Bloom = {
    startLevel,
    startDaily,
    showHome,
    play,
    showDailyCard,
    shareMessage: () => prefs.daily.results[daily.key] && shareMessage(daily.key, prefs.daily.results[daily.key]),
    shareLink: () => prefs.daily.results[daily.key] && shareLink(daily.key, prefs.daily.results[daily.key]),
    get mode() { return mode; },
    get view() { return Object.assign({}, view); }, // where the board is drawn (for test screenshots)
    get daily() { return Object.assign({ run: prefs.daily.run, results: prefs.daily.results }, daily); },
    render, // draw one frame by hand (e.g. when the tab is hidden and rAF is paused)
    tapSeed: (i) => phase === 'play' && tapSeed(i),
    aimAt: (x, y) => aiming && aimAt(x, y),
    get board() { return board; },
    get phase() { return phase; },
    get prefs() { return prefs; },
    get history() { return history.slice(); },
  };
})();
