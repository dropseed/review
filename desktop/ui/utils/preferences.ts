/**
 * Preferences utilities
 */

// Re-export font constants from preferencesSlice
export {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
  CODE_FONT_FAMILY_DEFAULT,
  AUTO_START_DELAY_DEFAULT,
  AUTO_START_DELAY_MIN,
  AUTO_START_DELAY_STEP,
} from "../stores/slices/preferencesSlice";

export interface RecentRepo {
  path: string;
  name: string; // directory name for display
  lastOpened: string; // ISO date
}
