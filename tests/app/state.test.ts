import { describe, expect, it } from "vitest";
import { STATE_PROPERTY, type PropertyStoreLike } from "../../src/app/config";
import { loadState, saveState, type CalendarShareState } from "../../src/app/state";

function storeWith(value: unknown): PropertyStoreLike & { values: Record<string, string> } {
  const values: Record<string, string> = value === undefined ? {} : { [STATE_PROPERTY]: JSON.stringify(value) };
  return {
    values,
    getProperty: (key) => values[key] ?? null,
    setProperty: (key, next) => { values[key] = next; },
  };
}

describe("CalendarShare state", () => {
  it("round-trips compact last-run counts for the dashboard", () => {
    const store = storeWith(undefined);
    const state: CalendarShareState = {
      schemaVersion: 1,
      destinationInitialized: true,
      sourceHealth: {},
      lastRunCounts: {
        sourcesConfigured: 2,
        sourcesSuccessful: 2,
        desired: 12,
        created: 1,
        updated: 2,
        deleted: 3,
        unchanged: 6,
        unmanagedTargetEvents: 0,
      },
    };
    saveState(store, state);
    expect(loadState(store).lastRunCounts).toEqual(state.lastRunCounts);
  });

  it("keeps older state compatible and drops malformed count telemetry", () => {
    const store = storeWith({
      schemaVersion: 1,
      destinationInitialized: true,
      sourceHealth: {},
      lastRunCounts: { created: -1 },
    });
    expect(loadState(store).lastRunCounts).toBeUndefined();
  });
});
