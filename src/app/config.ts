import type { ProjectionPolicy } from "../core/types";

export const CONFIG_PROPERTY = "CALENDARSHARE_CONFIG";
export const STATE_PROPERTY = "CALENDARSHARE_STATE";
export const CANDIDATES_PROPERTY = "CALENDARSHARE_CANDIDATES";
const MAX_PROPERTY_VALUE_BYTES = 9_000;

export interface CalendarShareConfig {
  schemaVersion: 1;
  destinationCalendarId?: string;
  destinationName?: string;
  horizon: {
    pastDays: number;
    futureMonths: number;
  };
  sources: Record<string, ProjectionPolicy>;
}

export const DEFAULT_CONFIG: CalendarShareConfig = {
  schemaVersion: 1,
  destinationName: "CalendarShare – Combined",
  horizon: { pastDays: 60, futureMonths: 18 },
  sources: {},
};

export interface PropertyStoreLike {
  getProperty(key: string): string | null;
  setProperty(key: string, value: string): unknown;
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}

export function validateConfig(value: unknown, requireDestination = true): CalendarShareConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CalendarShare configuration must be a JSON object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported configuration schemaVersion");

  const destinationCalendarId = candidate.destinationCalendarId;
  if (requireDestination && (typeof destinationCalendarId !== "string" || destinationCalendarId.length === 0)) {
    throw new Error("destinationCalendarId is required; run setup() first");
  }
  if (destinationCalendarId !== undefined && (typeof destinationCalendarId !== "string" || destinationCalendarId.length === 0)) {
    throw new Error("destinationCalendarId must be a non-empty string when set");
  }
  if (candidate.destinationName !== undefined && typeof candidate.destinationName !== "string") {
    throw new Error("destinationName must be a string");
  }
  if (typeof candidate.destinationName === "string" && (candidate.destinationName.trim().length === 0 || candidate.destinationName.length > 200)) {
    throw new Error("destinationName must contain 1 to 200 characters");
  }

  const horizon = candidate.horizon as Record<string, unknown> | undefined;
  if (!horizon || !Number.isInteger(horizon.pastDays) || !Number.isInteger(horizon.futureMonths)) {
    throw new Error("horizon.pastDays and horizon.futureMonths must be integers");
  }
  if ((horizon.pastDays as number) < 0 || (horizon.pastDays as number) > 365) {
    throw new Error("horizon.pastDays must be between 0 and 365");
  }
  if ((horizon.futureMonths as number) < 1 || (horizon.futureMonths as number) > 36) {
    throw new Error("horizon.futureMonths must be between 1 and 36");
  }

  if (!candidate.sources || typeof candidate.sources !== "object" || Array.isArray(candidate.sources)) {
    throw new Error("sources must be an object keyed by source calendar ID");
  }

  const sources: Record<string, ProjectionPolicy> = {};
  for (const [calendarId, rawPolicy] of Object.entries(candidate.sources as Record<string, unknown>)) {
    if (!calendarId) throw new Error("Source calendar IDs cannot be empty");
    if (calendarId === destinationCalendarId) throw new Error("The destination calendar cannot be configured as a source");
    if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
      throw new Error("Every source policy must be an object");
    }
    const policy = rawPolicy as Record<string, unknown>;
    if (policy.policy !== "FULL" && policy.policy !== "BUSY_ONLY" && policy.policy !== "IGNORE") {
      throw new Error("Source policy must be FULL, BUSY_ONLY, or IGNORE");
    }
    for (const key of ["allowPrivateDetails", "copyDescription", "copyLocation"] as const) {
      if (policy[key] !== undefined) assertBoolean(policy[key], key);
    }
    if (policy.busyLabel !== undefined && typeof policy.busyLabel !== "string") {
      throw new Error("busyLabel must be a string");
    }
    sources[calendarId] = {
      policy: policy.policy,
      ...(policy.allowPrivateDetails === undefined ? {} : { allowPrivateDetails: policy.allowPrivateDetails }),
      ...(policy.copyDescription === undefined ? {} : { copyDescription: policy.copyDescription }),
      ...(policy.copyLocation === undefined ? {} : { copyLocation: policy.copyLocation }),
      ...(policy.busyLabel === undefined ? {} : { busyLabel: policy.busyLabel }),
    } as ProjectionPolicy;
  }

  return {
    schemaVersion: 1,
    ...(destinationCalendarId === undefined ? {} : { destinationCalendarId }),
    ...(candidate.destinationName === undefined ? {} : { destinationName: candidate.destinationName as string }),
    horizon: {
      pastDays: horizon.pastDays as number,
      futureMonths: horizon.futureMonths as number,
    },
    sources,
  };
}

export function loadConfig(store: PropertyStoreLike, requireDestination = true): CalendarShareConfig {
  const raw = store.getProperty(CONFIG_PROPERTY);
  if (!raw) {
    if (requireDestination) throw new Error(`Missing Script Property ${CONFIG_PROPERTY}; run setup() first`);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CalendarShareConfig;
  }
  try {
    return validateConfig(JSON.parse(raw), requireDestination);
  } catch (error) {
    throw new Error(`Invalid ${CONFIG_PROPERTY}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function saveConfig(store: PropertyStoreLike, config: CalendarShareConfig): void {
  const serialized = JSON.stringify(validateConfig(config, Boolean(config.destinationCalendarId)));
  if (utf8ByteLength(serialized) > MAX_PROPERTY_VALUE_BYTES) {
    throw new Error(`${CONFIG_PROPERTY} is too large for one Apps Script property; remove unused source policies or shorten custom labels`);
  }
  store.setProperty(CONFIG_PROPERTY, serialized);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
