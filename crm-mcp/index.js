import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { get_pipeline, get_deal, get_deal_context } from './tools/pipeline.js';
import { create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact } from './tools/deals.js';
import { log_activity } from './tools/activity.js';
import { send_email } from './tools/email.js';
import { get_today_briefing } from './tools/calendar.js';
import { get_weekly_report, get_report_history } from './tools/report.js';

export const TOOLS = [
  {
    name: 'get_pipeline',
    description: 'Get all active deals grouped by stage',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_deal',
    description: 'Get deal details and activity history. Pass the deal title or contact name.',
    inputSchema: {
      type: 'object',
      properties: { deal_name: { type: 'string' } },
      required: ['deal_name']
    }
  },
  {
    name: 'get_deal_context',
    description: 'Get deal + contact info + recent activities. Call this before drafting an email.',
    inputSchema: {
      type: 'object',
      properties: { deal_id: { type: 'integer' } },
      required: ['deal_id']
    }
  },
  {
    name: 'create_deal',
    description: 'Create a new deal and contact',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        contact_name: { type: 'string' },
        company: { type: 'string' },
        email: { type: 'string' },
        source: { type: 'string', enum: ['cold', 'referral', 'inbound'] },
        stage: { type: 'string', enum: ['lead','discovery','validation','scoping','proposal','negotiation'] },
        value: { type: 'number' },
        notes: { type: 'string' }
      },
      required: ['title', 'contact_name']
    }
  },
  {
    name: 'update_deal',
    description: 'Update deal fields (nextAction, nextActionDate, value, notes)',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        fields: {
          type: 'object',
          properties: {
            nextAction: { type: 'string' },
            nextActionDate: { type: 'string' },
            value: { type: 'number' },
            notes: { type: 'string' }
          }
        }
      },
      required: ['deal_id', 'fields']
    }
  },
  {
    name: 'move_stage',
    description: 'Advance deal to next stage. Enforces order — no skipping.',
    inputSchema: {
      type: 'object',
      properties: { deal_id: { type: 'integer' } },
      required: ['deal_id']
    }
  },
  {
    name: 'close_deal',
    description: 'Mark deal as won or lost',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        outcome: { type: 'string', enum: ['won', 'lost'] },
        reason: { type: 'string' }
      },
      required: ['deal_id', 'outcome']
    }
  },
  {
    name: 'snooze_deal',
    description: 'Push next_action_date forward. Default 3 days.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        days: { type: 'integer' }
      },
      required: ['deal_id']
    }
  },
  {
    name: 'update_contact',
    description: 'Update contact fields (email, phone, name, company, role, linkedin_url) for a deal',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id:      { type: 'integer' },
        email:        { type: 'string' },
        phone:        { type: 'string' },
        name:         { type: 'string' },
        company:      { type: 'string' },
        role:         { type: 'string' },
        linkedin_url: { type: 'string' }
      },
      required: ['deal_id']
    }
  },
  {
    name: 'log_activity',
    description: 'Log an activity for a deal and optionally update the next action',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        type: { type: 'string', enum: ['call','email','meeting','note','proposal_sent'] },
        summary: { type: 'string' },
        next_action: { type: 'string' },
        next_action_date: { type: 'string', description: 'ISO date YYYY-MM-DD' }
      },
      required: ['deal_id', 'type', 'summary']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail and log it as an activity. Only call after user confirms.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        deal_id: { type: 'integer' }
      },
      required: ['to', 'subject', 'body', 'deal_id']
    }
  },
  {
    name: 'get_today_briefing',
    description: "Fetch today's Google Calendar events and match them to CRM deals. Returns event list with deal context and recent activities for matched events.",
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_weekly_report',
    description: 'Generate the weekly CRM report: stale deals (no contact beyond stage threshold) and week activity snapshot. Persists a snapshot to DB.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_report_history',
    description: 'Return the last N weekly report snapshots ordered by week descending. Default 4 weeks.',
    inputSchema: {
      type: 'object',
      properties: {
        weeks: { type: 'integer', description: 'Number of weeks to return. Default 4.' }
      },
      required: []
    }
  },
];

export const handlers = {
  get_pipeline, get_deal, get_deal_context,
  create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact,
  log_activity, send_email, get_today_briefing, get_weekly_report,
  get_report_history,
  unknown_tool: async () => { throw new Error('Unknown tool'); }
};

// Only start the server when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = new Server(
    { name: 'crm', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler || name === 'unknown_tool') {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${name}"` }],
        isError: true
      };
    }
    try {
      const result = await handler(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
