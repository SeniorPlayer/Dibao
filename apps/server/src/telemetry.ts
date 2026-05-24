import * as Sentry from "@sentry/node";
import type { FastifyInstance } from "fastify";
import { dibaoSentryConfig, dibaoVersion, hasDibaoSentryDsn } from "@dibao/shared";

type TelemetryOptions = {
  enabled: boolean;
};

let telemetryEnabled = false;
let sentryInitialized = false;
const fastifyAppsWithErrorHandler = new WeakSet<FastifyInstance>();

export function configureServerTelemetry(options: TelemetryOptions): void {
  telemetryEnabled = options.enabled;

  if (!sentryInitialized && telemetryEnabled && hasDibaoSentryDsn()) {
    const tracesSampleRate =
      process.env.NODE_ENV === "production"
        ? dibaoSentryConfig.tracesSampleRate
        : dibaoSentryConfig.devTracesSampleRate;

    Sentry.init({
      dsn: dibaoSentryConfig.dsn,
      enabled: true,
      environment: process.env.NODE_ENV ?? "development",
      release: `dibao@${dibaoVersion}`,
      sendDefaultPii: false,
      tracesSampler: () => (telemetryEnabled ? tracesSampleRate : 0),
      beforeSend: (event) => (telemetryEnabled ? event : null),
      integrations: [
        Sentry.fastifyIntegration({
          shouldHandleError: (_error, _request, reply) =>
            telemetryEnabled && reply.statusCode >= 500
        })
      ]
    });
    sentryInitialized = true;
  }
}

export function attachServerTelemetryErrorHandler(app: FastifyInstance): void {
  if (fastifyAppsWithErrorHandler.has(app)) {
    return;
  }

  Sentry.setupFastifyErrorHandler(app, {
    shouldHandleError: (_error, _request, reply) =>
      telemetryEnabled && reply.statusCode >= 500
  });
  fastifyAppsWithErrorHandler.add(app);
}
