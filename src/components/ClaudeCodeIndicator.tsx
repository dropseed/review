import { useReviewStore } from "../stores/reviewStore";

export function ClaudeCodeIndicator() {
  const { claudeCodeActive, showClaudeCodeView, toggleClaudeCodeView } =
    useReviewStore();

  if (!claudeCodeActive) return null;

  return (
    <button
      onClick={toggleClaudeCodeView}
      className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors ${
        showClaudeCodeView
          ? "bg-violet-500/15 text-violet-300 hover:bg-violet-500/25"
          : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
      }`}
      title="Claude Code activity"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
      </span>
      <span>Claude Code</span>
    </button>
  );
}
