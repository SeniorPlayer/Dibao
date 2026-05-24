import { dibaoSentryConfig, dibaoVersion, hasDibaoSentryDsn } from "@dibao/shared";

const telemetryPreferenceKey = "dibao.telemetry.enabled";

type SentryReact = typeof import("@sentry/react");

let telemetryEnabled = true;
let sentrySdk: SentryReact | null = null;
let sentryLoadPromise: Promise<SentryReact> | null = null;
let sentryInitialized = false;
let sentryInitializing = false;

export function readStoredTelemetryPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(telemetryPreferenceKey);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function storeTelemetryPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(telemetryPreferenceKey, String(enabled));
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

export function configureClientTelemetry(enabled: boolean): void {
  telemetryEnabled = enabled;
  storeTelemetryPreference(enabled);

  if (!telemetryEnabled) {
    void sentrySdk?.getReplay()?.stop();
  } else if (sentryInitialized) {
    sentrySdk?.getReplay()?.start();
  }

  if (!sentryInitialized && !sentryInitializing && telemetryEnabled && hasDibaoSentryDsn()) {
    const tracesSampleRate = import.meta.env.DEV
      ? dibaoSentryConfig.devTracesSampleRate
      : dibaoSentryConfig.tracesSampleRate;

    sentryInitializing = true;
    void loadSentry().then((Sentry) => {
      sentryInitializing = false;
      if (!telemetryEnabled || sentryInitialized) {
        return;
      }

      Sentry.init({
        dsn: dibaoSentryConfig.dsn,
        enabled: true,
        environment: import.meta.env.MODE,
        release: `dibao@${dibaoVersion}`,
        sendDefaultPii: false,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({
            maskAllText: true,
            blockAllMedia: true
          })
        ],
        tracesSampler: () => (telemetryEnabled ? tracesSampleRate : 0),
        replaysSessionSampleRate: dibaoSentryConfig.replaysSessionSampleRate,
        replaysOnErrorSampleRate: dibaoSentryConfig.replaysOnErrorSampleRate,
        tracePropagationTargets: [/^\/api\//, window.location.origin],
        beforeSend: (event) => (telemetryEnabled ? event : null),
        beforeSendTransaction: (event) => (telemetryEnabled ? event : null)
      });
      sentryInitialized = true;
    }).catch(() => {
      sentryInitializing = false;
      sentryLoadPromise = null;
    });
  }
}

function loadSentry(): Promise<SentryReact> {
  if (!sentryLoadPromise) {
    sentryLoadPromise = import("@sentry/react").then((module) => {
      sentrySdk = module;
      return module;
    });
  }

  return sentryLoadPromise;
}
