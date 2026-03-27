import { jest } from '@jest/globals';

const mockDeal = {
  id: 1,
  title: 'Acme Deal',
  contact_name: 'João Silva',
  email: 'joao@acme.com',
  stage: 'proposal',
  value: '25000.00'
};

const mockActivity = { id: 1, type: 'call', summary: 'Good intro call', created_at: '2026-03-20T09:00:00Z' };

jest.unstable_mockModule('../tools/google-auth.js', () => ({
  getAuthorizedClient: jest.fn().mockResolvedValue({})
}));

jest.unstable_mockModule('googleapis', () => ({
  google: {
    calendar: jest.fn().mockReturnValue({
      events: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                summary: 'Call with Acme',
                start: { dateTime: '2026-03-27T10:00:00Z' },
                end: { dateTime: '2026-03-27T11:00:00Z' },
                attendees: [{ email: 'joao@acme.com' }, { email: 'me@myco.com' }]
              },
              {
                summary: 'Unrelated meeting',
                start: { dateTime: '2026-03-27T14:00:00Z' },
                end: { dateTime: '2026-03-27T15:00:00Z' },
                attendees: []
              }
            ]
          }
        })
      }
    })
  }
}));

jest.unstable_mockModule('../db/index.js', () => ({
  deals: {
    findAll: jest.fn().mockResolvedValue([mockDeal]),
    findById: jest.fn().mockResolvedValue(mockDeal)
  },
  activities: {
    findByDeal: jest.fn().mockResolvedValue([mockActivity])
  }
}));

const { get_today_briefing } = await import('../tools/calendar.js');

test('returns today date and events array', async () => {
  const result = await get_today_briefing();
  expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Array.isArray(result.events)).toBe(true);
  expect(result.events).toHaveLength(2);
});

test('matches event to deal by attendee email', async () => {
  const result = await get_today_briefing();
  const matched = result.events.find(e => e.title === 'Call with Acme');
  expect(matched.deal).not.toBeNull();
  expect(matched.deal.id).toBe(1);
  expect(matched.activities).toHaveLength(1);
  expect(matched.activities[0].summary).toBe('Good intro call');
});

test('returns null deal for unmatched event', async () => {
  const result = await get_today_briefing();
  const unmatched = result.events.find(e => e.title === 'Unrelated meeting');
  expect(unmatched.deal).toBeNull();
  expect(unmatched.activities).toHaveLength(0);
});

test('returns attendee email list', async () => {
  const result = await get_today_briefing();
  const matched = result.events.find(e => e.title === 'Call with Acme');
  expect(matched.attendees).toContain('joao@acme.com');
});
