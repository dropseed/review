import {
  useState,
  useLayoutEffect,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { ReactNode } from "react";

interface SidebarShellProps {
  isOpen: boolean;
  onClose: () => void;
  prefersReducedMotion: boolean;
  children: ReactNode;
}

export function SidebarShell({
  isOpen,
  onClose,
  prefersReducedMotion,
  children,
}: SidebarShellProps) {
  // Track if we should render (for exit animations)
  const [shouldRender, setShouldRender] = useState(isOpen);
  const sidebarRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (isOpen) {
      // Store the currently focused element to restore later
      previousActiveElement.current = document.activeElement as HTMLElement;
      setShouldRender(true);
    }
  }, [isOpen]);

  // Handle animation end to unmount
  const handleAnimationEnd = useCallback(() => {
    if (!isOpen) {
      setShouldRender(false);
      // Return focus to the element that was focused before opening
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  // Keyboard handling for escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !sidebarRef.current) return;

    // Focus the sidebar on open (after a small delay to allow animation start)
    const focusTimeout = setTimeout(() => {
      const firstFocusable = sidebarRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }, 50);

    return () => clearTimeout(focusTimeout);
  }, [isOpen]);

  // Don't render if not open and animation is complete
  if (!isOpen && !shouldRender) return null;

  const animationDuration = prefersReducedMotion ? "0ms" : "250ms";
  const animationClass = isOpen
    ? "animate-sidebar-slide-in"
    : "animate-sidebar-slide-out";

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity ${
          prefersReducedMotion ? "" : "duration-200"
        } ${isOpen ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <aside
        ref={sidebarRef}
        className={`fixed top-0 right-0 z-50 h-full w-[420px] max-w-[90vw]
                   border-l border-stone-800 bg-stone-950/95 backdrop-blur-md
                   shadow-2xl shadow-black/50
                   flex flex-col
                   ${animationClass}`}
        style={{
          animationDuration,
          animationFillMode: "forwards",
        }}
        onAnimationEnd={handleAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label="Switch comparison"
      >
        {children}
      </aside>
    </>
  );
}
