import { AppsScriptCalendarGateway } from "../google/calendarGateway";
import { DestinationCalendarWriter } from "../google/destinationWriter";
import { SourceCalendarReader } from "../google/sourceReader";
import { googleErrorCode, withGoogleRetry } from "../google/retry";
import { CANDIDATES_PROPERTY, DEFAULT_CONFIG, loadConfig, saveConfig, type CalendarShareConfig } from "./config";
import {
  buildDashboardCalendars,
  normalizeDashboardConfig,
  type DashboardDryRunResult,
  type DashboardState,
  type DashboardSyncResult,
} from "./dashboard";
import { inventorySummary, reconcile, sourceHashFor } from "./reconcile";
import { loadState, saveState } from "./state";

const SYNC_HANDLER = "syncCombinedCalendar";

export interface DryRunSourceResult {
  sourceHash: string;
  status: "missing" | "readable" | "error";
  accessRole?: string;
  occurrenceCount?: number;
  recurringCount?: number;
  allDayCount?: number;
  privateCount?: number;
  errorType?: string;
}

export interface DryRunResult {
  generatedAt: string;
  sources: DryRunSourceResult[];
}

function scriptProperties() {
  return PropertiesService.getScriptProperties();
}

function calendarApi() {
  const api = Calendar;
  if (!api) throw new Error("The Advanced Calendar service is not enabled for this Apps Script project");
  return api;
}

export function appsScriptSha256Hex(value: string): string {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0")).join("");
}

function createGateway() {
  return new AppsScriptCalendarGateway(calendarApi(), {
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 4_000,
    jitterRatio: 0.2,
    sleep: (milliseconds) => Utilities.sleep(milliseconds),
  });
}

function createDestination(config: CalendarShareConfig): string {
  const resource = calendarApi().Calendars.insert({
    summary: config.destinationName ?? DEFAULT_CONFIG.destinationName,
    timeZone: Session.getScriptTimeZone() || "Etc/UTC",
  });
  if (!resource.id) throw new Error("Google created the destination without returning an ID");
  return resource.id;
}

function destinationExists(destinationCalendarId: string): boolean {
  try {
    calendarApi().Calendars.get(destinationCalendarId);
    return true;
  } catch (error) {
    if (googleErrorCode(error) === 404) return false;
    const message = String(error instanceof Error ? error.message : error);
    if (/not found/i.test(message)) return false;
    throw error;
  }
}

function renameDestination(destinationCalendarId: string, destinationName: string): void {
  withGoogleRetry(() => calendarApi().Calendars.patch(
    { summary: destinationName },
    destinationCalendarId,
  ), {
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 4_000,
    jitterRatio: 0.2,
    sleep: (milliseconds) => Utilities.sleep(milliseconds),
  });
}

function installSingleTrigger(): void {
  const existing = ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === SYNC_HANDLER);
  if (existing.length === 1) return;
  for (const trigger of existing) ScriptApp.deleteTrigger(trigger);
  ScriptApp.newTrigger(SYNC_HANDLER).timeBased().everyMinutes(15).create();
}

function normalizedDestinationName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("destinationName must be a string");
  const result = value.trim();
  if (!result) throw new Error("destinationName cannot be empty");
  if (result.length > 200) throw new Error("destinationName must be 200 characters or fewer");
  return result;
}

function ensureSetup(
  store: ReturnType<typeof scriptProperties>,
  requestedDestinationName?: string,
): CalendarShareConfig {
  const state = loadState(store);
  const config = loadConfig(store, false);
  if (requestedDestinationName !== undefined) config.destinationName = requestedDestinationName;

  if (config.destinationCalendarId) {
    if (!destinationExists(config.destinationCalendarId)) {
      throw new Error("The stored destination calendar no longer exists. CalendarShare will not silently create an unshared replacement.");
    }
    if (!state.destinationInitialized) {
      state.destinationInitialized = true;
      saveState(store, state);
    }
    if (requestedDestinationName !== undefined) {
      const previous = loadConfig(store, false).destinationName;
      if (previous !== requestedDestinationName) renameDestination(config.destinationCalendarId, requestedDestinationName);
      saveConfig(store, config);
    }
  } else {
    if (state.destinationInitialized) {
      throw new Error("Destination creation was already started but its ID is missing. Inspect CalendarShare candidates, recover the ID if a calendar was created, or explicitly reset setup state after review.");
    }
    // Mark creation before the non-idempotent API call. If Google accepts the
    // request but the response is lost, later setup calls stop instead of
    // creating an ambiguous duplicate destination.
    state.destinationInitialized = true;
    saveState(store, state);
    config.destinationCalendarId = createDestination(config);
    saveConfig(store, config);
  }

  installSingleTrigger();
  return config;
}

