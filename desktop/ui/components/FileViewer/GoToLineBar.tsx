import { useEffect, useRef, useState } from "react";
import { FindBarIconButton, FindBarInput, FindBarShell } from "../ui/find-bar";
import { XIcon } from "../ui/icons";

interface GoToLineBarProps {
  maxLine: number;
  onGoToLine: (line: number) => void;
  onClose: () => void;
  /** Bumped when ⌘L fires with the bar already open — refocus and re-select. */
  focusSignal?: number;
}

export function GoToLineBar({
  maxLine,
  onGoToLine,
  onClose,
  focusSignal,
}: GoToLineBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const parsed = value === "" ? null : parseInt(value, 10);
  const isValid =
    parsed !== null &&
    Number.isFinite(parsed) &&
    parsed >= 1 &&
    parsed <= maxLine;
  const hasInput = value.length > 0;
  const showError = hasInput && !isValid;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isValid && parsed !== null) {
        onGoToLine(parsed);
        onClose();
      }
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "l") {
      // Re-pressing Cmd+L with the bar already open re-selects the value so
      // the user can immediately overwrite it.
      e.preventDefault();
      e.currentTarget.select();
    }
  };

  return (
    <FindBarShell>
      <FindBarInput
        ref={inputRef}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={handleKeyDown}
        placeholder={`Go to line (1–${maxLine})`}
        invalid={showError}
      />

      <FindBarIconButton
        tooltip="Close (Escape)"
        label="Close go to line"
        onClick={onClose}
      >
        <XIcon className="h-3.5 w-3.5" />
      </FindBarIconButton>
    </FindBarShell>
  );
}
