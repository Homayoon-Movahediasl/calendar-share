import { CalendarEvent, DestinationCalendarGateway } from './calendarGateway';
import { googleErrorCode } from './retry';

export class DestinationCalendarWriter {
  constructor(private readonly gateway: DestinationCalendarGateway, readonly destinationCalendarId: string) {
    if (!destinationCalendarId) throw new Error('destinationCalendarId is required');
  }

  private assertTarget(calendarId: string): void {
    if (calendarId !== this.destinationCalendarId) throw new Error('Refusing Calendar operation outside destination calendar');
  }
  listLiveEvents(): CalendarEvent[] {
    const result: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = this.gateway.listEvents(this.destinationCalendarId, {
        singleEvents: false, showDeleted: false, pageToken,
      });
      result.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }
  get(eventId: string): CalendarEvent { return this.gateway.getEvent(this.destinationCalendarId, eventId); }
  insert(resource: CalendarEvent, params: Record<string, unknown> = {}): CalendarEvent {
    this.assertTarget(this.destinationCalendarId);
    try {
      return this.gateway.insertEvent(this.destinationCalendarId, resource, params);
    } catch (error) {
      // A deterministic client ID can collide with a cancelled/tombstoned
      // event. Restoring it through update is safe and remains idempotent.
      if (googleErrorCode(error) !== 409 || !resource.id) throw error;
      return this.gateway.updateEvent(this.destinationCalendarId, resource.id, resource, params);
    }
  }
  update(eventId: string, resource: CalendarEvent, params: Record<string, unknown> = {}): CalendarEvent {
    this.assertTarget(this.destinationCalendarId);
    return this.gateway.updateEvent(this.destinationCalendarId, eventId, resource, params);
  }
  delete(eventId: string, params: Record<string, unknown> = {}): void {
    this.assertTarget(this.destinationCalendarId);
    return this.gateway.deleteEvent(this.destinationCalendarId, eventId, params);
  }
}
