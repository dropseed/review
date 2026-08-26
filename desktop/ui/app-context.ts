// What the shell hands down through the router's outlet: the repo it resolved,
// and the verbs only it can perform.
//
// Its own module rather than router.tsx's, so a component deep inside a route
// can read a verb without importing the router that renders it.

import { useOutletContext } from "react-router-dom";
import type { RepoStatus } from "./hooks";
import type { ReviewTarget } from "./types";

export interface AppContext {
  repoStatus: RepoStatus;
  repoError: string | null;
  repoPath: string | null;
  comparisonReady: number;
  handleOpenRepo: () => Promise<void>;
  handleCloseRepo: () => void;
  handleNewReview: (path: string, target: ReviewTarget) => Promise<void>;
  handleStartReview: (path: string, target: ReviewTarget) => Promise<void>;
}

export function useAppContext(): AppContext {
  return useOutletContext<AppContext>();
}
