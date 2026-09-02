import { base32Hex, canonicalPayload, hexToBytes, targetEventId, type Sha256Hex } from "../core/identity";
import { projectEvent } from "../core/privacy";
import type { EventDateTime, ProjectedEvent, ProjectionPolicy, SourceAccessRole, SourceEvent } from "../core/types";
import type { CalendarEvent, CalendarListEntry } from "../google/calendarGateway";
import type { SourceCalendarReader } from "../google/sourceReader";
import type { DestinationCalendarWriter } from "../google/destinationWriter";
import { googleErrorCode, isRetryableGoogleError } from "../google/retry";
import type { CalendarShareConfig } from "./config";
import type { CalendarShareState } from "./state";

const MANAGED_VERSION = "v1";
const UNAVAILABLE_PURGE_THRESHOLD = 3;
const MAX_EXECUTION_MS = 270_000;
const MANAGED_PROPERTY_KEYS = ["csManaged", "csSourceHash", "csOccurrenceHash", "csPolicyVersion", "csPayloadHash"] as const;

export interface ReconcileDependencies {
  reader: Pick<SourceCalendarReader, "listCalendars" | "listOccurrences">;
  writer: Pick<DestinationCalendarWriter, "listLiveEvents" | "insert" | "update" | "delete">;
  sha256Hex: Sha256Hex;
  now: () => Date;
  log?: (record: Record<string, unknown>) => void;
}

export interface ReconcileCounts {
  sourcesConfigured: number;
  sourcesSuccessful: number;
  desired: number;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  unmanagedTargetEvents: number;
}

export interface ReconcileResult {
  status: "ok" | "partial";
  counts: ReconcileCounts;
  sourceFailures: Array<{ sourceHash: string; kind: "temporary" | "unavailable"; message: string }>;
  state: CalendarShareState;
}

interface DesiredEvent {
  id: string;
  sourceHash: string;
  payload: ProjectedEvent;
  resource: CalendarEvent;
}

function normalizedAccessRole(role: string | undefined): SourceAccessRole {
  switch (role) {
    case "owner":
    case "writer":
    case "writerWithoutPrivateAccess":
    case "reader":
    case "freeBusyReader":
    case "none":
      return role;
    default:
      return "none";
  }
}

function copyDateTime(value: CalendarEvent["start"], field: "start" | "end"): EventDateTime {
  if (!value || (!value.date && !value.dateTime)) throw new Error(`Source occurrence is missing ${field}`);
  return {
    ...(value.date === undefined ? {} : { date: value.date }),
    ...(value.dateTime === undefined ? {} : { dateTime: value.dateTime }),
    ...(value.timeZone === undefined ? {} : { timeZone: value.timeZone }),
  };
}

function toSourceEvent(event: CalendarEvent, accessRole: SourceAccessRole): SourceEvent {
  if (!event.id) throw new Error("Source occurrence is missing its event ID");
  const summary = typeof event.summary === "string" ? event.summary : undefined;
  const description = typeof event.description === "string" ? event.description : undefined;
  const location = typeof event.location === "string" ? event.location : undefined;
  const visibility = typeof event.visibility === "string" ? event.visibility : undefined;
  const status = typeof event.status === "string" ? event.status : undefined;
  const transparency = typeof event.transparency === "string" ? event.transparency : undefined;
  const redacted = accessRole === "freeBusyReader" ||
    ((accessRole === "reader" || accessRole === "writerWithoutPrivateAccess") &&
      summary === undefined && description === undefined && location === undefined);

  return {
    id: event.id,
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
    ...(location === undefined ? {} : { location }),
    ...(visibility === undefined ? {} : { visibility }),
    ...(status === undefined ? {} : { status }),
    ...(transparency === undefined ? {} : { transparency }),
    ...(typeof event.recurringEventId === "string" ? { recurringEventId: event.recurringEventId } : {}),
    ...(event.originalStartTime ? { originalStartTime: copyDateTime(event.originalStartTime, "start") } : {}),
    start: copyDateTime(event.start, "start"),
    end: copyDateTime(event.end, "end"),
    sourceAccessRole: accessRole,
    redacted,
  };
}

function hashBase32(value: string, sha256Hex: Sha256Hex): string {
  return base32Hex(hexToBytes(sha256Hex(value)));
}

function managedPrivateProperties(event: CalendarEvent): Record<string, string> {
  const extended = event.extendedProperties;
  if (!extended || typeof extended !== "object") return {};
  const privateProperties = (extended as { private?: unknown }).private;
  if (!privateProperties || typeof privateProperties !== "object") return {};
  const source = privateProperties as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of MANAGED_PROPERTY_KEYS) {
    if (typeof source[key] === "string") result[key] = source[key] as string;
  }
  return result;
}

