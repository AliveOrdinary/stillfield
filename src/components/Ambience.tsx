import { useEffect, useRef, useState } from 'react';

const LEVEL = 0.28; // gentle resting volume (heavy low-pass makes it quieter)

type Phase = 'open' | 'closing' | 'gone';

export default function Ambience() {
  const [phase, setPhase] = useState<Phase>('open');
  const [soundOn, setSoundOn] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const soundOnRef = useRef(false);

  const fadeTo = (value: number, secs: number) => {
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(value, now + secs);
  };

  const buildNoise = () => {
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

    // Warm it right down into a soft rumble. Two cascaded low-passes roll the
    // highs off gently (-24 dB/oct), and a high-pass trims sub-mud.
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

    // a slow "tide": gently sweep the cutoff so the noise swells and recedes
    // like calm breathing — far more relaxing than a static wash
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;          // ~20s per cycle
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

  const startSound = () => {
    if (!ctxRef.current) buildNoise();
    else ctxRef.current.resume();
    fadeTo(LEVEL, 1.8);
    soundOnRef.current = true;
    setSoundOn(true);
  };

  const stopSound = () => {
    fadeTo(0, 0.6);
    soundOnRef.current = false;
    setSoundOn(false);
  };

  const toggleSound = () => {
    if (soundOnRef.current) stopSound();
    else startSound();
  };

  const enter = (withSound: boolean) => {
    if (withSound) startSound();
    setPhase('closing');
    window.setTimeout(() => setPhase('gone'), 700);
  };

  // Reveal + wire the topbar sound toggle (static markup, hidden until JS).
  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-sound]');
    if (!btn) return;
    btn.removeAttribute('hidden');
    const handler = () => toggleSound();
    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, []);

  // Reflect sound state on the toggle (icon swap + a11y).
  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-sound]');
    if (!btn) return;
    btn.classList.toggle('is-on', soundOn);
    btn.setAttribute('aria-pressed', String(soundOn));
  }, [soundOn]);

  if (phase === 'gone') return null;

  return (
    <div className={`gate${phase === 'closing' ? ' is-closing' : ''}`} role="dialog" aria-label="Enter Stillfield">
      <div className="gate-inner">
        <svg className="gate-mark" viewBox="0 0 30 30" fill="currentColor" aria-hidden="true">
          <circle cx="15" cy="8.2" r="2" />
          <circle cx="20.89" cy="11.6" r="2" />
          <circle cx="20.89" cy="18.4" r="2" />
          <circle cx="15" cy="21.8" r="2" />
          <circle cx="9.11" cy="18.4" r="2" />
          <circle cx="9.11" cy="11.6" r="2" />
        </svg>
        <span className="gate-word">STILLFIELD</span>
        <p className="gate-hint">Find a quiet moment. Sound on.</p>
        <button className="gate-enter" type="button" onClick={() => enter(true)}>
          Enter the field
        </button>
        <button className="gate-silent" type="button" onClick={() => enter(false)}>
          Enter in silence
        </button>
      </div>
    </div>
  );
}
