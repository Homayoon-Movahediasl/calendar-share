import { describe, expect, it } from "vitest";
import { CONFIG_PROPERTY, loadConfig, saveConfig, validateConfig } from "../../src/app/config";

describe("CalendarShare configuration", () => {
  it("rejects the destination when it is configured as a source", () => {
    expect(() => validateConfig({
      schemaVersion: 1,
      destinationCalendarId: "combined",
      horizon: { pastDays: 60, futureMonths: 18 },
      sources: { combined: { policy: "FULL" } },
    })).toThrow(/destination calendar cannot be configured as a source/i);
  });

  it("defaults safely to an empty allowlist before setup", () => {
    const store = { getProperty: () => null, setProperty: () => undefined };
    const first = loadConfig(store, false);
    first.sources.unsafe = { policy: "FULL" };
    const second = loadConfig(store, false);
    expect(second.sources).toEqual({});
  });

  it("requires a destination for live synchronization", () => {
    const store = {
      getProperty: (key: string) => key === CONFIG_PROPERTY
        ? JSON.stringify({ schemaVersion: 1, horizon: { pastDays: 60, futureMonths: 18 }, sources: {} })
        : null,
      setProperty: () => undefined,
    };
    expect(() => loadConfig(store)).toThrow(/destinationCalendarId is required/i);
  });

  it("rejects out-of-range horizons and unknown policies", () => {
    expect(() => validateConfig({
      schemaVersion: 1,
      destinationCalendarId: "combined",
      horizon: { pastDays: 500, futureMonths: 18 },
      sources: {},
    })).toThrow(/pastDays/);
    expect(() => validateConfig({
      schemaVersion: 1,
      destinationCalendarId: "combined",
      horizon: { pastDays: 60, futureMonths: 18 },
      sources: { source: { policy: "EVERYTHING" } },
    })).toThrow(/FULL, BUSY_ONLY, or IGNORE/);
  });

  it("fails clearly before exceeding the Apps Script property value limit", () => {
    const store = { getProperty: () => null, setProperty: () => undefined };
    expect(() => saveConfig(store, {
      schemaVersion: 1,
      destinationCalendarId: "combined",
      horizon: { pastDays: 60, futureMonths: 18 },
      sources: { source: { policy: "BUSY_ONLY", busyLabel: "ø".repeat(5_000) } },
    })).toThrow(/too large for one Apps Script property/i);
  });
});
