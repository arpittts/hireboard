// A small wrapper around fetch() for the HireBoard API.
// api.get/post/put/patch/delete resolve to { data, status } and reject with an
// error whose `response` is { status, data }, so callers can read the API's
// { error: { code, message, fields } } body.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

// --- Slow-request tracking, for the "waking the server" banner -------------
// The free server sleeps when idle, so the first request can take a minute.
// Any request still running after 3 seconds counts as slow.
const SLOW_AFTER_MS = 3000;
let slowRequests = 0;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

export function subscribeToSlowRequests(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const isServerSlow = () => slowRequests > 0;

// Starts the 3-second timer for one request; call the returned function when it ends.
function trackRequest() {
  let markedSlow = false;
  const timer = setTimeout(() => {
    markedSlow = true;
    slowRequests += 1;
    notify();
  }, SLOW_AFTER_MS);
  return () => {
    clearTimeout(timer);
    if (markedSlow) {
      slowRequests -= 1;
      notify();
    }
  };
}

// --- Requests ----------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error?.message || `Request failed with status ${status}`);
    this.response = { status, data };
  }
}

function buildUrl(path, params) {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

async function request(method, path, { params, body, responseType } = {}) {
  const headers = {};
  const token = localStorage.getItem('hireboard_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  // FormData (file uploads) sets its own multipart Content-Type; everything else is JSON.
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const finish = trackRequest();
  let res;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined || isForm ? body : JSON.stringify(body),
    });
  } finally {
    // Network failures (server unreachable) throw a TypeError with no `response`.
    finish();
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = responseType === 'blob' && res.ok ? await res.blob() : isJson ? await res.json() : await res.text();

  if (!res.ok) {
    // An expired or invalid token: sign out. A wrong password on the login form
    // is also a 401, so let the form show its error instead.
    const isAuthForm = /^\/auth\/(login|register)$/.test(path);
    if (res.status === 401 && !isAuthForm) {
      localStorage.removeItem('hireboard_token');
      localStorage.removeItem('hireboard_user');
      window.location.href = '/login';
    }
    throw new ApiError(res.status, data);
  }
  return { data, status: res.status };
}

// POST that answers with server-sent events (drafts). onEvent(name, data) is called
// for each event as it arrives. Errors before the stream starts (a 400 or 404 with
// a JSON body) are thrown like any other request error.
export async function streamPost(path, body, onEvent) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('hireboard_token');
  if (token) headers.Authorization = `Bearer ${token}`;

  const finish = trackRequest(); // the "waking the server" banner, until the first byte
  let res;
  try {
    res = await fetch(buildUrl(path), { method: 'POST', headers, body: JSON.stringify(body) });
  } finally {
    finish();
  }
  if (!res.ok) {
    const isJson = res.headers.get('content-type')?.includes('application/json');
    throw new ApiError(res.status, isJson ? await res.json() : await res.text());
  }

  // Events are separated by a blank line: "event: text\ndata: {...}\n\n".
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  delete: (path, options) => request('DELETE', path, { body: options?.data }),
};

export default api;

// A readable message from a failed request. The API answers
// { error: { message, fields } }; a field message is more specific, so prefer it.
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err.response) return 'Cannot reach the server. Please try again in a minute.';
  const error = err.response.data?.error;
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const firstField = error.fields && Object.values(error.fields)[0];
  return firstField || error.message || fallback;
}
