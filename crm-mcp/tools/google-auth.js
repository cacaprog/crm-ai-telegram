import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = join(__dirname, '..', '.google-credentials.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly'
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
}

export async function getAuthorizedClient() {
  const oauth2Client = createOAuth2Client();

  if (existsSync(CREDS_PATH)) {
    oauth2Client.setCredentials(JSON.parse(readFileSync(CREDS_PATH, 'utf8')));
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.error('\nAuthorize Google by visiting:\n', authUrl);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const code = await new Promise(resolve => rl.question('\nPaste the authorization code: ', resolve));
  rl.close();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
  console.error('Google credentials saved.');
  return oauth2Client;
}
