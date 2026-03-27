import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from '../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = join(__dirname, '..', '.gmail-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
}

async function getAuthorizedClient() {
  const oauth2Client = createOAuth2Client();

  if (existsSync(CREDS_PATH)) {
    const token = JSON.parse(readFileSync(CREDS_PATH, 'utf8'));
    oauth2Client.setCredentials(token);
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.error('\nAuthorize Gmail by visiting:\n', authUrl);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const code = await new Promise(resolve => rl.question('\nPaste the authorization code: ', resolve));
  rl.close();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
  console.error('Gmail credentials saved.');
  return oauth2Client;
}

export async function send_email({ to, subject, body, deal_id }) {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n');
  const encoded = Buffer.from(message).toString('base64url');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  await db.activities.create({ dealId: deal_id, type: 'email', summary: `Sent: ${subject}` });

  return { sent: true, to, subject };
}
