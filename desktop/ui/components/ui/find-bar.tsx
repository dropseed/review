import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react";
import { SimpleTooltip } from "./tooltip";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "./icons";

/**
 * The floating bar family: in-file search, go-to-line, and terminal search all
 * wear this same chrome, so the chrome lives once. `FindBar` is the fully
 * composed search form (input, Aa, count, prev/next, close); the shell and
 * icon button are exported separately for bars with a different middle
 * (GoToLineBar is input + close only).
 */

/** The floating container every bar sits in. */
export function FindBarShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-surface-raised border border-edge-default/80 px-2 py-1.5 shadow-xl shadow-black/30">
      {children}
    </div>
  );
}

interface FindBarInputProps extends ComponentPropsWithoutRef<"input"> {
  /** Paints the no-results / bad-input state. */
  invalid?: boolean;
}

/** The bar's text input. */
export const FindBarInput = forwardRef<HTMLInputElement, FindBarInputProps>(
  function FindBarInput({ invalid = false, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="text"
        className={`w-44 rounded bg-surface-panel/80 border px-2 py-1 text-xs text-fg-secondary placeholder-fg-muted outline-hidden transition-colors focus:border-focus-ring/50 ${
          invalid
            ? "border-status-rejected/50 bg-status-rejected/5"
            : "border-edge-default/50"
        }`}
        spellCheck={false}
        autoComplete="off"
        {...props}
      />
    );
  },
);

interface FindBarIconButtonProps {
  tooltip: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Highlighted toggle state (the Aa button when case matters). */
  active?: boolean;
  children: ReactNode;
}

/** The bar's 6×6 icon button, with its tooltip. */
export function FindBarIconButton({
  tooltip,
  label,
  onClick,
  disabled = false,
  active = false,
  children,
}: FindBarIconButtonProps) {
  return (
    <SimpleTooltip content={tooltip}>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-30 disabled:pointer-events-none ${
          active
            ? "bg-status-modified/20 text-status-modified"
            : "text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50"
        }`}
        aria-label={label}
      >
        {children}
      </button>
    </SimpleTooltip>
  );
}

interface FindBarProps {
  inputRef?: Ref<HTMLInputElement>;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  caseSensitive: boolean;
  onToggleCase: () => void;
  /** "1 of 4", "No results", or "" when there is nothing to count yet. */
  countLabel: string;
  /** Paints the input and count in the rejected color. */
  noResults: boolean;
  navDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  closeLabel: string;
}

/** The composed search bar the in-file and terminal searches share. */
export function FindBar({
  inputRef,
  placeholder,
  query,
  onQueryChange,
  onInputKeyDown,
  caseSensitive,
  onToggleCase,
  countLabel,
  noResults,
  navDisabled,
  onPrev,
  onNext,
  onClose,
  closeLabel,
}: FindBarProps) {
  return (
    <FindBarShell>
      <FindBarInput
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder={placeholder}
        invalid={noResults}
      />

      <FindBarIconButton
        tooltip={caseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"}
        label="Toggle case sensitivity"
        onClick={onToggleCase}
        active={caseSensitive}
      >
        <span className="text-xs font-bold">Aa</span>
      </FindBarIconButton>

      <span
        className={`min-w-[3.5rem] text-center text-xxs tabular-nums ${
          noResults ? "text-status-rejected" : "text-fg-muted"
        }`}
      >
        {countLabel}
      </span>

      <FindBarIconButton
        tooltip="Previous match (Shift+Enter)"
        label="Previous match"
        onClick={onPrev}
        disabled={navDisabled}
      >
        <ChevronUpIcon className="h-3.5 w-3.5" />
      </FindBarIconButton>

      <FindBarIconButton
        tooltip="Next match (Enter)"
        label="Next match"
        onClick={onNext}
        disabled={navDisabled}
      >
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </FindBarIconButton>

      <FindBarIconButton
        tooltip="Close (Escape)"
        label={closeLabel}
        onClick={onClose}
      >
        <XIcon className="h-3.5 w-3.5" />
      </FindBarIconButton>
    </FindBarShell>
  );
}
