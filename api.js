/* ============================================
   Apikeeper — API helper
   Talks to your own apikeeper backend (the
   server you deployed from the api-key-system
   project). The base URL is whatever address
   your server is running at — a Codespace
   preview URL while testing, or your real
   domain once deployed.
   ============================================ */

const Apikeeper = (() => {
  const STORAGE_KEY = 'apikeeper_base_url';
  const EMAIL_KEY = 'apikeeper_email';

  function getBaseUrl() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function setBaseUrl(url) {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
  }

  function getEmail() {
    return localStorage.getItem(EMAIL_KEY) || '';
  }

  function setEmail(email) {
    localStorage.setItem(EMAIL_KEY, email);
  }

  async function request(path, { method = 'GET', body, email } = {}) {
    const base = getBaseUrl();
    if (!base) {
      throw new Error('No API base URL set. Enter your server address above first.');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (email) headers['x-user-email'] = email;

    const res = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  return {
    getBaseUrl, setBaseUrl, getEmail, setEmail,
    createKey: (email, payload) => request('/dashboard/keys', { method: 'POST', email, body: payload }),
    listKeys: (email) => request('/dashboard/keys', { email }),
    revokeKey: (email, id) => request(`/dashboard/keys/${id}`, { method: 'DELETE', email }),
    getUsage: (email) => request('/dashboard/usage', { email }),
    health: () => request('/health'),
  };
})();
