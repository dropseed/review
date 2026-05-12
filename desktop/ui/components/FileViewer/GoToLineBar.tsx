import { useEffect, useRef, useState } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import { XIcon } from "../ui/icons";

interface GoToLineBarProps {
  maxLine: number;
  onGoToLine: (line: number) => void;
  onClose: () => void;
}

export function GoToLineBar({
  maxLine,
  onGoToLine,
  onClose,
}: GoToLineBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-pressing Cmd+L with the bar already open should re-select the value
  // so the user can immediately overwrite it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "l") {
        e.preventDefault();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const parsed = value === "" ? null : parseInt(value, 10);
  const isValid =
    parsed !== null &&
    Number.isFinite(parsed) &&
    parsed >= 1 &&
    parsed <= maxLine;
  const hasInput = value.length > 0;
  const showError = hasInput && !isValid;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isValid && parsed !== null) {
        onGoToLine(parsed);
        onClose();
      }
    }
  };

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-surface-raised border border-edge-default/80 px-2 py-1.5 shadow-xl shadow-black/30">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={handleKeyDown}
        placeholder={`Go to line (1–${maxLine})`}
        className={`w-44 rounded bg-surface-panel/80 border px-2 py-1 text-xs text-fg-secondary placeholder-fg-muted outline-hidden transition-colors focus:border-focus-ring/50 ${
          showError
            ? "border-status-rejected/50 bg-status-rejected/5"
            : "border-edge-default/50"
        }`}
        spellCheck={false}
        autoComplete="off"
      />

      <SimpleTooltip content="Close (Escape)">
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover/50 hover:text-fg-secondary"
          aria-label="Close go to line"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </SimpleTooltip>
    </div>
  );
}
