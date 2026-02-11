import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";

export interface PreviewHunk {
  id: string;
  filePath: string;
  content: string;
}

interface HunkPreviewModalProps {
  patternName: string;
  hunks: PreviewHunk[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
  onClose: () => void;
}

export function HunkPreviewModal({
  patternName,
  hunks,
  onSelectHunk,
  onClose,
}: HunkPreviewModalProps): ReactNode {
  return (
    <Dialog open={hunks.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-lg rounded-lg p-0">
        <DialogHeader>
          <div>
            <DialogTitle>{patternName}</DialogTitle>
            <DialogDescription>
              {hunks.length} matching hunk{hunks.length !== 1 ? "s" : ""}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {hunks.map((hunk) => (
            <button
              key={hunk.id}
              onClick={() => onSelectHunk(hunk.filePath, hunk.id)}
              className="group w-full text-left px-4 py-2.5 border-b border-stone-800/30 last:border-b-0 hover:bg-stone-800/40 transition-colors"
            >
              <div className="text-xs font-medium text-stone-400 truncate group-hover:text-stone-200">
                {hunk.filePath}
              </div>
              <div className="mt-1 font-mono text-xxs text-stone-600 truncate group-hover:text-stone-500">
                {hunk.content.split("\n").slice(0, 2).join(" ").slice(0, 120)}
                {hunk.content.length > 120 && "..."}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface InlineHunkPreviewListProps {
  hunks: PreviewHunk[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
  onShowAll: () => void;
}

export function InlineHunkPreviewList({
  hunks,
  onSelectHunk,
  onShowAll,
}: InlineHunkPreviewListProps): ReactNode {
  const shown = hunks.slice(0, 3);

  return (
    <div className="rounded-md border border-stone-700/50 bg-stone-800/30 overflow-hidden">
      {shown.map((hunk) => (
        <button
          key={hunk.id}
          onClick={() => onSelectHunk(hunk.filePath, hunk.id)}
          className="group w-full text-left px-3 py-2 border-b border-stone-800/30 last:border-b-0 hover:bg-stone-800/50 transition-colors"
        >
          <div className="text-xxs font-medium text-stone-400 truncate group-hover:text-stone-200">
            {hunk.filePath}
          </div>
          <div className="mt-0.5 font-mono text-xxs text-stone-600 truncate group-hover:text-stone-500">
            {hunk.content.split("\n").slice(0, 2).join(" ").slice(0, 100)}
            {hunk.content.length > 100 && "..."}
          </div>
        </button>
      ))}
      {hunks.length > 3 && (
        <button
          type="button"
          onClick={onShowAll}
          className="w-full px-3 py-1.5 text-xxs text-stone-500 hover:text-stone-300 hover:bg-stone-800/50 transition-colors text-center"
        >
          Show all {hunks.length} hunks
        </button>
      )}
    </div>
  );
}
