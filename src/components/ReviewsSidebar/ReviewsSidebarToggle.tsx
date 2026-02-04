interface ReviewsSidebarToggleProps {
  isOpen: boolean;
  onClick: () => void;
}

export function ReviewsSidebarToggle({
  isOpen,
  onClick,
}: ReviewsSidebarToggleProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center w-7 h-7 rounded-md
                 transition-colors duration-100
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50
                 ${
                   isOpen
                     ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                     : "text-stone-500 hover:text-stone-200 hover:bg-stone-800/60"
                 }`}
      aria-label={
        isOpen ? "Close comparison selector" : "Open comparison selector"
      }
      aria-expanded={isOpen}
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
        {/* Layers/stack icon - represents switching between comparisons */}
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    </button>
  );
}
