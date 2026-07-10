const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const sessionKey = 'foto-notas-session';

function readSession() {
  const raw = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (!session?.token || Number(session.expiresAt) <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    clearSession();
    return null;
  }
}

function saveSession(session, remember) {
  clearSession();
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(sessionKey);
  sessionStorage.removeItem(sessionKey);
}

async function request(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Falha ao conversar com o backend.');
  }

  return data;
}

export const api = {
  baseUrl: API_URL,
  getSession: readSession,
  clearSession,
  health: () => request('/api/health'),
  login: async (payload) => {
    const session = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    saveSession(session, Boolean(payload.remember));
    return session;
  },
  logsUrl: () => {
    const session = readSession();
    const query = session?.token ? `?token=${encodeURIComponent(session.token)}` : '';
    return `${API_URL}/api/automacao/logs${query}`;
  },
  listNotas: () => request('/api/notas'),
  stats: () => request('/api/notas/stats'),
  createNota: (payload) => request('/api/notas', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  analyzeWithGroq: (payload) => request('/api/ocr/groq', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  startAutomation: () => request('/api/automacao/start', { method: 'POST' }),
  pauseAutomation: () => request('/api/automacao/pause', { method: 'POST' }),
  stopAutomation: () => request('/api/automacao/stop', { method: 'POST' }),
  sendNext: () => request('/api/automacao/send-next', { method: 'POST' }),
  reprocessErrors: () => request('/api/automacao/reprocess-errors', { method: 'POST' }),
  deleteByStatuses: (statuses) => request('/api/notas/by-status', {
    method: 'DELETE',
    body: JSON.stringify({ statuses })
  })
};
