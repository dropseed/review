import { memo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface HoverTooltipProps {
  content: string | null;
  position: { x: number; y: number } | null;
  onDismiss: () => void;
}

export const HoverTooltip = memo(function HoverTooltip({
  content,
  position,
  onDismiss,
}: HoverTooltipProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!content) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (
        contentRef.current &&
        !contentRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [content, onDismiss]);

  if (!content || !position) return null;

  const panelWidth = 400;
  const panelMaxHeight = 200;
  const gap = 8;
  const left = Math.min(position.x, window.innerWidth - panelWidth - gap);
  const spaceBelow = window.innerHeight - position.y - gap;
  const top =
    spaceBelow >= panelMaxHeight
      ? position.y + gap
      : Math.max(gap, position.y - panelMaxHeight - gap);

  return createPortal(
    <div
      ref={contentRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 50,
        maxWidth: panelWidth,
        maxHeight: panelMaxHeight,
      }}
      className="overflow-auto rounded-lg border border-edge-default/50 bg-surface-panel/95 backdrop-blur-xl shadow-xl shadow-black/40 animate-in fade-in-0 zoom-in-95"
    >
      <div className="p-3">
        <pre className="whitespace-pre-wrap text-xs text-fg-secondary font-mono leading-relaxed m-0">
          <code>{content}</code>
        </pre>
      </div>
    </div>,
    document.body,
  );
});
