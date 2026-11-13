/* Vinewise: settings for the public demo test (test A and B in founder/launch.md).
 * Fill these in before building the upload (see docs/test-a.md). Both can stay
 * empty: the game still works and simply records nothing. */
window.VINEWISE_CONFIG = {
  // Google Apps Script web-app URL that records anonymous events into your Sheet.
  // Only the public demo build sends to it (see js/telemetry.js).
  eventsUrl: 'https://script.google.com/macros/s/AKfycbxIEc-whSs57YguulibOEvgd_-woZh0BP-CIfPfkxjaVnu2FwJjZ5APA2LyYGV6Wi_z8Q/exec',
  // Optional link for "Tell me when Vinewise launches" (for example a Google Form). Empty hides the button.
  waitlistUrl: '',
  // The pretend Quiet Garden price: each new player is assigned one of these at random.
  prices: ['$2.99', '$3.99'],
  // Show the offer once, after this level is completed.
  offerAfterLevel: 10,
  // Where "Share with a friend" links point, e.g. 'https://yourname.github.io/vinewise/'.
  // A shared link opens that day's Daily Garden with the friend's result. Empty uses
  // this page's own address. Use a GitHub Pages copy: itch.io drops the link's details.
  shareUrl: 'https://96mf6cbgs9-maker.github.io/vinewise/',
  // true in the public upload (set by tools/build_demo.py): locks unreached levels
  // and hides the "Simulate ads" switch so every player gets the same game.
  publicDemo: true,

  // Coins and garden helpers (boosters). Every garden can be finished without them.
  // All numbers are first guesses, to be tuned with real players.
  economy: {
    startCoins: 100,
    startItems: { seed: 1, shears: 1, breeze: 1 },
    coinsPerLevel: 10,          // the first time each level is finished (replays pay nothing)
    coinsPerAd: 25,             // optional rewarded ad in the shop
    adCoinsPerDay: 5,           // how many of those a day
    unlockLevel: 4,             // helpers appear from this level
    prices: { seed: 50, shears: 30, breeze: 30 },   // cut 12 Nov after the panel re-test (was 120 / 80 / 60)
    dailyGift: true,            // one free helper the first time you play each day
    dailyCoins: 20,             // for blooming the Daily Garden on its own day
    quietGardenPrice: '$3.99',  // remove every ad, once
    // Coin packs (one-off purchases through Google Play in the real game).
    // Mock in the private build; in the public demo a tap is only counted (nothing is sold).
    packs: [
      { id: 'pouch', coins: 500, price: '$0.99' },
      { id: 'basket', coins: 1200, price: '$1.99' },
      { id: 'barrow', coins: 3000, price: '$4.99' },
    ],
  },
};
