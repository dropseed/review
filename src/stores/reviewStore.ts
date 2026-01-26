// This file re-exports the modular store for backward compatibility.
// The store is now split into slices in ./slices/ for better maintainability.
// See ./index.ts for the combined store implementation.

export { useReviewStore } from "./index";
export type { ReviewStore } from "./types";
