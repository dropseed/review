/**
 * Web Platform Services Implementation
 *
 * Implements platform services using web APIs for browser-based testing
 * and future web version.
 */

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

class WebClipboardService implements ClipboardService {
  async writeText(text: string): Promise<void> {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }
}

// ----- Notifications -----

class WebNotificationService implements NotificationService {
  async show(title: string, body: string): Promise<void> {
    const permitted = await this.isEnabled();
    if (permitted) {
      new Notification(title, { body });
    } else {
      console.log(`[Notification] ${title}: ${body}`);
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
      return false;
    }
    const result = await Notification.requestPermission();
    return result === "granted";
  }

  async isEnabled(): Promise<boolean> {
    if (!("Notification" in window)) {
      return false;
    }
    return Notification.permission === "granted";
  }
}

// ----- Dialogs -----

class WebDialogService implements DialogService {
  async openDirectory(_options?: { title?: string }): Promise<string | null> {
    // Web doesn't have native directory picker that returns a path
    // In a real web app, this would use the File System Access API
    // For now, just log and return null
    console.warn("[WebDialogService] openDirectory not available in browser");
    return null;
  }

  async confirm(message: string, _title?: string): Promise<boolean> {
    return window.confirm(message);
  }

  async alert(message: string, _title?: string): Promise<void> {
    window.alert(message);
  }
}

// ----- Shortcuts -----

class WebShortcutService implements ShortcutService {
  private handlers = new Map<string, (e: KeyboardEvent) => void>();

  async register(shortcut: string, callback: () => void): Promise<void> {
    // Parse shortcut string like "CommandOrControl+Shift+R"
    const handler = (e: KeyboardEvent) => {
      if (this.matchesShortcut(e, shortcut)) {
        e.preventDefault();
        callback();
      }
    };

    this.handlers.set(shortcut, handler);
    window.addEventListener("keydown", handler);
  }

  async unregister(shortcut: string): Promise<void> {
    const handler = this.handlers.get(shortcut);
    if (handler) {
      window.removeEventListener("keydown", handler);
      this.handlers.delete(shortcut);
    }
  }

  private matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
    const parts = shortcut.toLowerCase().split("+");
    const key = parts.pop();

    const needsCmd =
      parts.includes("commandorcontrol") || parts.includes("cmd");
    const needsShift = parts.includes("shift");
    const needsAlt = parts.includes("alt");

    const hasCmd = e.metaKey || e.ctrlKey;
    const hasShift = e.shiftKey;
    const hasAlt = e.altKey;

    return (
      e.key.toLowerCase() === key &&
      hasCmd === needsCmd &&
      hasShift === needsShift &&
      hasAlt === needsAlt
    );
  }
}

// ----- Storage -----

class WebStorageService implements StorageService {
  private prefix = "compare_";

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = localStorage.getItem(this.prefix + key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (err) {
      console.error("Failed to save to localStorage:", err);
    }
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }
}

// ----- Opener -----

class WebOpenerService implements OpenerService {
  async openUrl(url: string): Promise<void> {
    window.open(url, "_blank");
  }

  async openFile(_path: string): Promise<void> {
    console.warn("[WebOpenerService] openFile not available in browser");
  }

  async openPath(_path: string): Promise<void> {
    console.warn("[WebOpenerService] openPath not available in browser");
  }

  async revealItemInDir(_path: string): Promise<void> {
    console.warn("[WebOpenerService] revealItemInDir not available in browser");
  }

  async openInEditor(path: string, line?: number): Promise<void> {
    // Try VS Code URL protocol
    const target = line ? `${path}:${line}` : path;
    const url = `vscode://file${target}`;
    window.location.href = url;
  }
}

// ----- Window -----

class WebWindowHandle implements WindowHandle {
  async setTitle(title: string): Promise<void> {
    document.title = title;
  }

  async show(): Promise<void> {
    // No-op in browser
  }

  async setFocus(): Promise<void> {
    window.focus();
  }

  async close(): Promise<void> {
    window.close();
  }
}

class WebWindowService implements WindowService {
  getCurrent(): WindowHandle {
    return new WebWindowHandle();
  }

  async setTitle(title: string): Promise<void> {
    document.title = title;
  }

  async show(): Promise<void> {
    // No-op
  }

  async focus(): Promise<void> {
    window.focus();
  }

  async close(): Promise<void> {
    window.close();
  }

  async getVersion(): Promise<string> {
    return "dev";
  }

  getPlatformName(): string {
    // Detect platform from user agent
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "macos";
    if (ua.includes("win")) return "windows";
    if (ua.includes("linux")) return "linux";
    return "unknown";
  }
}

// ----- Menu Events -----

class WebMenuEventService implements MenuEventService {
  on(_event: string, _callback: () => void): () => void {
    // No menu events in browser - return no-op unlisten
    return () => {};
  }
}

// ----- Combined Services -----

let services: PlatformServices | null = null;

/**
 * Get the web platform services (singleton)
 */
export function getWebServices(): PlatformServices {
  if (!services) {
    services = {
      clipboard: new WebClipboardService(),
      notifications: new WebNotificationService(),
      dialogs: new WebDialogService(),
      shortcuts: new WebShortcutService(),
      storage: new WebStorageService(),
      opener: new WebOpenerService(),
      window: new WebWindowService(),
      menuEvents: new WebMenuEventService(),
    };
  }
  return services;
}
