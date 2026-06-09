import type { AppSettingsRepository } from "@dibao/db";

export const FOREGROUND_ACTIVITY_SETTING_KEY = "runtime.foregroundActivity";
export const DEFAULT_FOREGROUND_QUIET_WINDOW_MS = 30_000;
export const DEFAULT_FOREGROUND_ACTIVITY_WRITE_THROTTLE_MS = 2_000;

export type ForegroundActivityState = {
  lastAt: number;
  route: string | null;
  method: string | null;
};

export function markForegroundActivity(
  settings: Pick<AppSettingsRepository, "setJson">,
  input: {
    now: number;
    route?: string | null;
    method?: string | null;
  }
): void {
  settings.setJson(
    FOREGROUND_ACTIVITY_SETTING_KEY,
    {
      lastAt: input.now,
      route: input.route ?? null,
      method: input.method ?? null
    } satisfies ForegroundActivityState,
    input.now
  );
}

export function foregroundQuietUntil(
  settings: Pick<AppSettingsRepository, "getJson">,
  input: {
    now: number;
    quietWindowMs: number;
  }
): number | null {
  if (input.quietWindowMs <= 0) {
    return null;
  }

  const state = settings.getJson<unknown>(FOREGROUND_ACTIVITY_SETTING_KEY);
  if (!isForegroundActivityState(state)) {
    return null;
  }

  const quietUntil = state.lastAt + input.quietWindowMs;
  return quietUntil > input.now ? quietUntil : null;
}

function isForegroundActivityState(value: unknown): value is ForegroundActivityState {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { lastAt?: unknown }).lastAt === "number" &&
    Number.isFinite((value as { lastAt: number }).lastAt)
  );
}
