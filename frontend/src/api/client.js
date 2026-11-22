const API_BASE = '';

export function getToken() {
  return localStorage.getItem('yatra_token') || '';
}

export function setAuthSession(token, user) {
  localStorage.setItem('yatra_token', token);
  localStorage.setItem('yatra_user', JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem('yatra_token');
  localStorage.removeItem('yatra_user');
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('yatra_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }

  if (!res.ok) {
    const err = new Error(
      typeof data?.detail === 'string'
        ? data.detail
        : data?.detail?.message || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.pgDetail = typeof data?.detail === 'object' ? data.detail : null;
    throw err;
  }
  return data;
}
