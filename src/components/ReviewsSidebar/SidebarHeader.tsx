import { useSidebarData } from "./SidebarDataContext";

export function SidebarHeader() {
  const { onClose } = useSidebarData();

  return (
    <header className="flex items-center justify-between px-5 py-4 border-b border-stone-800/80">
      <h2 className="text-sm font-semibold text-stone-200">
        Switch Comparison
      </h2>
      <button
        onClick={onClose}
        className="flex items-center justify-center w-7 h-7 rounded-md
                   text-stone-500 hover:text-stone-200 hover:bg-stone-800/60
                   transition-colors duration-100
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50"
        aria-label="Close sidebar"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>
  );
}
