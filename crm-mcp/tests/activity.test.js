import { jest } from '@jest/globals';

const mockActivity = { id: 5, deal_id: 20, type: 'call', summary: 'Good call' };

jest.unstable_mockModule('../db/index.js', () => ({
  activities: {
    create: jest.fn().mockResolvedValue(mockActivity)
  },
  deals: {
    update: jest.fn().mockResolvedValue({ id: 20 })
  }
}));

const { log_activity } = await import('../tools/activity.js');

test('log_activity writes activity to db', async () => {
  const result = await log_activity({ deal_id: 20, type: 'call', summary: 'Good call' });
  expect(result.id).toBe(5);
  expect(result.type).toBe('call');
});

test('log_activity updates deal next_action when provided', async () => {
  const { deals } = await import('../db/index.js');
  await log_activity({
    deal_id: 20,
    type: 'meeting',
    summary: 'Scoping meeting',
    next_action: 'Send proposal',
    next_action_date: '2026-04-15'
  });
  expect(deals.update).toHaveBeenCalledWith(20, expect.objectContaining({
    nextAction: 'Send proposal',
    nextActionDate: expect.any(Date)
  }));
});

test('log_activity does not update deal when no next_action', async () => {
  const { deals } = await import('../db/index.js');
  deals.update.mockClear();
  await log_activity({ deal_id: 20, type: 'note', summary: 'Quick note' });
  expect(deals.update).not.toHaveBeenCalled();
});
