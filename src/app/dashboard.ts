import type { PrivacyPolicy, ProjectionPolicy } from "../core/types";
import type { CalendarListEntry } from "../google/calendarGateway";
import { validateConfig, type CalendarShareConfig } from "./config";
import type { SourceHealth } from "./state";
import type { ReconcileCounts, ReconcileResult } from "./reconcile";

export interface DashboardInventoryEntry extends CalendarListEntry {
  primary?: boolean;
}

export interface DashboardCalendarRow {
  id: string;
  name: string;
  timeZone: string;
  accessRole: string;
  primary: boolean;
  selected: boolean;
  hidden: boolean;
  missing: boolean;
  available: boolean;
  freeBusyOnly: boolean;
  isDestination: boolean;
  policy: PrivacyPolicy;
  copyDescription: boolean;
  copyLocation: boolean;
  allowPrivateDetails: boolean;
  busyLabel: string;
  sourceHash?: string;
  sourceHealth?: SourceHealth;
}

export interface DashboardDestinationState {
  id?: string;
  name?: string;
  status: "ready" | "not-configured" | "unavailable";
  calendarUrl?: string;
}

export interface DashboardTriggerState {
  count: number;
  intervalMinutes: number;
}

export interface DashboardHealthState {
  lastRun?: string;
  lastSuccessfulRun?: string;
  lastRunStatus?: "ok" | "partial" | "failed";
  lastRunCounts?: ReconcileCounts;
}

export interface DashboardState {
  destination: DashboardDestinationState;
  trigger: DashboardTriggerState;
  horizon: CalendarShareConfig["horizon"];
  calendars: DashboardCalendarRow[];
  health: DashboardHealthState;
}

export interface DashboardSourceInput extends Partial<Omit<ProjectionPolicy, "policy">> {
  id?: string;
  policy: PrivacyPolicy;
}

export interface DashboardConfigInput {
  destinationName?: string;
  horizon: {
    pastDays: number;
    futureMonths: number;
  };
  /** The UI uses the record shape. The row shape is accepted for testable duplicate detection. */
  sources: Record<string, DashboardSourceInput> | DashboardSourceInput[];
}

export interface DashboardDryRunSource {
  sourceHash: string;
  status: "readable" | "missing" | "error";
  accessRole?: string;
  occurrenceCount?: number;
  recurringCount?: number;
  allDayCount?: number;
  privateCount?: number;
  errorType?: string;
}

export interface DashboardDryRunResult {
  status: "ok" | "partial";
  generatedAt: string;
  sourceCount: number;
  sources: DashboardDryRunSource[];
}

export interface DashboardSyncResult {
  status: ReconcileResult["status"] | "skipped";
  counts?: ReconcileCounts;
  sourceFailures?: ReconcileResult["sourceFailures"];
  reason?: string;
}

export interface DashboardCalendarBuildOptions {
  sourceHashForId?: (calendarId: string) => string;
  sourceHealth?: Record<string, SourceHealth>;
}

function displayOptions(policy: ProjectionPolicy | undefined): Pick<DashboardCalendarRow,
  "copyDescription" | "copyLocation" | "allowPrivateDetails" | "busyLabel"
> {
  const full = policy?.policy === "FULL";
  return {
    // An already-configured FULL policy without explicit flags uses the core
    // projection defaults (copy both). New/ignored rows start conservatively.
    copyDescription: full ? policy.copyDescription !== false : policy?.copyDescription === true,
    copyLocation: full ? policy.copyLocation !== false : policy?.copyLocation === true,
    allowPrivateDetails: policy?.allowPrivateDetails === true,
    busyLabel: policy?.busyLabel ?? "Busy",
  };
}

function isReadableRole(accessRole: string | undefined): boolean {
  return accessRole === "freeBusyReader" || accessRole === "reader" ||
    accessRole === "writerWithoutPrivateAccess" || accessRole === "writer" || accessRole === "owner";
}

