import type { ProjectionPolicy, ProjectedEvent, SourceEvent } from "./types";

function allowedDateTime(value: SourceEvent["start"]): SourceEvent["start"] {
  // Construct a fresh object so unknown Calendar API fields cannot leak into
  // the destination resource.
  const result: SourceEvent["start"] = {};
  if (value.date !== undefined) result.date = value.date;
  if (value.dateTime !== undefined) result.dateTime = value.dateTime;
  if (value.timeZone !== undefined) result.timeZone = value.timeZone;
  return result;
}

function isForcedBusy(event: SourceEvent, policy: ProjectionPolicy): boolean {
  return event.redacted === true || event.sourceAccessRole === "freeBusyReader" ||
    ((event.visibility === "private" || event.visibility === "confidential") && policy.allowPrivateDetails !== true);
}

/** Converts a source event to the deliberately small, privacy-filtered destination shape. */
export function projectEvent(event: SourceEvent, policy: ProjectionPolicy, managedProperties?: Record<string, string>): ProjectedEvent | null {
  if (policy.policy === "IGNORE") return null;
  const busy = policy.policy === "BUSY_ONLY" || isForcedBusy(event, policy);
  const result: ProjectedEvent = {
    summary: busy ? (policy.busyLabel ?? "Busy") : (event.summary ?? "(untitled)"),
    start: allowedDateTime(event.start),
    end: allowedDateTime(event.end),
    status: event.status === "tentative" ? "tentative" : "confirmed",
    transparency: event.transparency === "transparent" ? "transparent" : "opaque",
    // Never clone source reminders. Generated copies should not notify the
    // owner a second time; viewers can configure calendar-level notifications.
    reminders: { useDefault: false },
  };
  if (!busy) {
    if (policy.copyLocation !== false && event.location !== undefined) result.location = event.location;
    if (policy.copyDescription !== false && event.description !== undefined) result.description = event.description;
  }
  if (managedProperties && Object.keys(managedProperties).length) result.extendedProperties = { private: { ...managedProperties } };
  return result;
}
