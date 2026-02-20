import type { SliceCreator } from "../types";

export interface Activity {
  id: string;
  label: string;
  current?: number;
  total?: number;
  priority: number;
  startedAt: number;
}

export interface ActivitySlice {
  activities: Map<string, Activity>;
  startActivity: (id: string, label: string, priority?: number) => void;
  updateActivity: (
    id: string,
    updates: Partial<Pick<Activity, "label" | "current" | "total">>,
  ) => void;
  endActivity: (id: string) => void;
  clearAllActivities: () => void;
}

export const createActivitySlice: SliceCreator<ActivitySlice> = (set) => ({
  activities: new Map(),

  startActivity: (id, label, priority = 0) => {
    set((state) => {
      const next = new Map(state.activities);
      next.set(id, { id, label, priority, startedAt: Date.now() });
      return { activities: next };
    });
  },

  updateActivity: (id, updates) => {
    set((state) => {
      const existing = state.activities.get(id);
      if (!existing) return state;
      const next = new Map(state.activities);
      next.set(id, { ...existing, ...updates });
      return { activities: next };
    });
  },

  endActivity: (id) => {
    set((state) => {
      if (!state.activities.has(id)) return state;
      const next = new Map(state.activities);
      next.delete(id);
      return { activities: next };
    });
  },

  clearAllActivities: () => {
    set({ activities: new Map() });
  },
});
