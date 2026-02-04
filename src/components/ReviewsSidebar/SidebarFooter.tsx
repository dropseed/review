export function SidebarFooter() {
  return (
    <footer className="px-5 py-3 border-t border-stone-800/80 bg-stone-900/50">
      <div className="flex items-center justify-between text-2xs text-stone-600">
        <span>Press Esc to close</span>
        <div className="flex items-center gap-2">
          <kbd className="inline-flex items-center gap-0.5 rounded border border-stone-800/80 bg-stone-800 px-1 py-0.5 font-mono text-xxs text-stone-500">
            <span>{"\u2318"}</span>
            <span>E</span>
          </kbd>
          <span>toggle</span>
        </div>
      </div>
    </footer>
  );
}
