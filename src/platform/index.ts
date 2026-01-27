/**
 * Platform Services Layer
 *
 * Provides platform-agnostic interfaces for OS-specific functionality.
 * Automatically selects the appropriate implementation based on the environment.
 */

export type {
  ClipboardService,
  NotificationService,
  DialogService,
  ShortcutService,
  StorageService,
  OpenerService,
  WindowService,
  WindowHandle,
  MenuEventService,
  PlatformServices,
} from "./types";

import type { PlatformServices } from "./types";
import { isTauriEnvironment } from "../api/client";
import { getTauriServices } from "./tauri";
import { getWebServices } from "./web";

// Singleton instance
let platformServices: PlatformServices | null = null;

/**
 * Get the platform services (singleton).
 * Automatically detects whether to use Tauri or Web based on the environment.
 */
export function getPlatformServices(): PlatformServices {
  if (!platformServices) {
    platformServices = createPlatformServices();
  }
  return platformServices;
}

/**
 * Create platform services based on the current environment.
 */
export function createPlatformServices(): PlatformServices {
  if (isTauriEnvironment()) {
    console.log("[platform] Using Tauri services");
    return getTauriServices();
  } else {
    console.log("[platform] Using Web services");
    return getWebServices();
  }
}

/**
 * Override the platform services (useful for testing).
 */
export function setPlatformServices(services: PlatformServices): void {
  platformServices = services;
}