/**
 * Builds the dashboard inventory without losing configured calendars whose
 * CalendarList entries have temporarily disappeared.
 */
export function buildDashboardCalendars(
  config: CalendarShareConfig,
  inventory: DashboardInventoryEntry[],
  options: DashboardCalendarBuildOptions = {},
): DashboardCalendarRow[] {
  const liveIds = new Set<string>();
  const rows: DashboardCalendarRow[] = [];

  for (const entry of inventory) {
    if (!entry.id || liveIds.has(entry.id)) continue;
    liveIds.add(entry.id);
    const isDestination = entry.id === config.destinationCalendarId;
    const configured = isDestination ? undefined : config.sources[entry.id];
    const freeBusyOnly = entry.accessRole === "freeBusyReader";
    const available = isReadableRole(entry.accessRole);
    const sourceHash = isDestination ? undefined : options.sourceHashForId?.(entry.id);
    const configuredPolicy = configured?.policy ?? "IGNORE";
    const policy = isDestination
      ? "IGNORE"
      : freeBusyOnly && configuredPolicy === "FULL" ? "BUSY_ONLY" : configuredPolicy;
    rows.push({
      id: entry.id,
      name: entry.summary ?? "",
      timeZone: entry.timeZone ?? "",
      accessRole: entry.accessRole ?? "none",
      primary: entry.primary === true,
      selected: entry.selected === true,
      hidden: entry.hidden === true,
      missing: false,
      available,
      freeBusyOnly,
      isDestination,
      policy,
      ...displayOptions(configured),
      ...(sourceHash ? { sourceHash } : {}),
      ...(sourceHash && options.sourceHealth?.[sourceHash]
        ? { sourceHealth: options.sourceHealth[sourceHash] }
        : {}),
    });
  }

  for (const [calendarId, configured] of Object.entries(config.sources)) {
    if (liveIds.has(calendarId) || calendarId === config.destinationCalendarId) continue;
    const sourceHash = options.sourceHashForId?.(calendarId);
    rows.push({
      id: calendarId,
      name: "Unavailable calendar",
      timeZone: "",
      accessRole: "none",
      primary: false,
      selected: false,
      hidden: false,
      missing: true,
      available: false,
      freeBusyOnly: false,
      isDestination: false,
      policy: configured.policy,
      ...displayOptions(configured),
      ...(sourceHash ? { sourceHash } : {}),
      ...(sourceHash && options.sourceHealth?.[sourceHash]
        ? { sourceHealth: options.sourceHealth[sourceHash] }
        : {}),
    });
  }

  return rows;
}

