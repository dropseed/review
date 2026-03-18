import * as Sentry from "@sentry/browser";
import { isTauriEnvironment } from "../api/client";

let consentGiven = false;

export async function initSentry(): Promise<void> {
  if (!isTauriEnvironment()) return; // Skip in web mode

  // Dynamic imports to avoid loading Tauri modules in browser
  const { getVersion } = await import("@tauri-apps/api/app");
  const { invoke } = await import("@tauri-apps/api/core");
  const {
    arch,
    platform,
    version: osVersion,
  } = await import("@tauri-apps/plugin-os");

  const [isDev, appVersion] = await Promise.all([
    invoke<boolean>("is_dev_mode"),
    getVersion(),
  ]);

  // Skip Sentry in development
  if (isDev) {
    return;
  }

  Sentry.init({
    dsn: "https://4c45659990b56ebdb601e459f324d2a7@o77283.ingest.us.sentry.io/4510829448462336",
    environment: "production",
    release: `review@${appVersion}`,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (!consentGiven) {
        return null;
      }
      // Strip PII fields
      delete event.user;
      delete event.server_name;
      return event;
    },
    initialScope: {
      contexts: {
        os: {
          name: platform(),
          version: osVersion(),
        },
        device: {
          arch: arch(),
        },
      },
    },
  });
}

export function setSentryConsent(enabled: boolean): void {
  consentGiven = enabled;
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
