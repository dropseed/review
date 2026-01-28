/**
 * Haptic feedback utilities.
 *
 * Provides haptic feedback on iOS only.
 */

import * as Haptics from "expo-haptics";

const isIOS = process.env.EXPO_OS === "ios";

/**
 * Light impact feedback - use for small UI interactions.
 */
export function lightImpact() {
  if (isIOS) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

/**
 * Medium impact feedback - use for significant actions.
 */
export function mediumImpact() {
  if (isIOS) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

/**
 * Heavy impact feedback - use for major actions.
 */
export function heavyImpact() {
  if (isIOS) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }
}

/**
 * Selection feedback - use for selection changes.
 */
export function selection() {
  if (isIOS) {
    Haptics.selectionAsync();
  }
}

/**
 * Success notification - use when an action completes successfully.
 */
export function success() {
  if (isIOS) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

/**
 * Warning notification - use for warnings.
 */
export function warning() {
  if (isIOS) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
}

/**
 * Error notification - use for errors.
 */
export function error() {
  if (isIOS) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}
