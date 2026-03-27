import { jest } from '@jest/globals';

const mockDeals = [
  { id: 1, title: 'Acme Deal', contact_name: 'João Silva', stage: 'proposal', value: '25000.00', next_action_date: null, company: 'Acme', email: 'joao@acme.com' },
  { id: 2, title: 'Beta Corp', contact_name: 'Ana Lima', stage: 'lead', value: null, next_action_date: null, company: 'Beta', email: 'ana@beta.com' }
];
const mockActivities = [
  { id: 1, deal_id: 1, type: 'call', summary: 'Good call', created_at: new Date() }
];

jest.unstable_mockModule('../db/index.js', () => ({
  deals: {
    findAll: jest.fn().mockResolvedValue(mockDeals),
    findById: jest.fn().mockImplementation(id => Promise.resolve(mockDeals.find(d => d.id === id) || null))
  },
  activities: {
    findByDeal: jest.fn().mockResolvedValue(mockActivities)
  }
}));

const { get_pipeline, get_deal, get_deal_context } = await import('../tools/pipeline.js');

test('get_pipeline groups deals by stage', async () => {
  const result = await get_pipeline();
  expect(result.proposal).toHaveLength(1);
  expect(result.proposal[0].title).toBe('Acme Deal');
  expect(result.lead).toHaveLength(1);
  expect(result.discovery).toHaveLength(0);
});

test('get_deal finds by title fuzzy match', async () => {
  const result = await get_deal({ deal_name: 'acme' });
  expect(result.deal.title).toBe('Acme Deal');
  expect(result.activities).toHaveLength(1);
});

test('get_deal finds by contact name fuzzy match', async () => {
  const result = await get_deal({ deal_name: 'ana' });
  expect(result.deal.title).toBe('Beta Corp');
});

test('get_deal throws when no match', async () => {
  await expect(get_deal({ deal_name: 'nonexistent' })).rejects.toThrow('No deal found');
});

test('get_deal_context returns deal and recent activities', async () => {
  const result = await get_deal_context({ deal_id: 1 });
  expect(result.deal.id).toBe(1);
  expect(result.activities).toHaveLength(1);
});
