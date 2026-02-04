import * as Sentry from "@sentry/browser";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { arch, platform, version as osVersion } from "@tauri-apps/plugin-os";

let consentGiven = false;

export async function initSentry(): Promise<void> {
  const [isDev, appVersion] = await Promise.all([
    invoke<boolean>("is_dev_mode"),
    getVersion(),
  ]);

  const environment = isDev ? "development" : "production";

  Sentry.init({
    dsn: "https://4c45659990b56ebdb601e459f324d2a7@o77283.ingest.us.sentry.io/4510829448462336",
    environment,
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
