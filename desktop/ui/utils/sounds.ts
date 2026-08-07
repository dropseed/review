// Sound engine using Web Audio API
// Singleton module -- can be called from Zustand store directly (no React hooks)

let audioContext: AudioContext | null = null;
let soundEnabled = true;

/**
 * Context time the last scheduled tone runs out, so `parkWhenDone` can wait for
 * silence without every caller restating its own note math.
 */
let scheduledUntil = 0;
let parkTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Grace period after the last tone before the context is parked. Long enough
 * that a run of approvals keeps one context running rather than thrashing
 * suspend/resume between keystrokes.
 */
const PARK_DELAY_MS = 1000;

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
  // Parked between sounds (see `park`), so every play path has to wake it.
  // Resuming is async; tones scheduled against the frozen `currentTime` land
  // just after the clock restarts, which is inaudible at these durations.
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

/**
 * Suspend the context until something asks for a sound again.
 *
 * A *running* AudioContext holds a realtime audio render thread open and keeps
 * pulling the hardware graph forever, whether or not anything is connected to
 * it -- so the handful of blips this module plays would otherwise cost a wakeup
 * every buffer for the life of the window, and keep the process off idle. The
 * context is suspended rather than closed because the graph and the clock
 * survive, so waking it is far cheaper than building a new one.
 */
function park(): void {
  if (parkTimer !== null) {
    clearTimeout(parkTimer);
    parkTimer = null;
  }
  if (audioContext && audioContext.state === "running") {
    void audioContext.suspend();
  }
}

/** Arm the park for once the tones scheduled so far have finished sounding. */
function parkWhenDone(ctx: AudioContext): void {
  if (parkTimer !== null) clearTimeout(parkTimer);
  const remaining = Math.max(0, scheduledUntil - ctx.currentTime) * 1000;
  parkTimer = setTimeout(() => {
    parkTimer = null;
    if (ctx.state === "running") void ctx.suspend();
  }, remaining + PARK_DELAY_MS);
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  // Muting mid-session should release the audio thread now, not after whatever
  // the last sound happened to schedule.
  if (!enabled) park();
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
  scheduledUntil = Math.max(scheduledUntil, opts.startTime + opts.duration);
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
  parkWhenDone(ctx);
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
  parkWhenDone(ctx);
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
  parkWhenDone(ctx);
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
  parkWhenDone(ctx);
}
