import { withGoogleRetry, RetryOptions } from './retry';

export interface CalendarListEntry {
  id: string;
  summary?: string;
  timeZone?: string;
  accessRole?: string;
  hidden?: boolean;
  selected?: boolean;
  primary?: boolean;
}

export interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  [key: string]: unknown;
}

export interface EventPage { items?: CalendarEvent[]; nextPageToken?: string; }
export interface CalendarPage { items?: CalendarListEntry[]; nextPageToken?: string; }

export interface CalendarGateway {
  listCalendars(pageToken?: string, showHidden?: boolean): CalendarPage;
  listEvents(calendarId: string, params: Record<string, unknown>): EventPage;
  getEvent(calendarId: string, eventId: string): CalendarEvent;
  insertEvent(calendarId: string, resource: CalendarEvent, params?: Record<string, unknown>): CalendarEvent;
  updateEvent(calendarId: string, eventId: string, resource: CalendarEvent, params?: Record<string, unknown>): CalendarEvent;
  deleteEvent(calendarId: string, eventId: string, params?: Record<string, unknown>): void;
}

/** Compile-time capability boundary for code that can only inspect sources. */
export type SourceCalendarGateway = Pick<CalendarGateway, 'listCalendars' | 'listEvents'>;

/** Capability boundary used only by the destination-bound writer. */
export type DestinationCalendarGateway = Pick<
  CalendarGateway,
  'listEvents' | 'getEvent' | 'insertEvent' | 'updateEvent' | 'deleteEvent'
>;

/** Thin wrapper around the Apps Script Advanced Calendar service. */
export class AppsScriptCalendarGateway implements CalendarGateway {
  constructor(private readonly api: any = (globalThis as any).Calendar, private readonly retry: RetryOptions = {}) {}

  listCalendars(pageToken?: string, showHidden = true): CalendarPage {
    return withGoogleRetry(() => this.api.CalendarList.list({ showHidden, pageToken }), this.retry);
  }
  listEvents(calendarId: string, params: Record<string, unknown>): EventPage {
    return withGoogleRetry(() => this.api.Events.list(calendarId, params), this.retry);
  }
  getEvent(calendarId: string, eventId: string): CalendarEvent {
    return withGoogleRetry(() => this.api.Events.get(calendarId, eventId), this.retry);
  }
  insertEvent(calendarId: string, resource: CalendarEvent, params: Record<string, unknown> = {}): CalendarEvent {
    return withGoogleRetry(() => this.api.Events.insert(resource, calendarId, { ...params, sendUpdates: 'none' }), this.retry);
  }
  updateEvent(calendarId: string, eventId: string, resource: CalendarEvent, params: Record<string, unknown> = {}): CalendarEvent {
    return withGoogleRetry(() => this.api.Events.update(resource, calendarId, eventId, { ...params, sendUpdates: 'none' }), this.retry);
  }
  deleteEvent(calendarId: string, eventId: string, params: Record<string, unknown> = {}): void {
    withGoogleRetry(() => this.api.Events.remove(calendarId, eventId, { ...params, sendUpdates: 'none' }), this.retry);
  }
}
