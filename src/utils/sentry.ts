import * as Sentry from "@sentry/browser";

let consentGiven = false;

export function initSentry() {
  Sentry.init({
    dsn: "https://4c45659990b56ebdb601e459f324d2a7@o77283.ingest.us.sentry.io/4510829448462336",
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
  });
}

export function setSentryConsent(enabled: boolean) {
  consentGiven = enabled;
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
