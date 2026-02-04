import { useAutoUpdater } from "../hooks";

export function UpdateBanner() {
  const {
    updateAvailable,
    installing,
    error,
    dismissed,
    installUpdate,
    dismiss,
  } = useAutoUpdater();

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="flex items-center gap-3 bg-stone-900 border-b border-stone-800 px-4 py-2 text-sm">
      <span className="text-stone-300">
        Version {updateAvailable.version} is available.
      </span>

      {error && <span className="text-red-400">{error}</span>}

      <div className="ml-auto flex items-center gap-2">
        {installing ? (
          <span className="flex items-center gap-2 text-stone-400">
            <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-stone-600 border-t-amber-500 animate-spin" />
            Installing...
          </span>
        ) : (
          <>
            <button
              onClick={installUpdate}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              Update and restart
            </button>
            <button
              onClick={dismiss}
              className="rounded-md px-2 py-1 text-xs text-stone-400 hover:text-stone-200 transition-colors"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
