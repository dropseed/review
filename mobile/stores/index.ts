/**
 * Main Zustand Store
 *
 * Combines all slices into a single store for the mobile app.
 */

import { create } from "zustand";
import {
  createConnectionSlice,
  type ConnectionSlice,
} from "./slices/connection-slice";
import { createSyncSlice, type SyncSlice } from "./slices/sync-slice";

export type AppStore = ConnectionSlice & SyncSlice;

export const useStore = create<AppStore>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createSyncSlice(...a),
}));

// Re-export types
export type { ConnectionSlice } from "./slices/connection-slice";
export type { SyncSlice, MobileLayoutMode } from "./slices/sync-slice";
