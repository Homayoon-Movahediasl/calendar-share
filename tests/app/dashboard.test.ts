import { describe, expect, it } from "vitest";
import { buildDashboardCalendars, normalizeDashboardConfig } from "../../src/app/dashboard";
import type { CalendarShareConfig } from "../../src/app/config";

function config(sources: CalendarShareConfig["sources"] = {}): CalendarShareConfig {
  return {
    schemaVersion: 1,
    destinationCalendarId: "combined",
    destinationName: "Combined",
    horizon: { pastDays: 60, futureMonths: 18 },
    sources,
  };
}

const inventory = [
  { id: "combined", summary: "Combined", accessRole: "owner", primary: false },
  { id: "personal", summary: "Personal", accessRole: "owner", primary: true, selected: true },
  { id: "freebusy", summary: "Restricted", accessRole: "freeBusyReader" },
];

describe("dashboard calendar inventory", () => {
  it("unions live entries with configured-but-missing sources", () => {
    const rows = buildDashboardCalendars(config({
      personal: { policy: "FULL" },
      missing: { policy: "BUSY_ONLY", busyLabel: "Private" },
    }), inventory, {
      sourceHashForId: (id) => `hash-${id}`,
      sourceHealth: { "hash-missing": { consecutiveUnavailable: 2, lastError: "2026-09-01T00:00:00Z" } },
    });

    expect(rows.map((row) => row.id)).toEqual(["combined", "personal", "freebusy", "missing"]);
    expect(rows[0]).toMatchObject({ isDestination: true, policy: "IGNORE" });
    expect(rows[1]).toMatchObject({ primary: true, selected: true, policy: "FULL", copyDescription: true, copyLocation: true });
    expect(rows[3]).toMatchObject({ missing: true, available: false, policy: "BUSY_ONLY", sourceHash: "hash-missing" });
    expect(rows[3].sourceHealth?.consecutiveUnavailable).toBe(2);
  });

  it("shows free/busy access as an effective BUSY_ONLY policy", () => {
    const row = buildDashboardCalendars(config({ freebusy: { policy: "FULL" } }), inventory)
      .find((candidate) => candidate.id === "freebusy");
    expect(row).toMatchObject({ freeBusyOnly: true, policy: "BUSY_ONLY" });
  });
});

describe("dashboard configuration normalization", () => {
  it("normalizes an owner-selected destination name", () => {
    const result = normalizeDashboardConfig(config(), inventory, {
      destinationName: "  Shared availability  ",
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: {},
    });
    expect(result.destinationName).toBe("Shared availability");
    expect(() => normalizeDashboardConfig(config(), inventory, {
      destinationName: "   ",
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: {},
    })).toThrow(/cannot be empty/i);
  });

  it("preserves destination identity server-side and ignores client attempts to replace it", () => {
    const result = normalizeDashboardConfig(config(), inventory, {
      destinationCalendarId: "attacker-target",
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: { personal: { policy: "BUSY_ONLY" } },
    });
    expect(result.destinationCalendarId).toBe("combined");
    expect(result.destinationName).toBe("Combined");
  });

  it("rejects destination and unknown source IDs", () => {
    expect(() => normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: { combined: { policy: "IGNORE" } },
    })).toThrow(/destination calendar/i);
    expect(() => normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: { unknown: { policy: "IGNORE" } },
    })).toThrow(/unknown source calendar/i);
  });

  it("forces freeBusyReader to BUSY_ONLY and strips detail flags", () => {
    const result = normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: {
        freebusy: { policy: "FULL", copyDescription: true, copyLocation: true, allowPrivateDetails: true },
      },
    });
    expect(result.sources.freebusy).toEqual({
      policy: "BUSY_ONLY",
      copyDescription: false,
      copyLocation: false,
      allowPrivateDetails: false,
    });
  });

  it("still permits explicitly ignoring a free/busy-only calendar", () => {
    const result = normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: { freebusy: { policy: "IGNORE" } },
    });
    expect(result.sources.freebusy).toBeUndefined();
  });

  it("preserves an omitted configured-missing source until explicitly ignored", () => {
    const existing = config({ missing: { policy: "FULL", copyDescription: false } });
    const preserved = normalizeDashboardConfig(existing, inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: { personal: { policy: "IGNORE" } },
    });
    expect(preserved.sources.missing).toEqual({ policy: "FULL", copyDescription: false });

    const ignored = normalizeDashboardConfig(existing, inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: { missing: { policy: "IGNORE" } },
    });
    expect(ignored.sources.missing).toBeUndefined();
  });

  it("preserves a configured policy when a live entry has no readable role", () => {
    const existing = config({ personal: { policy: "FULL", copyDescription: false } });
    const unavailableInventory = inventory.map((entry) => entry.id === "personal" ? { ...entry, accessRole: "none" } : entry);
    const result = normalizeDashboardConfig(existing, unavailableInventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: {},
    });
    expect(result.sources.personal).toEqual({ policy: "FULL", copyDescription: false });
    expect(buildDashboardCalendars(existing, unavailableInventory).find((row) => row.id === "personal"))
      .toMatchObject({ available: false, policy: "FULL" });
  });

  it("does not persist ignored live calendars", () => {
    const result = normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: {},
    });
    expect(result.sources).toEqual({});
  });

  it("rejects duplicate IDs in row-shaped input", () => {
    expect(() => normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: [
        { id: "personal", policy: "FULL" },
        { id: "personal", policy: "BUSY_ONLY" },
      ],
    })).toThrow(/duplicate source calendar ID/i);
  });

  it("validates horizon bounds through the canonical config validator", () => {
    expect(() => normalizeDashboardConfig(config(), inventory, {
      horizon: { pastDays: 999, futureMonths: 12 },
      sources: {},
    })).toThrow(/pastDays/);
  });
});
