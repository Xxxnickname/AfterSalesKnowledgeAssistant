/* app.js — 应用入口：身份、移动端导航、状态演示、路由启动 */
import { store } from './store.js';
import { start, rerender } from './router.js';
import { toast } from './components.js';
import { api } from './api.js';

const ROLE_PROFILE = {
  admin: { name: '陈立', label: '系统管理员', avatar: '陈' },
  agent: { name: '林晓', label: '售后坐席 · 一级', avatar: '林' }
};

function syncRoleUI() {
  const role = store.get().role;
  const profile = ROLE_PROFILE[role] || ROLE_PROFILE.admin;
  document.getElementById('roleName').textContent = profile.name;
  document.getElementById('roleLabel').textContent = profile.label;
  document.getElementById('roleAvatar').textContent = profile.avatar;
  document.getElementById('roleSelect').value = role;
  const usersNav = document.getElementById('navUsers');
  if (usersNav) usersNav.dataset.restricted = role === 'admin' ? 'false' : 'true';
  document.querySelectorAll('.nav-lock').forEach((el) => { el.style.display = role === 'admin' ? 'none' : ''; });
  const hint = document.getElementById('permHint');
  if (hint) {
    hint.textContent = role === 'admin'
      ? '切换到「坐席」验证越权 403 ↗'
      : '当前为坐席 · 点击验证越权 403 ↗';
  }
}

function initRole() {
  document.getElementById('roleSelect').addEventListener('change', (e) => {
    store.patch({ role: e.target.value });
    syncRoleUI();
    toast(e.target.value === 'admin' ? '已切换为管理员视角' : '已切换为坐席视角', {
      type: 'info',
      desc: e.target.value === 'admin' ? '可访问用户与角色管理。' : '访问「用户与角色」将返回 403。'
    });
    rerender();
  });
  syncRoleUI();
}

function initMobileNav() {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const openBtn = document.getElementById('menuBtn');
  const closeBtn = document.getElementById('sidebarClose');
  const setOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    scrim.hidden = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  scrim.addEventListener('click', () => setOpen(false));
  document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('is-open')) setOpen(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 1023) setOpen(false); });
}

function initStateDemo() {
  const select = document.getElementById('stateDemo');
  select.addEventListener('change', () => {
    const value = select.value;
    const url = new URL(location.href);
    if (value === 'default') url.searchParams.delete('state');
    else url.searchParams.set('state', value);
    url.hash = url.hash.split('?')[0] || '#/chat';
    history.replaceState(null, '', url);
    rerender();
  });
}

function initBell() {
  document.getElementById('bellBtn').addEventListener('click', () => {
    toast('2 条待处理提醒', { type: 'warning', desc: '1 个会话等待超过 3 分钟 · 1 份手册解析失败', duration: 4200 });
  });
}

async function initQueueCount() {
  try {
    const data = await api.sessions.getWorkbench();
    const count = document.getElementById('navQueueCount');
    if (count) count.textContent = String(data.waiting.length);
  } catch { /* 静态徽标兜底 */ }
}

initRole();
initMobileNav();
initStateDemo();
initBell();
initQueueCount();
start();


