import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";

interface PreviewHunk {
  id: string;
  filePath: string;
  content: string;
}

export function HunkPreviewModal({
  patternName,
  hunks,
  onSelectHunk,
  onClose,
}: {
  patternName: string;
  hunks: PreviewHunk[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
  onClose: () => void;
}) {
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
