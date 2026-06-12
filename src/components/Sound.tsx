import { useEffect, useRef } from 'react';

/*
  Ambient sound. Renders nothing — it reveals the server-rendered topbar
  toggle ([data-sound], hidden until JS arrives) and wires it to a
  procedurally generated brown-noise wash. Audio starts only from the
  toggle click, which satisfies browser autoplay policy; there is no gate.
*/

const LEVEL = 0.28; // gentle resting volume (heavy low-pass makes it quieter)

export default function Sound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const onRef = useRef(false);

  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-sound]');
    if (!btn) return;
    btn.removeAttribute('hidden');

    const fadeTo = (value: number, secs: number) => {
      const ctx = ctxRef.current;
      const gain = gainRef.current;
      if (!ctx || !gain) return;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(value, now + secs);
    };

    const build = () => {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();

      // 8-second looping buffer of brown noise (random walk → -6dB/oct, low-heavy)
      const length = ctx.sampleRate * 8;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.018 * white) / 1.018;
        data[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      // Warm it right down into a soft rumble. Two cascaded low-passes roll
      // the highs off gently (-24 dB/oct); a high-pass trims sub-mud.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 45;
      const lp1 = ctx.createBiquadFilter();
      lp1.type = 'lowpass';
      lp1.frequency.value = 340;
      lp1.Q.value = 0.4;
      const lp2 = ctx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.value = 700;
      lp2.Q.value = 0.3;

      // a slow "tide": sweep the cutoff so the noise swells and recedes
      // like calm breathing — far more relaxing than a static wash
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05; // ~20s per cycle
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 120;
      lfo.connect(lfoDepth).connect(lp1.frequency);
      lfo.start();

      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(lp1).connect(lp2).connect(gain).connect(ctx.destination);
      src.start();
      ctxRef.current = ctx;
      gainRef.current = gain;
    };

    const toggle = () => {
      if (onRef.current) {
        fadeTo(0, 0.6);
        onRef.current = false;
      } else {
        if (!ctxRef.current) build();
        else ctxRef.current.resume();
        fadeTo(LEVEL, 1.8);
        onRef.current = true;
      }
      btn.classList.toggle('is-on', onRef.current);
      btn.setAttribute('aria-pressed', String(onRef.current));
    };

    btn.addEventListener('click', toggle);
    return () => btn.removeEventListener('click', toggle);
  }, []);

  return null;
}
