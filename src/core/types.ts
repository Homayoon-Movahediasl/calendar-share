/** The subset of Calendar API event data that the projection is allowed to use. */
export interface EventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export type SourceAccessRole = "none" | "freeBusyReader" | "reader" | "writerWithoutPrivateAccess" | "writer" | "owner";
export type PrivacyPolicy = "FULL" | "BUSY_ONLY" | "IGNORE";

export interface SourceEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  status?: string;
  transparency?: string;
  visibility?: string;
  /** True when the API/adapter knows details have already been redacted. */
  redacted?: boolean;
  /** Effective role on the source calendar. */
  sourceAccessRole?: SourceAccessRole;
  recurringEventId?: string;
  originalStartTime?: EventDateTime;
  reminders?: { useDefault?: boolean; overrides?: Array<{ method?: string; minutes?: number }> };
}

export interface ProjectionPolicy {
  policy: PrivacyPolicy;
  allowPrivateDetails?: boolean;
  copyDescription?: boolean;
  copyLocation?: boolean;
  busyLabel?: string;
}

export interface ProjectedEvent {
  summary: string;
  start: EventDateTime;
  end: EventDateTime;
  location?: string;
  description?: string;
  status?: string;
  transparency?: string;
  reminders: { useDefault: boolean; overrides?: Array<{ method?: string; minutes?: number }> };
  /** Reserved for CalendarShare bookkeeping; source extended properties are never copied. */
  extendedProperties?: { private?: Record<string, string> };
}
