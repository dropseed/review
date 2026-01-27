/**
 * Platform Services Interface
 *
 * Abstracts platform-specific functionality (clipboard, notifications, dialogs, etc.)
 * to enable browser-based testing and future web version.
 */

/**
 * Clipboard service for copying text
 */
export interface ClipboardService {
  /** Write text to the clipboard */
  writeText(text: string): Promise<void>;
}

/**
 * Notification service for desktop notifications
 */
export interface NotificationService {
  /** Show a notification */
  show(title: string, body: string): Promise<void>;

  /** Request permission to show notifications */
  requestPermission(): Promise<boolean>;

  /** Check if notifications are enabled */
  isEnabled(): Promise<boolean>;
}

/**
 * Dialog service for file/folder pickers and confirmations
 */
export interface DialogService {
  /** Open a directory picker dialog */
  openDirectory(options?: { title?: string }): Promise<string | null>;

  /** Show a confirmation dialog (returns true if confirmed) */
  confirm(message: string, title?: string): Promise<boolean>;

  /** Show an alert dialog */
  alert(message: string, title?: string): Promise<void>;
}

/**
 * Global shortcut service
 */
export interface ShortcutService {
  /** Register a global keyboard shortcut */
  register(shortcut: string, callback: () => void): Promise<void>;

  /** Unregister a global keyboard shortcut */
  unregister(shortcut: string): Promise<void>;
}

/**
 * Storage service for persisted preferences
 */
export interface StorageService {
  /** Get a value from storage */
  get<T>(key: string): Promise<T | null>;

  /** Set a value in storage */
  set<T>(key: string, value: T): Promise<void>;

  /** Delete a value from storage */
  delete(key: string): Promise<void>;
}

/**
 * Opener service for opening URLs and files
 */
export interface OpenerService {
  /** Open a URL in the default browser */
  openUrl(url: string): Promise<void>;

  /** Open a file with the default application */
  openFile(path: string): Promise<void>;

  /** Open a file/folder path with the system handler */
  openPath(path: string): Promise<void>;

  /** Reveal an item in the file manager (Finder/Explorer) */
  revealItemInDir(path: string): Promise<void>;

  /** Open a file in VS Code or other editor */
  openInEditor(path: string, line?: number): Promise<void>;
}

/**
 * Window service for window management
 */
export interface WindowService {
  /** Get the current window */
  getCurrent(): WindowHandle;

  /** Set the window title */
  setTitle(title: string): Promise<void>;

  /** Show the window */
  show(): Promise<void>;

  /** Focus the window */
  focus(): Promise<void>;

  /** Close the window */
  close(): Promise<void>;

  /** Get the app version */
  getVersion(): Promise<string>;

  /** Get the platform name (macos, windows, linux) */
  getPlatformName(): string;
}

export interface WindowHandle {
  setTitle(title: string): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Menu event service for listening to menu actions
 */
export interface MenuEventService {
  /** Subscribe to a menu event */
  on(event: string, callback: () => void): () => void;
}

/**
 * Combined platform services
 */
export interface PlatformServices {
  clipboard: ClipboardService;
  notifications: NotificationService;
  dialogs: DialogService;
  shortcuts: ShortcutService;
  storage: StorageService;
  opener: OpenerService;
  window: WindowService;
  menuEvents: MenuEventService;
}
