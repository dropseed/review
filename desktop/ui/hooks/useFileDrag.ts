import { useCallback } from "react";
import { isTauriEnvironment } from "../api/client";

/** Lazily generated 32×32 document icon for native drag image */
let cachedDragIcon: string | null = null;

function getDragIcon(): string {
  if (cachedDragIcon) return cachedDragIcon;

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;

  // Document body
  ctx.fillStyle = "#E8E8E8";
  ctx.beginPath();
  ctx.moveTo(4, 2);
  ctx.lineTo(20, 2);
  ctx.lineTo(28, 10);
  ctx.lineTo(28, 30);
  ctx.lineTo(4, 30);
  ctx.closePath();
  ctx.fill();

  // Fold corner
  ctx.fillStyle = "#C8C8C8";
  ctx.beginPath();
  ctx.moveTo(20, 2);
  ctx.lineTo(20, 10);
  ctx.lineTo(28, 10);
  ctx.closePath();
  ctx.fill();

  // Text lines
  ctx.fillStyle = "#B0B0B0";
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(8, 16 + i * 4, i === 2 ? 10 : 16, 2);
  }

  cachedDragIcon = canvas.toDataURL("image/png");
  return cachedDragIcon;
}

/**
 * Returns drag props for a file row element.
 * In Tauri (desktop) mode, enables native file drag to external apps (Finder, VS Code, etc.).
 * In web mode, returns empty props (no-op).
 */
export function useFileDrag(absolutePath: string | null): {
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
} {
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!absolutePath) return;
      e.preventDefault();
      import("@crabnebula/tauri-plugin-drag")
        .then(({ startDrag }) => {
          startDrag({ item: [absolutePath], icon: getDragIcon() });
        })
        .catch(console.error);
    },
    [absolutePath],
  );

  if (!absolutePath || !isTauriEnvironment()) {
    return {};
  }

  return { draggable: true, onDragStart };
}
