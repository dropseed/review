import { useEffect } from "react";
import { getPlatformServices } from "../../platform";
import type { ContextMenuState } from "./types";

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onOpenInSplit?: (path: string) => void;
}

export function ContextMenu({
  menu,
  onClose,
  onOpenInSplit,
}: ContextMenuProps) {
  useEffect(() => {
    const handleClick = () => onClose();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-[11rem] rounded border border-stone-700 bg-stone-800 py-1 shadow-lg"
      style={{ top: menu.y, left: menu.x }}
      role="menu"
    >
      {onOpenInSplit && (
        <>
          <button
            onClick={() => {
              onOpenInSplit(menu.path);
              onClose();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            role="menuitem"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 4v16M15 4v16"
              />
            </svg>
            Open in Split View
          </button>
          <div className="my-1 h-px bg-stone-700" />
        </>
      )}
      <button
        onClick={async () => {
          const platform = getPlatformServices();
          await platform.opener.openUrl(`vscode://file${menu.fullPath}`);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 transition-colors"
        role="menuitem"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
        Open in VS Code
      </button>
      <div className="my-1 h-px bg-stone-700" />
      <button
        onClick={async () => {
          const platform = getPlatformServices();
          await platform.clipboard.writeText(menu.fullPath);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 transition-colors"
        role="menuitem"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        Copy Path
      </button>
      <button
        onClick={async () => {
          const platform = getPlatformServices();
          await platform.opener.revealItemInDir(menu.fullPath);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700 transition-colors"
        role="menuitem"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        {menu.revealLabel}
      </button>
    </div>
  );
}
