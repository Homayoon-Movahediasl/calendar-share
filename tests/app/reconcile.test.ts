import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarListEntry } from "../../src/google/calendarGateway";
import type { CalendarShareConfig } from "../../src/app/config";
import { reconcile } from "../../src/app/reconcile";
import type { CalendarShareState } from "../../src/app/state";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fixedNow = () => new Date("2026-09-02T09:00:00.000Z");

function config(sources: CalendarShareConfig["sources"] = { source: { policy: "FULL" } }): CalendarShareConfig {
  return {
    schemaVersion: 1,
    destinationCalendarId: "combined",
    destinationName: "Combined",
    horizon: { pastDays: 60, futureMonths: 18 },
    sources,
  };
}

function state(): CalendarShareState {
  return { schemaVersion: 1, destinationInitialized: true, sourceHealth: {} };
}

function calendars(includeSource = true): CalendarListEntry[] {
  return [
    { id: "combined", summary: "Combined", accessRole: "owner" },
    ...(includeSource ? [{ id: "source", summary: "Source", accessRole: "owner" }] : []),
  ];
}

const sourceEvent: CalendarEvent = {
  id: "event-1",
  summary: "Dinner",
  description: "At home",
  location: "Kitchen",
  status: "confirmed",
  transparency: "opaque",
  start: { dateTime: "2026-09-03T18:00:00-04:00", timeZone: "America/New_York" },
  end: { dateTime: "2026-09-03T19:00:00-04:00", timeZone: "America/New_York" },
};

function harness(options: {
  inventory?: CalendarListEntry[];
  occurrences?: CalendarEvent[];
  target?: CalendarEvent[];
  sourceError?: unknown;
} = {}) {
  const inserted: CalendarEvent[] = [];
  const updated: CalendarEvent[] = [];
  const deleted: string[] = [];
  const reader = {
    listCalendars: vi.fn(() => options.inventory ?? calendars()),
    listOccurrences: vi.fn(() => {
      if (options.sourceError) throw options.sourceError;
      return options.occurrences ?? [sourceEvent];
    }),
  };
  const writer = {
    listLiveEvents: vi.fn(() => options.target ?? []),
    insert: vi.fn((event: CalendarEvent) => { inserted.push(event); return event; }),
    update: vi.fn((_id: string, event: CalendarEvent) => { updated.push(event); return event; }),
    delete: vi.fn((id: string) => { deleted.push(id); }),
  };
  return { reader, writer, inserted, updated, deleted };
}

describe("reconcile", () => {
  it("creates once, then performs zero writes for an identical destination", () => {
    const first = harness();
    const firstResult = reconcile(config(), state(), { ...first, sha256Hex: hash, now: fixedNow });
    expect(firstResult.counts.created).toBe(1);
    expect(firstResult.state.lastRunCounts).toEqual(firstResult.counts);
    expect(first.inserted[0]).toMatchObject({ summary: "Dinner", reminders: { useDefault: false } });
    expect(JSON.stringify(first.inserted[0])).not.toContain("attendees");

    const second = harness({ target: first.inserted });
    const secondResult = reconcile(config(), firstResult.state, { ...second, sha256Hex: hash, now: fixedNow });
    expect(secondResult.counts.unchanged).toBe(1);
    expect(second.writer.insert).not.toHaveBeenCalled();
    expect(second.writer.update).not.toHaveBeenCalled();
    expect(second.writer.delete).not.toHaveBeenCalled();
  });

  it("updates a manually edited managed destination event", () => {
    const initial = harness();
    reconcile(config(), state(), { ...initial, sha256Hex: hash, now: fixedNow });
    const edited = { ...initial.inserted[0], summary: "Manual edit" };
    const next = harness({ target: [edited] });
    const result = reconcile(config(), state(), { ...next, sha256Hex: hash, now: fixedNow });
    expect(result.counts.updated).toBe(1);
    expect(next.updated[0].summary).toBe("Dinner");
  });

  it("deletes a managed event only after a complete successful empty source read", () => {
    const initial = harness();
    reconcile(config(), state(), { ...initial, sha256Hex: hash, now: fixedNow });
    const empty = harness({ target: initial.inserted, occurrences: [] });
    const result = reconcile(config(), state(), { ...empty, sha256Hex: hash, now: fixedNow });
    expect(result.counts.deleted).toBe(1);
    expect(empty.deleted).toEqual([initial.inserted[0].id]);
  });

  it("retains existing copies after a temporary source failure", () => {
    const initial = harness();
    reconcile(config(), state(), { ...initial, sha256Hex: hash, now: fixedNow });
    const failed = harness({ target: initial.inserted, sourceError: { code: 503 } });
    const result = reconcile(config(), state(), { ...failed, sha256Hex: hash, now: fixedNow });
    expect(result.status).toBe("partial");
    expect(result.sourceFailures[0].kind).toBe("temporary");
    expect(failed.writer.delete).not.toHaveBeenCalled();
  });

  it("purges after three confirmed missing-source inventories", () => {
    const initial = harness();
    reconcile(config(), state(), { ...initial, sha256Hex: hash, now: fixedNow });
    const health = state();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const missing = harness({ inventory: calendars(false), target: initial.inserted });
      reconcile(config(), health, { ...missing, sha256Hex: hash, now: fixedNow });
      expect(missing.deleted.length).toBe(attempt === 3 ? 1 : 0);
    }
  });

  it("purges managed events immediately when the source is removed from configuration", () => {
    const initial = harness();
    reconcile(config(), state(), { ...initial, sha256Hex: hash, now: fixedNow });
    const removed = harness({ inventory: calendars(false), target: initial.inserted });
    const result = reconcile(config({}), state(), { ...removed, sha256Hex: hash, now: fixedNow });
    expect(result.counts.deleted).toBe(1);
  });

  it("aborts before destination reads or writes if the configured destination is unavailable", () => {
    const broken = harness({ inventory: [{ id: "source", accessRole: "owner" }] });
    expect(() => reconcile(config(), state(), { ...broken, sha256Hex: hash, now: fixedNow })).toThrow(/destination calendar is missing/i);
    expect(broken.writer.listLiveEvents).not.toHaveBeenCalled();
    expect(broken.writer.insert).not.toHaveBeenCalled();
  });
});
