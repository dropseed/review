import confetti from "canvas-confetti";

/** Two bursts from left/right + delayed center burst */
export function fireCelebrationConfetti(): void {
  const colors = ["#4ade80", "#22d3ee", "#f59e0b", "#a78bfa", "#fb7185"];

  // Left burst
  confetti({
    particleCount: 60,
    angle: 60,
    spread: 55,
    origin: { x: 0, y: 0.65 },
    colors,
  });

  // Right burst
  confetti({
    particleCount: 60,
    angle: 120,
    spread: 55,
    origin: { x: 1, y: 0.65 },
    colors,
  });

  // Delayed center burst
  setTimeout(() => {
    confetti({
      particleCount: 80,
      spread: 100,
      origin: { x: 0.5, y: 0.5 },
      colors,
    });
  }, 250);
}