export function setup(): string {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10_000)) throw new Error("Another CalendarShare setup or sync execution is active");
  try {
    const config = ensureSetup(scriptProperties());
    return JSON.stringify({
      status: "ready",
      destinationCalendarId: config.destinationCalendarId,
      triggerIntervalMinutes: 15,
      nextStep: "Deploy or open the owner dashboard, choose source policies, save, then run the dry check before the first live sync.",
    });
  } finally {
    lock.releaseLock();
  }
}

export function initializeDashboard(input: unknown): DashboardState {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10_000)) throw new Error("Another CalendarShare setup, save, or sync execution is active");
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Dashboard initialization input must be an object");
    }
    const destinationName = normalizedDestinationName((input as { destinationName?: unknown }).destinationName)
      ?? DEFAULT_CONFIG.destinationName!;
    const store = scriptProperties();
    const config = ensureSetup(store, destinationName);
    const inventory = new SourceCalendarReader(createGateway()).listCalendars();
    return buildDashboardState(config, loadState(store), inventory);
  } finally {
    lock.releaseLock();
  }
}

export function listCandidateCalendars(): string {
  const store = scriptProperties();
  const config = loadConfig(store, false);
  const reader = new SourceCalendarReader(createGateway());
  const summary = inventorySummary(reader.listCalendars(), config.destinationCalendarId, appsScriptSha256Hex);
  // Calendar IDs and names may be personal. Save the report in private Script
  // Properties rather than emitting it to execution logs.
  const report = JSON.stringify({ generatedAt: new Date().toISOString(), calendars: summary });
  store.setProperty(CANDIDATES_PROPERTY, report);
  return report;
}

function performDryRun(): DryRunResult {
  const config = loadConfig(scriptProperties());
  const reader = new SourceCalendarReader(createGateway());
  const inventory = new Map(reader.listCalendars().map((entry) => [entry.id, entry]));
  const now = new Date();
  const minimum = new Date(now.getTime());
  minimum.setUTCDate(minimum.getUTCDate() - config.horizon.pastDays);
  const maximum = new Date(now.getTime());
  maximum.setUTCMonth(maximum.getUTCMonth() + config.horizon.futureMonths);
  const sources: DryRunSourceResult[] = [];

  for (const [calendarId, policy] of Object.entries(config.sources)) {
    if (policy.policy === "IGNORE") continue;
    const entry = inventory.get(calendarId);
    const sourceHash = sourceHashFor(calendarId, appsScriptSha256Hex);
    if (!entry) {
      sources.push({ sourceHash, status: "missing" });
      continue;
    }
    try {
      const occurrences = reader.listOccurrences(calendarId, {
        timeMin: minimum.toISOString(),
        timeMax: maximum.toISOString(),
      });
      sources.push({
        sourceHash,
        status: "readable",
        accessRole: entry.accessRole ?? "none",
        occurrenceCount: occurrences.length,
        recurringCount: occurrences.filter((event) => Boolean(event.recurringEventId)).length,
        allDayCount: occurrences.filter((event) => Boolean(event.start?.date)).length,
        privateCount: occurrences.filter((event) => event.visibility === "private" || event.visibility === "confidential").length,
      });
    } catch (error) {
      sources.push({ sourceHash, status: "error", errorType: error instanceof Error ? error.name : "GoogleApiError" });
    }
  }
  return { generatedAt: new Date().toISOString(), sources };
}

export function phase0DryRun(): string {
  const report = performDryRun();
  const sources = report.sources;
  console.log(JSON.stringify({ event: "calendarshare.phase0", sourceCount: sources.length, sources }));
  return JSON.stringify(report);
}

