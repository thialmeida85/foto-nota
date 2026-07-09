const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
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
  health: () => request('/api/health'),
  listNotas: () => request('/api/notas'),
  stats: () => request('/api/notas/stats'),
  createNota: (payload) => request('/api/notas', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  startAutomation: () => request('/api/automacao/start', { method: 'POST' }),
  pauseAutomation: () => request('/api/automacao/pause', { method: 'POST' }),
  stopAutomation: () => request('/api/automacao/stop', { method: 'POST' }),
  sendNext: () => request('/api/automacao/send-next', { method: 'POST' }),
  reprocessErrors: () => request('/api/automacao/reprocess-errors', { method: 'POST' })
};

