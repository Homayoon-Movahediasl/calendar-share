import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base32Hex, canonicalOccurrenceKey, canonicalPayload, targetEventId } from "../../src/core/identity";
import type { SourceEvent } from "../../src/core/types";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const timed = (dateTime: string) => ({ dateTime, timeZone: "America/New_York" });
const event = (overrides: Partial<SourceEvent> = {}): SourceEvent => ({ id: "evt-1", start: timed("2026-01-01T10:00:00+01:00"), end: timed("2026-01-01T11:00:00+01:00"), ...overrides });

describe("occurrence identity", () => {
  it("uses calendar and event ID for one-off events", () => {
    expect(canonicalOccurrenceKey("cal-a", event())).toBe("event\0cal-a\0evt-1");
    expect(canonicalOccurrenceKey("cal-b", event())).not.toBe(canonicalOccurrenceKey("cal-a", event()));
  });

  it("uses recurring master and original start for occurrences", () => {
    const occurrence = event({ recurringEventId: "series", originalStartTime: { date: "2026-01-05" } });
    expect(canonicalOccurrenceKey("cal-a", occurrence)).toBe("occurrence\0cal-a\0series\0date:2026-01-05");
  });

  it("normalizes timed offsets to the same instant and preserves type marker", () => {
    const a = event({ recurringEventId: "series", originalStartTime: timed("2026-01-05T10:00:00+01:00") });
    const b = event({ recurringEventId: "series", originalStartTime: timed("2026-01-05T09:00:00Z") });
    expect(canonicalOccurrenceKey("cal-a", a)).toBe(canonicalOccurrenceKey("cal-a", b));
    expect(canonicalOccurrenceKey("cal-a", event({ recurringEventId: "series", originalStartTime: { date: "2026-01-05" } }))).toContain("date:");
  });

  it("supports Calendar local date-times when an IANA timezone is explicit", () => {
    const occurrence = event({
      recurringEventId: "series",
      originalStartTime: { dateTime: "2026-03-29T10:00:00", timeZone: "America/New_York" },
    });
    expect(canonicalOccurrenceKey("cal-a", occurrence)).toContain("timed-local:2026-03-29T10:00:00|tz:America/New_York");
  });

  it("generates a stable lowercase base32hex-compatible ID", () => {
    const id = targetEventId("cal-a", event(), hash);
    expect(id).toMatch(/^cs1[0-9a-v]+$/);
    expect(id).toBe(targetEventId("cal-a", event(), hash));
  });

  it("encodes base32hex without padding", () => {
    expect(base32Hex(new Uint8Array([0, 1, 2, 3]))).toBe("000g40o");
  });

  it("sorts object keys for canonical payload comparison", () => {
    expect(canonicalPayload({ summary: "x", start: { date: "2026-01-01" }, end: { date: "2026-01-02" }, reminders: { useDefault: false } }))
      .toBe('{"end":{"date":"2026-01-02"},"reminders":{"useDefault":false},"start":{"date":"2026-01-01"},"summary":"x"}');
  });
});
