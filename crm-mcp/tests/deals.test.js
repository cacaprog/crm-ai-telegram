import { jest } from '@jest/globals';

const mockContact = { id: 10, name: 'Test Contact', company: 'Co', email: 'test@co.com', phone: null };
const mockDeal = { id: 20, title: 'Test Deal', stage: 'lead', contact_id: 10 };

jest.unstable_mockModule('../db/index.js', () => ({
  contacts: {
    create: jest.fn().mockResolvedValue(mockContact),
    update: jest.fn().mockImplementation((id, fields) =>
      Promise.resolve({ ...mockContact, id, ...fields })
    )
  },
  deals: {
    create: jest.fn().mockResolvedValue(mockDeal),
    findById: jest.fn().mockImplementation(id => {
      if (id === 20) return Promise.resolve({ ...mockDeal });
      if (id === 99) return Promise.resolve({ ...mockDeal, id: 99, stage: 'negotiation' });
      return Promise.resolve(null);
    }),
    update: jest.fn().mockImplementation((id, fields) =>
      Promise.resolve({ ...mockDeal, id, ...fields })
    )
  },
  activities: {
    create: jest.fn().mockResolvedValue({ id: 1 })
  }
}));

const { create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact } = await import('../tools/deals.js');

test('create_deal creates contact and deal', async () => {
  const result = await create_deal({ title: 'New Deal', contact_name: 'Alice', company: 'Corp', email: 'alice@corp.com' });
  expect(result.contact.name).toBe('Test Contact');
  expect(result.deal.title).toBe('Test Deal');
});

test('move_stage advances to next stage', async () => {
  const result = await move_stage({ deal_id: 20 });
  expect(result.stage).toBe('discovery');
});

test('move_stage throws when at negotiation (last before closed)', async () => {
  await expect(move_stage({ deal_id: 99 })).rejects.toThrow('Cannot advance from negotiation');
});

test('close_deal sets closed_won stage', async () => {
  const result = await close_deal({ deal_id: 20, outcome: 'won' });
  expect(result.stage).toBe('closed_won');
});

test('close_deal logs reason activity on lost', async () => {
  const { activities } = await import('../db/index.js');
  await close_deal({ deal_id: 20, outcome: 'lost', reason: 'Budget cut' });
  expect(activities.create).toHaveBeenCalledWith(expect.objectContaining({
    dealId: 20,
    type: 'note',
    summary: expect.stringContaining('Budget cut')
  }));
});

test('snooze_deal defaults to 3 days', async () => {
  const before = Date.now();
  const result = await snooze_deal({ deal_id: 20 });
  const snoozeMs = new Date(result.nextActionDate).getTime();
  expect(snoozeMs).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000 - 1000);
});

test('update_contact updates contact fields via deal', async () => {
  const result = await update_contact({ deal_id: 20, email: 'new@co.com', phone: '+351 900 000 000' });
  expect(result.email).toBe('new@co.com');
  expect(result.phone).toBe('+351 900 000 000');
});

test('update_contact throws when deal not found', async () => {
  await expect(update_contact({ deal_id: 999 })).rejects.toThrow('Deal not found: 999');
});
