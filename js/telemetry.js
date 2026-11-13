/* Vinewise: anonymous event counts for the public demo test.
 *
 * Sends small events (no player ID, no personal data) to the URL in
 * VINEWISE_CONFIG.eventsUrl. On this device it remembers only: which test price
 * the player was assigned, the first day they played, and which events were
 * already sent (so each is counted once). Only the public demo build sends; with
 * no URL set, or in the private build, nothing leaves the device and events are
 * written to the browser console for testing.
 */
(function () {
  'use strict';

  const KEY = 'vinewise.test.v1';
  const MILESTONES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
  const cfg = () => window.VINEWISE_CONFIG || {};

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private mode */ }
  }
  // Whole days since 1970 in the player's own time zone.
  function dayNum() {
    const d = new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }

  const st = load();
  if (st.variant === undefined) {
    st.variant = Math.random() < 0.5 ? 0 : 1;
    st.first = dayNum();
    st.done = {};
    save();
  }
  st.done = st.done || {};

  function price() {
    const p = cfg().prices || ['$2.99', '$3.99'];
    return p[st.variant % p.length];
  }

  // Which clip or link brought the player: ?src=clip07 on the page address.
  function source() {
    try {
      const q = new URLSearchParams(location.search).get('src');
      if (q) return q.replace(/[^\w-]/g, '').slice(0, 40);
    } catch (e) { /* ignore */ }
    return '';
  }

  function send(event, extra) {
    const body = JSON.stringify(Object.assign({
      event,
      variant: price(),
      day: dayNum() - st.first,
      t: new Date().toISOString(),
    }, extra || {}));
    const url = cfg().eventsUrl;
    // Only the public demo counts (publicDemo is switched on by tools/build_demo.py), so the
    // founder's own plays on the private link or a dev copy never land in the test data.
    if (!url || !cfg().publicDemo) {
      if (window.console) console.debug('[vinewise test, not sent]', body);
      return;
    }
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
      fetch(url, { method: 'POST', mode: 'no-cors', body, keepalive: true });
    } catch (e) { /* counting must never break the game */ }
  }

  function once(key, event, extra) {
    if (st.done[key]) return;
    st.done[key] = 1;
    save();
    send(event, extra);
  }

  window.Telemetry = {
    price,
    // Once per calendar day: day 0 = a new player, day 1 = came back the next day, ...
    sessionStart() { once('day' + (dayNum() - st.first), 'session_start', { src: source() }); },
    levelComplete(n) { if (MILESTONES.indexOf(n) >= 0) once('lvl' + n, 'level_complete', { level: n }); },
    offerSeen() { return !!st.done.offer_shown; },
    offerShown() { once('offer_shown', 'offer_shown'); },
    offerTap() { once('offer_tap', 'offer_tap'); },
    waitlistClick() { once('waitlist_click', 'waitlist_click'); },
    // Coins and helpers: counted every time, not once.
    boosterUsed(item) { send('booster_used', { item }); },
    coinPackTap(pack) { send('coin_pack_tap', { item: pack }); },
    shopOpen() { send('shop_open'); },
    // Daily Garden. Where it was started from: button (in the game), home, link (a friend's share), win (the level's win card), again.
    dailyStart(from) { send('daily_start', { item: from }); },
    dailyWin(key, perfect) { once('daily-' + key, 'daily_win', { item: perfect ? 'perfect' : 'bloom' }); },
    // How it was shared: share (the phone's share sheet), copy, manual (copied by hand).
    dailyShare(how) { send('daily_share', { item: how }); },
  };
})();