function performSync(throwOnPartial: boolean): DashboardSyncResult {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1_000)) return { status: "skipped", reason: "another run holds the script lock" };
  const store = scriptProperties();
  let state: ReturnType<typeof loadState> | undefined;
  let runStatePersisted = false;
  try {
    const config = loadConfig(store);
    state = loadState(store);
    const sourceGateway = createGateway();
    const destinationGateway = createGateway();
    const result = reconcile(config, state, {
      reader: new SourceCalendarReader(sourceGateway),
      writer: new DestinationCalendarWriter(destinationGateway, config.destinationCalendarId!),
      sha256Hex: appsScriptSha256Hex,
      now: () => new Date(),
      log: (record) => console.log(JSON.stringify(record)),
    });
    saveState(store, result.state);
    runStatePersisted = true;
    if (throwOnPartial && result.sourceFailures.length) {
      throw new Error(`CalendarShare completed safely with ${result.sourceFailures.length} source failure(s); existing copies were retained where the source was uncertain`);
    }
    return {
      status: result.status,
      counts: result.counts,
      ...(result.sourceFailures.length ? { sourceFailures: result.sourceFailures } : {}),
    };
  } catch (error) {
    if (state && !runStatePersisted) {
      state.lastRun = new Date().toISOString();
      state.lastRunStatus = "failed";
      try {
        saveState(store, state);
      } catch (stateError) {
        console.error(JSON.stringify({ event: "calendarshare.state-save-failed", errorType: stateError instanceof Error ? stateError.name : "StateError" }));
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

export function syncCombinedCalendar(): string {
  return JSON.stringify(performSync(true));
}

export function runDashboardDryRun(): DashboardDryRunResult {
  const report = performDryRun();
  return {
    ...report,
    status: report.sources.some((source) => source.status !== "readable") ? "partial" : "ok",
    sourceCount: report.sources.length,
  } satisfies DashboardDryRunResult;
}

export function runDashboardSync(): DashboardSyncResult {
  return performSync(false);
}

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("CalendarShare")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function destinationCalendarUrl(destinationCalendarId: string): string {
  return `https://calendar.google.com/calendar/u/0/r/settings/calendar/${encodeURIComponent(destinationCalendarId)}`;
}

function buildDashboardState(
  config: CalendarShareConfig,
  state: ReturnType<typeof loadState>,
  inventory: ReturnType<SourceCalendarReader["listCalendars"]>,
): DashboardState {
  const triggerCount = ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === SYNC_HANDLER)
    .length;
  let destinationStatus: DashboardState["destination"]["status"] = "not-configured";
  if (config.destinationCalendarId) {
    try {
      destinationStatus = destinationExists(config.destinationCalendarId) ? "ready" : "unavailable";
    } catch (error) {
      destinationStatus = "unavailable";
      console.warn(JSON.stringify({
        event: "calendarshare.dashboard-destination-check-failed",
        errorType: error instanceof Error ? error.name : "GoogleApiError",
      }));
    }
  }
  return {
    destination: {
      ...(config.destinationCalendarId ? { id: config.destinationCalendarId } : {}),
      ...(config.destinationName ? { name: config.destinationName } : {}),
      status: destinationStatus,
      ...(config.destinationCalendarId ? { calendarUrl: destinationCalendarUrl(config.destinationCalendarId) } : {}),
    },
    trigger: { count: triggerCount, intervalMinutes: 15 },
    horizon: config.horizon,
    calendars: buildDashboardCalendars(config, inventory, {
      sourceHashForId: (calendarId) => sourceHashFor(calendarId, appsScriptSha256Hex),
      sourceHealth: state.sourceHealth,
    }),
    health: {
      ...(state.lastRun ? { lastRun: state.lastRun } : {}),
      ...(state.lastSuccessfulRun ? { lastSuccessfulRun: state.lastSuccessfulRun } : {}),
      ...(state.lastRunStatus ? { lastRunStatus: state.lastRunStatus } : {}),
      ...(state.lastRunCounts ? { lastRunCounts: state.lastRunCounts } : {}),
    },
  };
}

export function getDashboardState(): DashboardState {
  const store = scriptProperties();
  const config = loadConfig(store, false);
  const state = loadState(store);
  const inventory = new SourceCalendarReader(createGateway()).listCalendars();
  return buildDashboardState(config, state, inventory);
}

export function saveDashboardConfig(input: unknown): DashboardState {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10_000)) throw new Error("Another CalendarShare setup, save, or sync execution is active");
  try {
    const store = scriptProperties();
    const existing = loadConfig(store, false);
    const inventory = new SourceCalendarReader(createGateway()).listCalendars();
    const normalized = normalizeDashboardConfig(existing, inventory, input);
    // Build the response before committing. If an API needed for the refresh
    // fails, the browser cannot be told that an unchanged configuration saved.
    const response = buildDashboardState(normalized, loadState(store), inventory);
    const desiredName = normalized.destinationName ?? DEFAULT_CONFIG.destinationName!;
    const renameRequested = Boolean(normalized.destinationCalendarId && existing.destinationName !== desiredName);
    if (renameRequested && response.destination.status !== "ready") {
      throw new Error("The destination calendar must be available before it can be renamed");
    }
    saveConfig(store, normalized);
    if (renameRequested) {
      try {
        renameDestination(normalized.destinationCalendarId!, desiredName);
        response.destination.name = desiredName;
      } catch (error) {
        try {
          saveConfig(store, existing);
        } catch (rollbackError) {
          console.error(JSON.stringify({
            event: "calendarshare.config-rollback-failed",
            errorType: rollbackError instanceof Error ? rollbackError.name : "StateError",
          }));
        }
        throw error;
      }
    }
    return response;
  } finally {
    lock.releaseLock();
  }
}

export function healthCheck(): string {
  const store = scriptProperties();
  const config = loadConfig(store, false);
  const state = loadState(store);
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === SYNC_HANDLER);
  const destinationStatus = config.destinationCalendarId
    ? (destinationExists(config.destinationCalendarId) ? "available" : "missing")
    : "not-configured";
  return JSON.stringify({
    destinationStatus,
    triggerCount: triggers.length,
    configuredSourceCount: Object.values(config.sources).filter((source) => source.policy !== "IGNORE").length,
    lastRun: state.lastRun ?? null,
    lastSuccessfulRun: state.lastSuccessfulRun ?? null,
    lastRunStatus: state.lastRunStatus ?? null,
    sourceHealth: state.sourceHealth,
  });
}
