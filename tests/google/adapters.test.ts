import { describe, expect, it, vi } from 'vitest';
import { DestinationCalendarWriter } from '../../src/google/destinationWriter';
import { CalendarGateway } from '../../src/google/calendarGateway';
import { SourceCalendarReader } from '../../src/google/sourceReader';
import { isRetryableGoogleError, withGoogleRetry } from '../../src/google/retry';

const event = (id: string) => ({ id, summary: id });

function gateway(overrides: Partial<CalendarGateway> = {}): CalendarGateway {
  return {
    listCalendars: vi.fn(() => ({ items: [] })),
    listEvents: vi.fn(() => ({ items: [] })),
    getEvent: vi.fn(), insertEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(),
    ...overrides,
  };
}

describe('SourceCalendarReader', () => {
  it('paginates calendar and expanded event listings', () => {
    const api = gateway({
      listCalendars: vi.fn((token?: string) => token ? { items: [{ id: 'b' }] } : { items: [{ id: 'a' }], nextPageToken: 'next' }),
      listEvents: vi.fn((_id: string, params: Record<string, unknown>) => params.pageToken ? { items: [event('2')] } : { items: [event('1')], nextPageToken: 'next' }),
    });
    const reader = new SourceCalendarReader(api);
    expect(reader.listCalendars().map((x) => x.id)).toEqual(['a', 'b']);
    expect(reader.listOccurrences('source', { timeMin: 'a', timeMax: 'b' }).map((x) => x.id)).toEqual(['1', '2']);
    expect(api.listEvents).toHaveBeenCalledWith('source', expect.objectContaining({ singleEvents: true, showDeleted: false, timeMin: 'a', timeMax: 'b' }));
  });
});

describe('DestinationCalendarWriter', () => {
  it('always lists and mutates the exact configured destination', () => {
    const api = gateway({ listEvents: vi.fn(() => ({ items: [] })), insertEvent: vi.fn(() => event('x')) });
    const writer = new DestinationCalendarWriter(api, 'combined');
    writer.listLiveEvents(); writer.insert(event('x')); writer.update('x', event('x')); writer.delete('x'); writer.get('x');
    expect(api.listEvents).toHaveBeenCalledWith('combined', expect.objectContaining({ singleEvents: false, showDeleted: false }));
    expect(api.insertEvent).toHaveBeenCalledWith('combined', expect.anything(), expect.anything());
    expect(api.updateEvent).toHaveBeenCalledWith('combined', 'x', expect.anything(), expect.anything());
    expect(api.deleteEvent).toHaveBeenCalledWith('combined', 'x', expect.anything());
    expect(api.getEvent).toHaveBeenCalledWith('combined', 'x');
  });

  it('restores a deterministic event when insert encounters a 409', () => {
    const api = gateway({
      insertEvent: vi.fn(() => { throw { details: { code: 409 } }; }),
      updateEvent: vi.fn((_c, id, resource) => ({ ...resource, id })),
    });
    const writer = new DestinationCalendarWriter(api, 'combined');
    expect(writer.insert(event('stable'))).toEqual(event('stable'));
    expect(api.updateEvent).toHaveBeenCalledWith('combined', 'stable', expect.anything(), expect.anything());
  });
});

describe('Google retry policy', () => {
  it('classifies rate limits and server failures but not ordinary 403', () => {
    expect(isRetryableGoogleError({ code: 429 })).toBe(true);
    expect(isRetryableGoogleError({ code: 503 })).toBe(true);
    expect(isRetryableGoogleError({ details: { status: 'RESOURCE_EXHAUSTED' } })).toBe(true);
    expect(isRetryableGoogleError({ code: 403, errors: [{ reason: 'rateLimitExceeded' }] })).toBe(true);
    expect(isRetryableGoogleError({ code: 403 })).toBe(false);
  });

  it('stops after the configured finite number of attempts', () => {
    let calls = 0;
    expect(() => withGoogleRetry(() => { calls += 1; throw { code: 500 }; }, { maxAttempts: 3, sleep: () => undefined })).toThrow();
    expect(calls).toBe(3);
  });
});