function normalizeTargetPayload(event: CalendarEvent): ProjectedEvent | null {
  if (!event.start || !event.end) return null;
  const properties = managedPrivateProperties(event);
  const rawReminders = event.reminders as { useDefault?: unknown; overrides?: unknown } | undefined;
  const reminders = {
    useDefault: rawReminders?.useDefault === true,
    ...(Array.isArray(rawReminders?.overrides) && rawReminders.overrides.length
      ? { overrides: rawReminders.overrides as Array<{ method?: string; minutes?: number }> }
      : {}),
  };
  return {
    summary: typeof event.summary === "string" ? event.summary : "",
    start: copyDateTime(event.start, "start"),
    end: copyDateTime(event.end, "end"),
    ...(typeof event.location === "string" ? { location: event.location } : {}),
    ...(typeof event.description === "string" ? { description: event.description } : {}),
    status: event.status === "tentative" ? "tentative" : "confirmed",
    transparency: event.transparency === "transparent" ? "transparent" : "opaque",
    reminders,
    ...(Object.keys(properties).length ? { extendedProperties: { private: properties } } : {}),
  };
}

function makeDesiredEvent(
  sourceCalendarId: string,
  event: CalendarEvent,
  policy: ProjectionPolicy,
  accessRole: SourceAccessRole,
  sha256Hex: Sha256Hex,
): DesiredEvent | null {
  if (event.status === "cancelled") return null;
  const source = toSourceEvent(event, accessRole);
  const id = targetEventId(sourceCalendarId, source, sha256Hex);
  const sourceHash = hashBase32(`source\0${sourceCalendarId}`, sha256Hex);
  const occurrenceHash = id.slice(3);
  const basePayload = projectEvent(source, policy);
  if (!basePayload) return null;
  const payloadHash = hashBase32(canonicalPayload(basePayload), sha256Hex);
  const properties = {
    csManaged: MANAGED_VERSION,
    csSourceHash: sourceHash,
    csOccurrenceHash: occurrenceHash,
    csPolicyVersion: "1",
    csPayloadHash: payloadHash,
  };
  const payload = projectEvent(source, policy, properties);
  if (!payload) return null;
  return { id, sourceHash, payload, resource: { id, ...payload } as CalendarEvent };
}

function computeHorizon(now: Date, config: CalendarShareConfig): { timeMin: string; timeMax: string } {
  const minimum = new Date(now.getTime());
  minimum.setUTCDate(minimum.getUTCDate() - config.horizon.pastDays);
  const maximum = new Date(now.getTime());
  maximum.setUTCMonth(maximum.getUTCMonth() + config.horizon.futureMonths);
  return { timeMin: minimum.toISOString(), timeMax: maximum.toISOString() };
}

function errorCode(error: unknown): number | undefined {
  return googleErrorCode(error);
}

function safeErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code) return `Google Calendar request failed with HTTP ${code}`;
  return error instanceof Error ? error.name : "Google Calendar request failed";
}

function assertWithinBudget(startedAtMs: number, now: () => Date): void {
  if (now().getTime() - startedAtMs >= MAX_EXECUTION_MS) {
    throw new Error("CalendarShare stopped before the Apps Script execution deadline; the next run will continue convergence");
  }
}

