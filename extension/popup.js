// The popup: shows who is connected and saves the current tab's job posting.
// The page is read only when the user clicks Save (the activeTab permission gives
// access to this one tab, at that moment). If the user selected text, only the
// selection is sent; otherwise the page's visible text.

const LIVE_APP = 'https://hireboard-mu.vercel.app';
const MIN_TEXT = 80;
const MAX_TEXT = 20_000;
const view = document.getElementById('view');

// Builds elements without innerHTML: page titles and server messages are shown as text.
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}
const show = (...nodes) => view.replaceChildren(...nodes.filter(Boolean));
const getConnection = async () => (await chrome.storage.local.get('connection')).connection ?? null;

async function render() {
  const connection = await getConnection();
  if (!connection) return showConnect();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const readable = /^https?:/.test(tab?.url ?? '');
  const save = el('button', { className: 'primary', textContent: 'Save this job', disabled: !readable, onclick: () => saveJob(connection, tab) });

  show(
    el('p', { className: 'muted small' }, 'Connected as ', el('strong', { textContent: connection.user.email || connection.user.name })),
    el('div', { className: 'page' },
      el('div', { className: 'page-title', textContent: tab?.title || 'This page' }),
      el('div', { className: 'muted small', textContent: readable ? new URL(tab.url).hostname : "Chrome doesn't let extensions read this page." }),
    ),
    save,
    el('p', { className: 'muted small' }, 'Tip: if the page has a lot besides the job (other listings, comments), select the job description first.'),
    el('p', { className: 'muted small' }, 'HireBoard reads the posting with AI and opens a filled-in form for you to check. Nothing is added to your applications until you save it.'),
    el('button', { className: 'link', textContent: 'Disconnect', onclick: disconnect }),
  );
}

function showConnect(message) {
  show(
    message ? el('p', { className: 'error', textContent: message }) : null,
    el('p', {}, 'Connect your HireBoard account to save jobs from any careers page.'),
    el('ol', { className: 'small' },
      el('li', { textContent: 'Open HireBoard and sign in (the demo works too).' }),
      el('li', { textContent: 'Go to Settings and click "Connect Chrome extension".' }),
    ),
    el('button', { className: 'primary', textContent: 'Open HireBoard Settings', onclick: () => openTab(`${LIVE_APP}/settings`) }),
  );
}

// Runs inside the job page when the user clicks Save.
function readPage() {
  const selection = String(window.getSelection() ?? '').trim();
  const useSelection = selection.length >= 80;
  const text = (useSelection ? selection : document.body?.innerText ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, url: location.href, title: document.title, useSelection };
}

async function saveJob(connection, tab) {
  let page;
  try {
    [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
  } catch {
    return showError(connection, "Chrome doesn't let extensions read this page.");
  }
  if (!page || page.text.length < MIN_TEXT) {
    return showError(connection, "There isn't enough text on this page. Select the job description and try again.");
  }

  const status = el('p', { className: 'muted', textContent: `Reading the job${page.useSelection ? ' (your selection)' : ''}…` });
  show(el('div', { className: 'spinner', role: 'progressbar', ariaLabel: 'Saving' }), status);
  // The free server sleeps when idle; the first request can take up to a minute.
  const slow = setTimeout(() => { status.textContent = 'Waking up the HireBoard server, this can take up to a minute…'; }, 8000);

  try {
    const res = await fetch(`${connection.apiUrl}/imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({ text: page.text.slice(0, MAX_TEXT), url: page.url, title: page.title.slice(0, 300) }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      await chrome.storage.local.remove('connection');
      return showConnect('Your connection expired. Connect again from HireBoard Settings.');
    }
    if (!res.ok) {
      const fields = body?.error?.fields ?? {};
      return showError(connection, Object.values(fields)[0] ?? body?.error?.message ?? 'Saving failed. Please try again.');
    }
    await openTab(`${connection.appUrl}/applications?import=${encodeURIComponent(body.id)}`);
    window.close();
  } catch (err) {
    showError(connection, err?.name === 'TimeoutError' ? 'HireBoard took too long to answer. Please try again.' : "Couldn't reach HireBoard. Check your connection and try again.");
  } finally {
    clearTimeout(slow);
  }
}

function showError(connection, message) {
  show(
    el('p', { className: 'error', textContent: message }),
    el('button', { className: 'primary', textContent: 'Back', onclick: render }),
  );
}

async function disconnect() {
  await chrome.storage.local.remove('connection');
  render();
}

const openTab = (url) => chrome.tabs.create({ url });

render();
