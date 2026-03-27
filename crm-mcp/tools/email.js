import { google } from 'googleapis';
import { getAuthorizedClient } from './google-auth.js';
import * as db from '../db/index.js';

export async function send_email({ to, subject, body, deal_id }) {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n');
  const encoded = Buffer.from(message).toString('base64url');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  await db.activities.create({ dealId: deal_id, type: 'email', summary: `Sent: ${subject}` });

  return { sent: true, to, subject };
}