export function reconcile(config: CalendarShareConfig, state: CalendarShareState, deps: ReconcileDependencies): ReconcileResult {
  if (!config.destinationCalendarId) throw new Error("destinationCalendarId is required");
  const startedAt = deps.now();
  const startedAtMs = startedAt.getTime();
  const horizon = computeHorizon(startedAt, config);
  const inventory = deps.reader.listCalendars();
  const inventoryById = new Map(inventory.map((entry) => [entry.id, entry]));
  const destinationEntry = inventoryById.get(config.destinationCalendarId);
  if (!destinationEntry || (destinationEntry.accessRole !== "owner" && destinationEntry.accessRole !== "writer")) {
    throw new Error("The configured destination calendar is missing or is not writable; setup will not create a silent replacement");
  }

  const targetEvents = deps.writer.listLiveEvents();
  const targetById = new Map(targetEvents.map((event) => [event.id, event]));
  const desiredById = new Map<string, DesiredEvent>();
  const desiredIdsBySource = new Map<string, Set<string>>();
  const successfulSources = new Set<string>();
  const confirmedUnavailableSources = new Set<string>();
  const activeSourceHashes = new Set<string>();
  const sourceFailures: ReconcileResult["sourceFailures"] = [];

  const configuredSources = Object.entries(config.sources).filter(([, policy]) => policy.policy !== "IGNORE");
  for (const [sourceCalendarId, policy] of configuredSources) {
    assertWithinBudget(startedAtMs, deps.now);
    if (sourceCalendarId === config.destinationCalendarId) throw new Error("The destination calendar cannot be processed as a source");
    const sourceHash = hashBase32(`source\0${sourceCalendarId}`, deps.sha256Hex);
    activeSourceHashes.add(sourceHash);
    const inventoryEntry = inventoryById.get(sourceCalendarId);
    const accessRole = normalizedAccessRole(inventoryEntry?.accessRole);

    if (!inventoryEntry || accessRole === "none") {
      const health = state.sourceHealth[sourceHash] ?? { consecutiveUnavailable: 0 };
      health.consecutiveUnavailable += 1;
      health.lastError = startedAt.toISOString();
      state.sourceHealth[sourceHash] = health;
      if (health.consecutiveUnavailable >= UNAVAILABLE_PURGE_THRESHOLD) confirmedUnavailableSources.add(sourceHash);
      sourceFailures.push({ sourceHash, kind: "unavailable", message: "Configured source is absent or inaccessible" });
      continue;
    }

    try {
      const occurrences = deps.reader.listOccurrences(sourceCalendarId, horizon);
      const ids = new Set<string>();
      for (const occurrence of occurrences) {
        const desired = makeDesiredEvent(sourceCalendarId, occurrence, policy, accessRole, deps.sha256Hex);
        if (!desired) continue;
        desiredById.set(desired.id, desired);
        ids.add(desired.id);
      }
      desiredIdsBySource.set(sourceHash, ids);
      successfulSources.add(sourceHash);
      state.sourceHealth[sourceHash] = { consecutiveUnavailable: 0, lastSuccess: startedAt.toISOString() };
    } catch (error) {
      const code = errorCode(error);
      const unavailable = !isRetryableGoogleError(error) && (code === 403 || code === 404);
      const health = state.sourceHealth[sourceHash] ?? { consecutiveUnavailable: 0 };
      if (unavailable) health.consecutiveUnavailable += 1;
      else health.consecutiveUnavailable = 0;
      health.lastError = startedAt.toISOString();
      state.sourceHealth[sourceHash] = health;
      if (unavailable && health.consecutiveUnavailable >= UNAVAILABLE_PURGE_THRESHOLD) {
        confirmedUnavailableSources.add(sourceHash);
      }
      sourceFailures.push({ sourceHash, kind: unavailable ? "unavailable" : "temporary", message: safeErrorMessage(error) });
    }
  }

  const counts: ReconcileCounts = {
    sourcesConfigured: configuredSources.length,
    sourcesSuccessful: successfulSources.size,
    desired: desiredById.size,
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    unmanagedTargetEvents: 0,
  };

  // Creates and updates precede deletions so a partial execution does not
  // unnecessarily empty the destination.
  for (const desired of desiredById.values()) {
    assertWithinBudget(startedAtMs, deps.now);
    const existing = targetById.get(desired.id);
    const existingPayload = existing ? normalizeTargetPayload(existing) : null;
    if (existingPayload && canonicalPayload(existingPayload) === canonicalPayload(desired.payload)) {
      counts.unchanged += 1;
    } else if (existing) {
      deps.writer.update(desired.id, desired.resource);
      counts.updated += 1;
    } else {
      deps.writer.insert(desired.resource);
      counts.created += 1;
    }
  }

  for (const target of targetEvents) {
    assertWithinBudget(startedAtMs, deps.now);
    const properties = managedPrivateProperties(target);
    if (properties.csManaged !== MANAGED_VERSION) {
      counts.unmanagedTargetEvents += 1;
      continue;
    }
    const sourceHash = properties.csSourceHash;
    const explicitlyRemoved = !sourceHash || !activeSourceHashes.has(sourceHash);
    const successfullyProvenStale = Boolean(sourceHash && successfulSources.has(sourceHash) && !desiredIdsBySource.get(sourceHash)?.has(target.id));
    const confirmedUnavailable = Boolean(sourceHash && confirmedUnavailableSources.has(sourceHash));
    if (explicitlyRemoved || successfullyProvenStale || confirmedUnavailable) {
      deps.writer.delete(target.id);
      counts.deleted += 1;
    }
  }

  const finishedAt = deps.now().toISOString();
  state.lastRun = finishedAt;
  state.lastRunStatus = sourceFailures.length ? "partial" : "ok";
  state.lastRunCounts = { ...counts };
  if (!sourceFailures.length) state.lastSuccessfulRun = finishedAt;
  for (const sourceHash of Object.keys(state.sourceHealth)) {
    if (!activeSourceHashes.has(sourceHash)) delete state.sourceHealth[sourceHash];
  }
  const result: ReconcileResult = {
    status: sourceFailures.length ? "partial" : "ok",
    counts,
    sourceFailures,
    state,
  };
  deps.log?.({
    event: "calendarshare.sync",
    status: result.status,
    durationMs: deps.now().getTime() - startedAtMs,
    ...counts,
    failedSourceHashes: sourceFailures.map((failure) => failure.sourceHash),
  });
  return result;
}

export function sourceHashFor(calendarId: string, sha256Hex: Sha256Hex): string {
  return hashBase32(`source\0${calendarId}`, sha256Hex);
}

export function inventorySummary(entries: CalendarListEntry[], destinationCalendarId: string | undefined, sha256Hex: Sha256Hex) {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.summary ?? "",
    accessRole: entry.accessRole ?? "none",
    hidden: entry.hidden ?? false,
    selected: entry.selected ?? false,
    timeZone: entry.timeZone ?? "",
    sourceHash: sourceHashFor(entry.id, sha256Hex),
    isDestination: entry.id === destinationCalendarId,
  }));
}
