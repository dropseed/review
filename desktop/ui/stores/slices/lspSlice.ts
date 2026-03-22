import type { LspServerStatus } from "../../types";
import type { SliceCreator } from "../types";

export interface LspSlice {
  lspServerStatuses: LspServerStatus[];
  setLspServerStatuses: (statuses: LspServerStatus[]) => void;
}

export const createLspSlice: SliceCreator<LspSlice> = (set) => ({
  lspServerStatuses: [],
  setLspServerStatuses: (statuses) => set({ lspServerStatuses: statuses }),
});
