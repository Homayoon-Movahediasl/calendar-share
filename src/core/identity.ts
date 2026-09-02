import type { EventDateTime, ProjectedEvent, SourceEvent } from "./types";

export type Sha256Hex = (value: string) => string;

function canonicalDateTime(value: EventDateTime): string {
  if (value.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error(`Invalid all-day date: ${value.date}`);
    return `date:${value.date}`;
  }
  if (value.dateTime === undefined) throw new Error("Event date-time must contain date or dateTime");
  // Offset-bearing timestamps are normalized to an instant so equivalent
  // RFC3339 spellings do not create distinct occurrence IDs.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime)) {
    const millis = Date.parse(value.dateTime);
    if (!Number.isFinite(millis)) throw new Error(`Invalid RFC3339 date-time: ${value.dateTime}`);
    return `timed:${new Date(millis).toISOString()}`;
  }
  // Calendar also permits a local RFC3339 date-time when an explicit IANA
  // timezone accompanies it. Preserve both strings rather than applying the
  // Apps Script runtime's locale-dependent parser.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value.dateTime) || !value.timeZone) {
    throw new Error(`Invalid RFC3339 date-time: ${value.dateTime}`);
  }
  return `timed-local:${value.dateTime}|tz:${value.timeZone}`;
}

/** Stable identity for one occurrence, including an exception in a recurring series. */
export function canonicalOccurrenceKey(sourceCalendarId: string, event: SourceEvent): string {
  if (!sourceCalendarId || !event.id) throw new Error("Source calendar ID and event ID are required");
  if (event.recurringEventId) {
    if (!event.originalStartTime) throw new Error("Recurring occurrence lacks originalStartTime");
    return ["occurrence", sourceCalendarId, event.recurringEventId, canonicalDateTime(event.originalStartTime)].join("\0");
  }
  return ["event", sourceCalendarId, event.id].join("\0");
}

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/** Encodes bytes using RFC 4648 base32hex without padding, in lowercase. */
export function base32Hex(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32HEX[(buffer >>> bits) & 31];
    }
  }
  if (bits) output += BASE32HEX[(buffer << (5 - bits)) & 31];
  return output;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2) throw new Error("SHA-256 result must be an even-length hexadecimal string");
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < result.length; i++) result[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return result;
}

export function targetEventId(sourceCalendarId: string, event: SourceEvent, sha256Hex: Sha256Hex): string {
  return `cs1${base32Hex(hexToBytes(sha256Hex(canonicalOccurrenceKey(sourceCalendarId, event))))}`;
}

/** Stable, sorted JSON representation used to compare and hash projected payloads. */
export function canonicalPayload(event: ProjectedEvent): string {
  return stableStringify(event);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
