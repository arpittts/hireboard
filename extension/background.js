// Receives the connection from HireBoard's Settings page ("Connect Chrome extension").
// Only HireBoard's own pages can message the extension (externally_connectable in
// manifest.json), and the origin is checked again here. The token it stores can only
// save jobs: the API refuses it everywhere else.

const APP_ORIGINS = ['https://hireboard-mu.vercel.app', 'http://localhost:5173', 'http://localhost:5174'];

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!APP_ORIGINS.includes(sender.origin)) {
    sendResponse({ ok: false, error: 'This site cannot talk to the extension.' });
    return false;
  }
  handle(message, sender.origin).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
  return true; // the answer is sent asynchronously
});

async function handle(message, origin) {
  if (message?.type === 'status') {
    const { connection } = await chrome.storage.local.get('connection');
    // Local development and the live site each see only their own connection.
    const mine = connection?.appUrl === origin ? connection : null;
    return { ok: true, version: chrome.runtime.getManifest().version, connected: mine ? mine.user : null };
  }

  if (message?.type === 'connect') {
    const { token, apiUrl, user } = message;
    if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error('Invalid token.');
    const api = new URL(apiUrl);
    if (api.protocol !== 'https:' && api.hostname !== 'localhost') throw new Error('The API must use https.');
    await chrome.storage.local.set({
      connection: {
        token,
        apiUrl: api.href.replace(/\/$/, ''),
        appUrl: origin,
        user: { name: String(user?.name ?? '').slice(0, 100), email: String(user?.email ?? '').slice(0, 200) },
        connectedAt: Date.now(),
      },
    });
    return { ok: true };
  }

  if (message?.type === 'disconnect') {
    const { connection } = await chrome.storage.local.get('connection');
    if (connection?.appUrl === origin) await chrome.storage.local.remove('connection');
    return { ok: true };
  }

  throw new Error('Unknown request.');
}
