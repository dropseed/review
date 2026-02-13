import { createContext, use } from "react";
import type { HunkState } from "../types";

interface ReviewDataContextValue {
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  onNavigate: (filePath: string, hunkId: string) => void;
}

const ReviewDataContext = createContext<ReviewDataContextValue | null>(null);

export const ReviewDataProvider = ReviewDataContext.Provider;

export function useReviewData(): ReviewDataContextValue {
  const ctx = use(ReviewDataContext);
  if (!ctx) {
    throw new Error("useReviewData must be used within a ReviewDataProvider");
  }
  return ctx;
}
