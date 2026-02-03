/**
 * Tauri Platform Services Implementation
 *
 * Implements platform services using Tauri plugins for the desktop app.
 */

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  open as openDialog,
  message as showMessage,
} from "@tauri-apps/plugin-dialog";
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
} from "@tauri-apps/plugin-global-shortcut";
import { load, type Store } from "@tauri-apps/plugin-store";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  openUrl as openerOpenUrl,
  openPath as openerOpenPath,
  revealItemInDir as openerRevealItemInDir,
} from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
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

// ----- Clipboard -----

class TauriClipboardService implements ClipboardService {
  async writeText(text: string): Promise<void> {
    await writeText(text);
  }
}

// ----- Notifications -----

class TauriNotificationService implements NotificationService {
  async show(title: string, body: string): Promise<void> {
    const permitted = await this.isEnabled();
    if (permitted) {
      sendNotification({ title, body });
    }
  }

  async requestPermission(): Promise<boolean> {
    const permission = await requestPermission();
    return permission === "granted";
  }

  async isEnabled(): Promise<boolean> {
    return isPermissionGranted();
  }
}

// ----- Dialogs -----

class TauriDialogService implements DialogService {
  async openDirectory(options?: { title?: string }): Promise<string | null> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: options?.title,
    });
    return typeof selected === "string" ? selected : null;
  }

  async confirm(_message: string, _title?: string): Promise<boolean> {
    // Tauri doesn't have a built-in confirm dialog in the same way
    // For now, always return true (would need custom dialog component)
    console.warn("[TauriDialogService] confirm not fully implemented");
    return true;
  }

  async alert(_message: string, _title?: string): Promise<void> {
    // Tauri doesn't have a built-in alert dialog
    // Would need custom dialog component
    console.warn("[TauriDialogService] alert not fully implemented");
  }

  async message(
    msg: string,
    options?: { title?: string; kind?: "info" | "warning" | "error" },
  ): Promise<void> {
    await showMessage(msg, {
      title: options?.title,
      kind: options?.kind,
    });
  }
}

// ----- Shortcuts -----

class TauriShortcutService implements ShortcutService {
  async register(shortcut: string, callback: () => void): Promise<void> {
    try {
      await registerShortcut(shortcut, callback);
    } catch (err) {
      console.debug("Shortcut registration skipped:", err);
    }
  }

  async unregister(shortcut: string): Promise<void> {
    try {
      await unregisterShortcut(shortcut);
    } catch {
      // Ignore errors
    }
  }
}

// ----- Storage -----

class TauriStorageService implements StorageService {
  private store: Store | null = null;

  private async getStore(): Promise<Store> {
    if (!this.store) {
      this.store = await load("preferences.json", {
        autoSave: true,
        defaults: {},
      });
    }
    return this.store;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const store = await this.getStore();
      const value = await store.get<T>(key);
      return value ?? null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      const store = await this.getStore();
      await store.set(key, value);
    } catch (err) {
      console.error("Failed to save preference:", err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const store = await this.getStore();
      await store.delete(key);
    } catch {
      // Ignore errors
    }
  }
}

// ----- Opener -----

class TauriOpenerService implements OpenerService {
  async openUrl(url: string): Promise<void> {
    await openerOpenUrl(url);
  }

  async openFile(path: string): Promise<void> {
    await shellOpen(path);
  }

  async openPath(path: string): Promise<void> {
    await openerOpenPath(path);
  }

  async revealItemInDir(path: string): Promise<void> {
    await openerRevealItemInDir(path);
  }

  async openInEditor(path: string, line?: number): Promise<void> {
    // Try VS Code with line number
    const target = line ? `${path}:${line}` : path;
    // This assumes the user has 'code' in their PATH
    // In a real implementation, we might want to make this configurable
    try {
      await openerOpenUrl(`vscode://file${target}`);
    } catch {
      // Fallback to just opening the file
      await shellOpen(path);
    }
  }
}

// ----- Window -----

class TauriWindowHandle implements WindowHandle {
  private window = getCurrentWindow();

  async setTitle(title: string): Promise<void> {
    await this.window.setTitle(title);
  }

  async show(): Promise<void> {
    await this.window.show();
  }

  async setFocus(): Promise<void> {
    await this.window.setFocus();
  }

  async close(): Promise<void> {
    await this.window.close();
  }
}

class TauriWindowService implements WindowService {
  getCurrent(): WindowHandle {
    return new TauriWindowHandle();
  }

  async setTitle(title: string): Promise<void> {
    await getCurrentWindow().setTitle(title);
  }

  async show(): Promise<void> {
    await getCurrentWindow().show();
  }

  async focus(): Promise<void> {
    await getCurrentWindow().setFocus();
  }

  async close(): Promise<void> {
    await getCurrentWindow().close();
  }

  async getVersion(): Promise<string> {
    return getVersion();
  }

  getPlatformName(): string {
    return platform();
  }
}

// ----- Menu Events -----

class TauriMenuEventService implements MenuEventService {
  on(event: string, callback: () => void): () => void {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen(event, () => {
      if (!cancelled) {
        callback();
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.error(`Failed to listen for ${event}:`, err);
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }
}

// ----- Combined Services -----

let services: PlatformServices | null = null;

/**
 * Get the Tauri platform services (singleton)
 */
export function getTauriServices(): PlatformServices {
  if (!services) {
    services = {
      clipboard: new TauriClipboardService(),
      notifications: new TauriNotificationService(),
      dialogs: new TauriDialogService(),
      shortcuts: new TauriShortcutService(),
      storage: new TauriStorageService(),
      opener: new TauriOpenerService(),
      window: new TauriWindowService(),
      menuEvents: new TauriMenuEventService(),
    };
  }
  return services;
}
