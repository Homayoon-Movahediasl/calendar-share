import { STATE_PROPERTY, type PropertyStoreLike } from "./config";

export interface SourceHealth {
  consecutiveUnavailable: number;
  lastSuccess?: string;
  lastError?: string;
}

export interface LastRunCounts {
  sourcesConfigured: number;
  sourcesSuccessful: number;
  desired: number;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  unmanagedTargetEvents: number;
}

export interface CalendarShareState {
  schemaVersion: 1;
  destinationInitialized: boolean;
  lastRun?: string;
  lastSuccessfulRun?: string;
  lastRunStatus?: "ok" | "partial" | "failed";
  lastRunCounts?: LastRunCounts;
  sourceHealth: Record<string, SourceHealth>;
}

export const EMPTY_STATE: CalendarShareState = {
  schemaVersion: 1,
  destinationInitialized: false,
  sourceHealth: {},
};

export function loadState(store: PropertyStoreLike): CalendarShareState {
  const raw = store.getProperty(STATE_PROPERTY);
  if (!raw) return structuredCloneState(EMPTY_STATE);
  try {
    const parsed = JSON.parse(raw) as Partial<CalendarShareState>;
    if (parsed.schemaVersion !== 1 || typeof parsed.destinationInitialized !== "boolean") {
      throw new Error("unsupported state schema");
    }
    return {
      schemaVersion: 1,
      destinationInitialized: parsed.destinationInitialized,
      ...(typeof parsed.lastRun === "string" ? { lastRun: parsed.lastRun } : {}),
      ...(typeof parsed.lastSuccessfulRun === "string" ? { lastSuccessfulRun: parsed.lastSuccessfulRun } : {}),
      ...(parsed.lastRunStatus === "ok" || parsed.lastRunStatus === "partial" || parsed.lastRunStatus === "failed"
        ? { lastRunStatus: parsed.lastRunStatus }
        : {}),
      ...(isLastRunCounts(parsed.lastRunCounts) ? { lastRunCounts: parsed.lastRunCounts } : {}),
      sourceHealth: parsed.sourceHealth && typeof parsed.sourceHealth === "object" ? parsed.sourceHealth : {},
    };
  } catch (error) {
    throw new Error(`Invalid ${STATE_PROPERTY}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isLastRunCounts(value: unknown): value is LastRunCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const counts = value as Record<string, unknown>;
  return [
    "sourcesConfigured",
    "sourcesSuccessful",
    "desired",
    "created",
    "updated",
    "deleted",
    "unchanged",
    "unmanagedTargetEvents",
  ].every((key) => Number.isInteger(counts[key]) && (counts[key] as number) >= 0);
}

export function saveState(store: PropertyStoreLike, state: CalendarShareState): void {
  store.setProperty(STATE_PROPERTY, JSON.stringify(state));
}

function structuredCloneState(state: CalendarShareState): CalendarShareState {
  return JSON.parse(JSON.stringify(state)) as CalendarShareState;
}
