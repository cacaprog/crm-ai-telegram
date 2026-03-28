import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = join(__dirname, '..', '.google-credentials.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly'
];

const REDIRECT_PORT = 4242;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    REDIRECT_URI
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

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      if (code) {
        res.end('Authorization complete. You can close this tab.');
        server.close();
        resolve(code);
      } else {
        res.end('Missing code.');
        server.close();
        reject(new Error('No code in redirect'));
      }
    });
    server.listen(REDIRECT_PORT, () => {
      console.error(`\nWaiting for Google redirect on http://localhost:${REDIRECT_PORT} ...`);
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
  console.error('Google credentials saved.');
  return oauth2Client;
}
