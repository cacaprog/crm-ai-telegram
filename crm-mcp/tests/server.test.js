import { jest } from '@jest/globals';

// Mock all tool modules so we don't hit the DB
jest.unstable_mockModule('../tools/pipeline.js', () => ({
  get_pipeline: jest.fn().mockResolvedValue({ lead: [], proposal: [] }),
  get_deal: jest.fn(),
  get_deal_context: jest.fn()
}));
jest.unstable_mockModule('../tools/deals.js', () => ({
  create_deal: jest.fn(),
  update_deal: jest.fn(),
  move_stage: jest.fn(),
  close_deal: jest.fn(),
  snooze_deal: jest.fn(),
  update_contact: jest.fn()
}));
jest.unstable_mockModule('../tools/activity.js', () => ({
  log_activity: jest.fn()
}));
jest.unstable_mockModule('../tools/email.js', () => ({
  send_email: jest.fn()
}));
jest.unstable_mockModule('../tools/calendar.js', () => ({
  get_today_briefing: jest.fn()
}));
jest.unstable_mockModule('../tools/report.js', () => ({
  get_weekly_report: jest.fn(),
  get_report_history: jest.fn()
}));

const { handlers, TOOLS } = await import('../index.js');

test('TOOLS lists all 13 tools', () => {
  const names = TOOLS.map(t => t.name);
  expect(names).toContain('get_pipeline');
  expect(names).toContain('get_deal');
  expect(names).toContain('get_deal_context');
  expect(names).toContain('create_deal');
  expect(names).toContain('update_deal');
  expect(names).toContain('move_stage');
  expect(names).toContain('close_deal');
  expect(names).toContain('snooze_deal');
  expect(names).toContain('update_contact');
  expect(names).toContain('log_activity');
  expect(names).toContain('send_email');
  expect(names).toContain('get_today_briefing');
  expect(names).toContain('get_weekly_report');
  expect(names).toHaveLength(13);
});

test('handlers dispatch to correct tool function', async () => {
  const result = await handlers.get_pipeline({});
  expect(result).toHaveProperty('lead');
});

test('unknown tool throws', async () => {
  await expect(handlers.unknown_tool({})).rejects.toThrow('Unknown tool');
});
