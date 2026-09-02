import { CalendarEvent, CalendarListEntry, SourceCalendarGateway } from './calendarGateway';

export interface SourceReaderOptions { timeMin: string; timeMax: string; }

export class SourceCalendarReader {
  constructor(private readonly gateway: SourceCalendarGateway) {}

  listCalendars(): CalendarListEntry[] {
    const result: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = this.gateway.listCalendars(pageToken, true);
      result.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }

  listOccurrences(calendarId: string, options: SourceReaderOptions): CalendarEvent[] {
    const result: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = this.gateway.listEvents(calendarId, {
        singleEvents: true,
        showDeleted: false,
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        pageToken,
      });
      result.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }
}
