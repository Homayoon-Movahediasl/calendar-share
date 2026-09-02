import { describe, expect, it } from "vitest";
import { projectEvent } from "../../src/core/privacy";
import type { SourceEvent } from "../../src/core/types";

const source = (extra: Partial<SourceEvent> = {}): SourceEvent => ({
  id: "e1",
  summary: "Planning",
  description: "https://private.example/meeting",
  location: "Room 42",
  start: { dateTime: "2026-01-01T10:00:00Z", timeZone: "UTC", foo: "must-not-leak" } as SourceEvent["start"],
  end: { dateTime: "2026-01-01T11:00:00Z", timeZone: "UTC" },
  status: "confirmed",
  transparency: "opaque",
  reminders: { useDefault: false, overrides: [{ method: "email", minutes: 10 }] },
  attendees: [{ email: "secret@example.com" }],
  conferenceData: { entryPoints: [{ uri: "https://meet.example" }] },
  ...extra,
} as unknown as SourceEvent);

describe("privacy projection", () => {
  it("returns null for IGNORE", () => expect(projectEvent(source(), { policy: "IGNORE" })).toBeNull());

  it("copies only the FULL whitelist and bookkeeping properties", () => {
    const result = projectEvent(source(), { policy: "FULL" }, { csManaged: "v1" });
    expect(result).toEqual({
      summary: "Planning",
      start: { dateTime: "2026-01-01T10:00:00Z", timeZone: "UTC" },
      end: { dateTime: "2026-01-01T11:00:00Z", timeZone: "UTC" },
      description: "https://private.example/meeting",
      location: "Room 42",
      status: "confirmed",
      transparency: "opaque",
      reminders: { useDefault: false },
      extendedProperties: { private: { csManaged: "v1" } },
    });
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
    expect(JSON.stringify(result)).not.toContain("conferenceData");
  });

  it("makes BUSY_ONLY generic and strips metadata", () => {
    expect(projectEvent(source(), { policy: "BUSY_ONLY", busyLabel: "Unavailable" })).toEqual({
      summary: "Unavailable",
      start: { dateTime: "2026-01-01T10:00:00Z", timeZone: "UTC" },
      end: { dateTime: "2026-01-01T11:00:00Z", timeZone: "UTC" },
      status: "confirmed",
      transparency: "opaque",
      reminders: { useDefault: false },
    });
  });

  it.each([
    { visibility: "private" },
    { visibility: "confidential" },
    { redacted: true },
    { sourceAccessRole: "freeBusyReader" as const },
  ])("forces $visibility/$redacted/$sourceAccessRole events to busy", (extra) => {
    expect(projectEvent(source(extra), { policy: "FULL" })?.summary).toBe("Busy");
    expect(projectEvent(source(extra), { policy: "FULL" })?.description).toBeUndefined();
  });

  it("allows explicitly configured private details", () => {
    expect(projectEvent(source({ visibility: "private" }), { policy: "FULL", allowPrivateDetails: true })?.summary).toBe("Planning");
  });

  it("supports field-level suppression", () => {
    const result = projectEvent(source(), { policy: "FULL", copyDescription: false, copyLocation: false });
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("location");
  });
});
