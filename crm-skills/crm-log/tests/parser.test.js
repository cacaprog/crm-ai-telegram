const { parseActivityLog } = require('../src/parser');

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          type: 'call',
          summary: 'Discovery call went well. Client interested.',
          next_action: 'Send proposal',
          next_action_date: '2026-03-15'
        })}]
      })
    }
  }))
}));

test('parses natural language into structured activity', async () => {
  const result = await parseActivityLog(
    'Had a great call with John today, discovery went well, he wants a proposal by March 15',
    { dealTitle: 'Acme Deal', contactName: 'John Smith' }
  );
  expect(result.type).toBe('call');
  expect(result.summary).toBeDefined();
  expect(result.next_action).toBe('Send proposal');
  expect(result.next_action_date).toBe('2026-03-15');
});
