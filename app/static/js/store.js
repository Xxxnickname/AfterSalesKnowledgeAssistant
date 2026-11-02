/* store.js — 演示态（身份 / 聊天记录 / 跨页选择）持久化到 sessionStorage */
const KEY = 'hrkb.g1.state.v1';

const defaults = {
  role: 'admin',
  chat: { messages: null, escalated: false, feedback: null, ended: false, handoverOpen: false },
  workbench: { selectedId: null, activeIds: null, takenIds: null },
  kb: { tab: 'docs' },
  qc: { selectedId: null },
  unmatched: { days: 7 }
};

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return structuredClone(defaults);
    return { ...structuredClone(defaults), ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaults);
  }
}

let state = read();

export const store = {
  get() { return state; },
  patch(partial) {
    state = { ...state, ...partial };
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式忽略 */ }
    return state;
  },
  patchSection(section, partial) {
    state = { ...state, [section]: { ...(state[section] || {}), ...partial } };
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    return state[section];
  },
  resetChat() {
    return this.patchSection('chat', { messages: null, escalated: false, feedback: null, ended: false, handoverOpen: false });
  }
};