function submittedSources(value: unknown): Map<string, DashboardSourceInput> {
  if (!value || typeof value !== "object") throw new Error("sources must be an object or array");
  const result = new Map<string, DashboardSourceInput>();
  const rows: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Every source must be an object");
      const id = (raw as { id?: unknown }).id;
      if (typeof id !== "string" || !id) throw new Error("Every source row must have a non-empty id");
      return [id, raw];
    })
    : Object.entries(value as Record<string, unknown>);

  for (const [calendarId, raw] of rows) {
    if (!calendarId) throw new Error("Source calendar IDs cannot be empty");
    if (result.has(calendarId)) throw new Error(`Duplicate source calendar ID: ${calendarId}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Every source policy must be an object");
    result.set(calendarId, raw as DashboardSourceInput);
  }
  return result;
}

function normalizedPolicy(raw: DashboardSourceInput, previous?: ProjectionPolicy): ProjectionPolicy {
  if (raw.policy !== "FULL" && raw.policy !== "BUSY_ONLY" && raw.policy !== "IGNORE") {
    throw new Error("Source policy must be FULL, BUSY_ONLY, or IGNORE");
  }
  const result: ProjectionPolicy = { policy: raw.policy };
  for (const key of ["allowPrivateDetails", "copyDescription", "copyLocation"] as const) {
    const value = raw[key] === undefined ? previous?.[key] : raw[key];
    if (value !== undefined) {
      if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
      result[key] = value;
    }
  }
  const busyLabel = raw.busyLabel === undefined ? previous?.busyLabel : raw.busyLabel;
  if (busyLabel !== undefined) {
    if (typeof busyLabel !== "string") throw new Error("busyLabel must be a string");
    result.busyLabel = busyLabel;
  }
  return result;
}

/**
 * Treats the browser payload as untrusted. Destination identity and all other
 * server-owned fields come from the existing configuration.
 */
export function normalizeDashboardConfig(
  existing: CalendarShareConfig,
  inventory: DashboardInventoryEntry[],
  input: unknown,
): CalendarShareConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Dashboard configuration must be an object");
  }
  const candidate = input as Partial<DashboardConfigInput>;
  if (!candidate.horizon || typeof candidate.horizon !== "object") {
    throw new Error("horizon is required");
  }
  const submitted = submittedSources(candidate.sources);
  if (candidate.destinationName !== undefined && typeof candidate.destinationName !== "string") {
    throw new Error("destinationName must be a string");
  }
  const destinationName = candidate.destinationName === undefined
    ? existing.destinationName
    : candidate.destinationName.trim();
  if (!destinationName) throw new Error("destinationName cannot be empty");
  if (destinationName.length > 200) throw new Error("destinationName must be 200 characters or fewer");
  const inventoryById = new Map(inventory.filter((entry) => Boolean(entry.id)).map((entry) => [entry.id, entry]));
  const previouslyConfigured = new Set(Object.keys(existing.sources));
  const acceptedIds = new Set([...inventoryById.keys(), ...previouslyConfigured]);

  for (const calendarId of submitted.keys()) {
    if (calendarId === existing.destinationCalendarId) {
      throw new Error("The destination calendar cannot be configured as a source");
    }
    if (!acceptedIds.has(calendarId)) {
      throw new Error(`Unknown source calendar ID: ${calendarId}`);
    }
  }

  const sources: Record<string, ProjectionPolicy> = {};
  for (const [calendarId, entry] of inventoryById) {
    if (calendarId === existing.destinationCalendarId) continue;
    const raw = submitted.get(calendarId);
    let policy = raw ? normalizedPolicy(raw, existing.sources[calendarId]) : { policy: "IGNORE" } as ProjectionPolicy;
    if (!isReadableRole(entry.accessRole)) {
      const previous = existing.sources[calendarId];
      policy = raw?.policy === "IGNORE" || !previous ? { policy: "IGNORE" } : previous;
    }
    if (entry.accessRole === "freeBusyReader" && policy.policy !== "IGNORE") {
      policy = { ...policy, policy: "BUSY_ONLY", allowPrivateDetails: false, copyDescription: false, copyLocation: false };
    }
    if (policy.policy !== "IGNORE") sources[calendarId] = policy;
  }

  for (const calendarId of previouslyConfigured) {
    if (inventoryById.has(calendarId) || calendarId === existing.destinationCalendarId) continue;
    const raw = submitted.get(calendarId);
    // Missing rows remain configured if an older/stale UI omits them. They are
    // removed from live projection only when the owner explicitly chooses IGNORE.
    const policy = raw ? normalizedPolicy(raw, existing.sources[calendarId]) : existing.sources[calendarId];
    if (policy.policy !== "IGNORE") sources[calendarId] = policy;
  }

  return validateConfig({
    schemaVersion: 1,
    ...(existing.destinationCalendarId ? { destinationCalendarId: existing.destinationCalendarId } : {}),
    destinationName,
    horizon: {
      pastDays: candidate.horizon.pastDays,
      futureMonths: candidate.horizon.futureMonths,
    },
    sources,
  }, Boolean(existing.destinationCalendarId));
}
