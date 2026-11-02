/* api.js — 全站唯一请求出口
 * MOCK=false：访问真实 /api/*（G2 已切换）
 * 本地演示登录：优先 POST /api/auth/demo；失败时回退 admin 登录
 */
export const MOCK = false;
const BASE = '/api';
const MOCK_DELAY = 120;
const TOKEN_KEY = 'kb.auth.token';
const cache = new Map();

let authToken = sessionStorage.getItem(TOKEN_KEY) || '';
let authPromise = null;

export class ApiError extends Error {
  constructor(message, code = 'UNKNOWN', traceId = '') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId || `tr_${Math.random().toString(16).slice(2, 10)}`;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readMock(name) {
  if (!cache.has(name)) {
    const res = await fetch(`./mock/${name}.json`, { cache: 'no-store' });
    if (!res.ok) throw new ApiError(`Mock 数据加载失败：${name}.json`, 'MOCK_READ_FAILED');
    cache.set(name, await res.json());
  }
  const data = cache.get(name);
  await sleep(MOCK_DELAY);
  return structuredClone(data);
}

async function rawLogin(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) {
    throw new ApiError(payload.message || '登录失败', payload.code || res.status, payload.trace_id);
  }
  authToken = payload.data?.access_token || '';
  if (authToken) sessionStorage.setItem(TOKEN_KEY, authToken);
  return payload.data;
}

export async function ensureAuth(force = false) {
  if (authToken && !force) return true;
  if (authPromise) return authPromise;
  authPromise = (async () => {
    try {
      await rawLogin('/auth/demo');
    } catch {
      await rawLogin('/auth/login', { username: 'admin', password: 'Admin@12345' });
    }
    return true;
  })().finally(() => { authPromise = null; });
  return authPromise;
}

async function request(path, { method = 'GET', body, signal, headers = {}, retry = true } = {}) {
  if (!path.startsWith('/auth/')) await ensureAuth();
  const finalHeaders = { 'Content-Type': 'application/json', ...headers };
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    authToken = '';
    sessionStorage.removeItem(TOKEN_KEY);
    await ensureAuth(true);
    return request(path, { method, body, signal, headers, retry: false });
  }
  if (!res.ok || payload.code !== 0) {
    throw new ApiError(payload.message || `请求失败（${res.status}）`, payload.code || res.status, payload.trace_id);
  }
  return payload.data;
}

export const api = {
  auth: {
    async me() { return request('/auth/me'); },
    async login(username, password) { return rawLogin('/auth/login', { username, password }); }
  },
  chat: {
    async getFaqs() {
      try { return await request('/chat/faqs'); }
      catch { return readMock('chat_faq'); }
    },
    async escalate(payload) { return request('/chat/escalate', { method: 'POST', body: payload }); },
    async send(payload) { return request('/chat', { method: 'POST', body: payload }); }
  },
  sessions: {
    async getWorkbench() { return request('/sessions'); },
    async getHandover(id) {
      const data = await request(`/sessions/${encodeURIComponent(id)}`);
      return {
        session_id: data.id,
        queue_position: data.queue_position || 0,
        eta_min: data.eta_min || 0,
        assigned_team: data.assigned_agent_name || '售后队列',
        business_hours: '09:00–21:00',
        handover: data.handover || {},
      };
    },
    async takeover(id) { return request(`/sessions/${encodeURIComponent(id)}/takeover`, { method: 'POST' }); },
    async reply(id, text) { return request(`/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text } }); },
    async close(id, result = '已解决') { return request(`/sessions/${encodeURIComponent(id)}/close`, { method: 'POST', body: { result } }); }
  },
  unmatched: {
    async list(days = 7) { return request(`/unmatched?days=${days}`); },
    async draftFaq(id, payload = {}) { return request(`/unmatched/${encodeURIComponent(id)}/faq-draft`, { method: 'POST', body: payload }); }
  },
  kb: {
    async getAll() {
      const [main, glossary] = await Promise.all([
        request('/kb/docs'),
        request('/kb/glossary').catch(() => [])
      ]);
      return { ...main, glossary: Array.isArray(glossary) ? glossary : (glossary.glossary || []) };
    }
  },
  dashboard: {
    async get() { return request('/dashboard'); }
  },
  qc: {
    async getAll() { return request('/qc/sessions'); }
  },
  users: {
    async list() { return request('/users'); },
    async create(payload) { return request('/users', { method: 'POST', body: payload }); },
    async update(id, payload) { return request(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }); },
    async resetPassword(id) { return request(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' }); }
  },
  feedback: {
    async submit(payload) { return request('/feedback', { method: 'POST', body: payload }); }
  }
};

export { request as rawRequest };
