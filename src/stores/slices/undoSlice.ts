import { toast } from "sonner";
import type { HunkState } from "../../types";
import type { SliceCreator } from "../types";
import { createDebouncedFn } from "../types";

const MAX_UNDO_STACK = 50;

const debouncedSave = createDebouncedFn(500);

export interface UndoEntry {
  hunkIds: string[];
  previousStatuses: Record<string, HunkState | undefined>;
  focusedHunkIndex: number;
  selectedFile: string | null;
}

export interface UndoSlice {
  undoStack: UndoEntry[];
  pushUndo: (entry: UndoEntry) => void;
  undo: () => void;
  clearUndoStack: () => void;
}

export const createUndoSlice: SliceCreator<UndoSlice> = (set, get) => ({
  undoStack: [],

  pushUndo: (entry) => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(MAX_UNDO_STACK - 1)), entry],
    }));
  },

  undo: () => {
    const { undoStack, reviewState, saveReviewState } = get();
    if (undoStack.length === 0 || !reviewState) return;

    const entry = undoStack[undoStack.length - 1];

    // Restore hunk statuses
    const newHunks = { ...reviewState.hunks };
    for (const hunkId of entry.hunkIds) {
      const prev = entry.previousStatuses[hunkId];
      if (prev === undefined) {
        delete newHunks[hunkId];
      } else {
        newHunks[hunkId] = prev;
      }
    }

    set({
      undoStack: undoStack.slice(0, -1),
      reviewState: {
        ...reviewState,
        hunks: newHunks,
        updatedAt: new Date().toISOString(),
      },
      focusedHunkIndex: entry.focusedHunkIndex,
      selectedFile: entry.selectedFile,
    });

    debouncedSave(saveReviewState);

    const count = entry.hunkIds.length;
    toast(`Undid ${count === 1 ? "hunk" : count + " hunks"}`, {
      duration: 1500,
      style: {
        background: "#451a03",
        color: "#fef3c7",
        border: "1px solid #92400e",
      },
    });
  },

  clearUndoStack: () => {
    set({ undoStack: [] });
  },
});
