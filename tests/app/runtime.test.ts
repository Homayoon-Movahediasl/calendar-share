import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_PROPERTY, STATE_PROPERTY } from "../../src/app/config";
import { initializeDashboard, saveDashboardConfig } from "../../src/app/runtime";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard runtime", () => {
  it("initializes once and keeps exactly one sync trigger on repeated calls", () => {
    const values: Record<string, string> = {};
    const propertyStore = {
      getProperty: vi.fn((key: string) => values[key] ?? null),
      setProperty: vi.fn((key: string, value: string) => { values[key] = value; }),
    };
    const destination = { id: "combined", summary: "Team availability", accessRole: "owner" };
    const insert = vi.fn(() => destination);
    const patch = vi.fn(() => destination);
    const create = vi.fn();
    const trigger = { getHandlerFunction: () => "syncCombinedCalendar" };
    const triggers: typeof trigger[] = [];
    create.mockImplementation(() => { triggers.splice(0, triggers.length, trigger); return trigger; });
    vi.stubGlobal("PropertiesService", { getScriptProperties: () => propertyStore });
    vi.stubGlobal("LockService", {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: vi.fn() }),
    });
    vi.stubGlobal("ScriptApp", {
      getProjectTriggers: () => triggers,
      deleteTrigger: vi.fn(),
      newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create }) }) }),
    });
    vi.stubGlobal("Session", { getScriptTimeZone: () => "America/New_York" });
    vi.stubGlobal("Utilities", {
      sleep: vi.fn(),
      Charset: { UTF_8: "UTF_8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest: () => [1, 2, 3],
    });
    vi.stubGlobal("Calendar", {
      CalendarList: { list: () => ({ items: [destination] }) },
      Calendars: { insert, get: () => destination, patch },
    });

    const first = initializeDashboard({ destinationName: "Team availability" });
    const second = initializeDashboard({ destinationName: "Team availability" });

    expect(first.destination).toMatchObject({ id: "combined", name: "Team availability", status: "ready" });
    expect(second.destination).toMatchObject({ id: "combined", name: "Team availability", status: "ready" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
    expect(triggers).toHaveLength(1);
  });

  it("renames the actual generated calendar and persists the new name", () => {
    const values: Record<string, string> = {
      [CONFIG_PROPERTY]: JSON.stringify({
        schemaVersion: 1,
        destinationCalendarId: "combined",
        destinationName: "Combined",
        horizon: { pastDays: 60, futureMonths: 18 },
        sources: {},
      }),
      [STATE_PROPERTY]: JSON.stringify({ schemaVersion: 1, destinationInitialized: true, sourceHealth: {} }),
    };
    const propertyStore = {
      getProperty: vi.fn((key: string) => values[key] ?? null),
      setProperty: vi.fn((key: string, value: string) => { values[key] = value; }),
    };
    const patch = vi.fn(() => ({ id: "combined", summary: "Shared availability" }));
    vi.stubGlobal("PropertiesService", { getScriptProperties: () => propertyStore });
    vi.stubGlobal("LockService", {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: vi.fn() }),
    });
    vi.stubGlobal("ScriptApp", { getProjectTriggers: () => [] });
    vi.stubGlobal("Utilities", { sleep: vi.fn() });
    vi.stubGlobal("Calendar", {
      CalendarList: { list: () => ({ items: [{ id: "combined", summary: "Combined", accessRole: "owner" }] }) },
      Calendars: { get: () => ({ id: "combined", summary: "Combined" }), patch },
    });

    const result = saveDashboardConfig({
      destinationName: "Shared availability",
      horizon: { pastDays: 30, futureMonths: 12 },
      sources: {},
    });

    expect(patch).toHaveBeenCalledWith({ summary: "Shared availability" }, "combined");
    expect(JSON.parse(values[CONFIG_PROPERTY]).destinationName).toBe("Shared availability");
    expect(result.destination.name).toBe("Shared availability");
  });
});
