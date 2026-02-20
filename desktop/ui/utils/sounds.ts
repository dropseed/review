// Sound engine using Web Audio API
// Singleton module -- can be called from Zustand store directly (no React hooks)

let audioContext: AudioContext | null = null;
let soundEnabled = true;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getAudioContext(): AudioContext | null {
  if (prefersReducedMotion()) return null;
  if (!soundEnabled) return null;
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

interface ToneOptions {
  type: OscillatorType;
  frequency: number;
  startTime: number;
  duration: number;
  volume: number;
  /** Optional frequency ramp target for pitch bends */
  frequencyEnd?: number;
  /** Optional fade-in duration (uses linearRamp); omit for immediate onset */
  fadeIn?: number;
}

/** Schedule a single oscillator tone on the given AudioContext */
function playTone(ctx: AudioContext, opts: ToneOptions): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type;

  if (opts.frequencyEnd) {
    osc.frequency.setValueAtTime(opts.frequency, opts.startTime);
    osc.frequency.exponentialRampToValueAtTime(
      opts.frequencyEnd,
      opts.startTime + opts.duration,
    );
  } else {
    osc.frequency.value = opts.frequency;
  }

  if (opts.fadeIn) {
    gain.gain.setValueAtTime(0, opts.startTime);
    gain.gain.linearRampToValueAtTime(
      opts.volume,
      opts.startTime + opts.fadeIn,
    );
  } else {
    gain.gain.setValueAtTime(opts.volume, opts.startTime);
  }
  gain.gain.exponentialRampToValueAtTime(0.001, opts.startTime + opts.duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(opts.startTime);
  osc.stop(opts.startTime + opts.duration);
}

/** Two quick ascending sine tones -- crisp "pop" */
export function playApproveSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  playTone(ctx, {
    type: "sine",
    frequency: 440,
    startTime: now,
    duration: 0.04,
    volume: 0.15,
  });
  playTone(ctx, {
    type: "sine",
    frequency: 660,
    startTime: now + 0.04,
    duration: 0.04,
    volume: 0.15,
  });
}

/** Single descending tone -- muted thud */
export function playRejectSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  playTone(ctx, {
    type: "sine",
    frequency: 330,
    frequencyEnd: 220,
    startTime: ctx.currentTime,
    duration: 0.06,
    volume: 0.12,
  });
}

/** Quick ascending arpeggio C5-E5-G5-C6 -- triangle wave for warmth */
export function playBulkSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const noteLength = 0.075;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

  for (const [i, freq] of notes.entries()) {
    playTone(ctx, {
      type: "triangle",
      frequency: freq,
      startTime: now + i * noteLength,
      duration: noteLength,
      volume: 0.12,
    });
  }
}

/** Ascending shimmer/whoosh -- sparkle tones for entering guided review */
export function playGuideStartSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Quick ascending sparkle: E5 -> G#5 -> B5 -> E6
  const sparkleNotes = [659.25, 830.61, 987.77, 1318.5];
  for (const [i, freq] of sparkleNotes.entries()) {
    playTone(ctx, {
      type: "sine",
      frequency: freq,
      startTime: now + i * 0.06,
      duration: 0.15,
      volume: 0.1,
      fadeIn: 0.02,
    });
  }

  // Soft shimmer overtone
  playTone(ctx, {
    type: "sine",
    frequency: 1975.53, // B6
    startTime: now + 0.18,
    duration: 0.25,
    volume: 0.03,
    fadeIn: 0.04,
  });
}

/** Synthesized celebration fanfare -- ascending major chord with shimmer */
export function playCelebrationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Ascending fanfare: C5 -> E5 -> G5 -> C6 (sustained)
  const fanfareNotes = [523.25, 659.25, 783.99, 1046.5];
  for (const [i, freq] of fanfareNotes.entries()) {
    playTone(ctx, {
      type: "sine",
      frequency: freq,
      startTime: now + i * 0.1,
      duration: 0.8,
      volume: 0.1,
      fadeIn: 0.05,
    });
  }

  // Shimmer layer with higher harmonics
  const shimmerFreqs = [1318.5, 1568.0, 2093.0]; // E6, G6, C7
  for (const [i, freq] of shimmerFreqs.entries()) {
    playTone(ctx, {
      type: "sine",
      frequency: freq,
      startTime: now + 0.3 + i * 0.05,
      duration: 0.6,
      volume: 0.04,
      fadeIn: 0.03,
    });
  }
}
