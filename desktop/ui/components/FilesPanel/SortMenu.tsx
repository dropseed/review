import { type ReactNode, useState, useEffect } from "react";

interface SortMenuProps<T extends string> {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export function SortMenu<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Sort order",
}: SortMenuProps<T>): ReactNode {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="p-0.5 rounded text-fg-faint hover:text-fg-muted hover:bg-fg/[0.08]
                   transition-colors duration-100"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </svg>
      </button>
      {open && (
        <>
          {/* Backdrop to close menu on outside click */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md bg-surface-panel border border-edge-default py-1 shadow-xl"
            role="menu"
          >
            {options.map(([optValue, label]) => (
              <button
                key={optValue}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(optValue);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors duration-100
                  ${
                    value === optValue
                      ? "text-fg-secondary bg-fg/[0.06]"
                      : "text-fg-muted hover:text-fg-secondary hover:bg-fg/[0.04]"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
