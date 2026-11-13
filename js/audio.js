/* Vinewise: synthesized sound effects (Web Audio, no files). */
(function () {
  'use strict';

  const PENTA = [0, 2, 4, 7, 9]; // major pentatonic: every note sounds good together
  let ctx = null;
  let master = null;
  let lastBloom = 0;

  function note(step) {
    const oct = Math.floor(step / 5);
    const semi = PENTA[((step % 5) + 5) % 5] + 12 * oct;
    return 523.25 * Math.pow(2, semi / 12); // from C5
  }

  const Sound = {
    enabled: true,

    /** Browsers only allow audio after a user gesture; call on first touch. */
    unlock() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    },

    tone(freq, opt) {
      if (!this.enabled || !ctx) return;
      const o = opt || {};
      const dur = o.dur || 0.25;
      const t = ctx.currentTime + (o.delay || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(freq * o.slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.gain || 0.15, t + (o.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    },

    tap() { this.tone(300, { type: 'triangle', dur: 0.12, gain: 0.22, slide: 1.8 }); },

    grow(step) {
      const f = note(step);
      this.tone(f, { dur: 0.22, gain: 0.11 });
      this.tone(f * 2, { type: 'triangle', dur: 0.1, gain: 0.03 });
    },

    thud() { this.tone(150, { dur: 0.16, gain: 0.3, slide: 0.55 }); },

    bloom(step) {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastBloom < 0.045) return; // don't stack dozens of notes
      lastBloom = now;
      this.tone(note(step + 5), { dur: 0.28, gain: 0.05 });
    },

    win() {
      [0, 2, 4, 5, 7].forEach((s, i) => {
        this.tone(note(s + 5), { type: 'triangle', dur: 0.55, gain: 0.11, delay: i * 0.09 });
      });
    },

    fail() {
      this.tone(392, { type: 'triangle', dur: 0.25, gain: 0.14 });
      this.tone(311, { type: 'triangle', dur: 0.45, gain: 0.14, delay: 0.18 });
    },

    click() { this.tone(660, { dur: 0.06, gain: 0.08 }); },
  };

  window.Sound = Sound;
})();
