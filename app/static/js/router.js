/* router.js — hash 路由 + 四态容器 */
import { store } from './store.js';
import { skeletonPage, errorPage, forbiddenPage } from './components.js';

const ROUTES = {
  chat: {
    path: 'chat', title: '客户聊天窗', crumb: '客户服务 / 在线咨询', skeleton: 'chat',
    load: () => import('./pages/chat.js')
  },
  workbench: {
    path: 'workbench', title: '坐席工作台', crumb: '客户服务 / 人工接管', skeleton: 'split',
    load: () => import('./pages/workbench.js')
  },
  unmatched: {
    path: 'unmatched', title: '未命中问题池', crumb: '知识与质量 / 运营闭环', skeleton: 'list',
    load: () => import('./pages/unmatched.js')
  },
  kb: {
    path: 'kb', title: '知识库管理', crumb: '知识与质量 / 知识资产', skeleton: 'list',
    load: () => import('./pages/kb.js')
  },
  dashboard: {
    path: 'dashboard', title: '数据看板', crumb: '知识与质量 / 服务指标', skeleton: 'list',
    load: () => import('./pages/dashboard.js')
  },
  qc: {
    path: 'qc', title: '会话质检', crumb: '知识与质量 / 质量抽检', skeleton: 'split',
    load: () => import('./pages/qc.js')
  },
  users: {
    path: 'users', title: '用户与角色', crumb: '系统 / 权限管理', skeleton: 'list', adminOnly: true,
    load: () => import('./pages/users.js')
  }
};

let activePage = null;
let activeRoute = 'chat';
let renderSeq = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const name = (pathPart || 'chat').replace(/\/+$/, '') || 'chat';
  return { name: ROUTES[name] ? name : 'chat', unknown: !ROUTES[name], params: new URLSearchParams(query) };
}

function globalState() {
  return new URLSearchParams(location.search).get('state') || '';
}

function effectiveState(params) {
  return params.get('state') || globalState() || 'default';
}

function setActiveNav(name) {
  document.querySelectorAll('.nav-item[data-route]').forEach((el) => {
    if (el.dataset.route === name) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  const usersNav = document.getElementById('navUsers');
  if (usersNav) usersNav.dataset.restricted = store.get().role === 'admin' ? 'false' : 'true';
}

function updateChrome(route, params) {
  document.getElementById('pageTitle').textContent = route.title;
  document.getElementById('crumb').textContent = route.crumb;
  document.title = `${route.title} · 恒锐精工售后智能客服`;
  setActiveNav(route.path);
  const select = document.getElementById('stateDemo');
  if (select) select.value = params?.get('state') || globalState() || 'default';
}

function clearStateParam() {
  const url = new URL(location.href);
  url.searchParams.delete('state');
  if (url.hash.includes('state=')) {
    const [path, query] = url.hash.split('?');
    const q = new URLSearchParams(query);
    q.delete('state');
    url.hash = q.toString() ? `${path}?${q}` : path;
  }
  history.replaceState(null, '', url);
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#/${String(path).replace(/^#?\/?/, '')}`;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

export function currentRoute() { return activeRoute; }

async function render() {
  const seq = ++renderSeq;
  const { name, params, unknown } = parseHash();
  const route = ROUTES[name];
  activeRoute = name;
  updateChrome(route, params);

  try { activePage?.destroy?.(); } catch { /* 页面清理失败不阻塞路由 */ }
  activePage = null;

  const view = document.getElementById('view');
  view.innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'auto' });

  const state = effectiveState(params);

  if (state === 'error' || unknown) {
    view.innerHTML = errorPage({
      code: unknown ? '404' : '500',
      title: unknown ? '页面不存在' : '数据加载失败',
      desc: unknown ? '你访问的页面不存在或已被移动，请从左侧导航重新进入。' : '接口在 3 秒内没有返回，已停止等待。请重试，或稍后联系管理员。',
      traceId: `tr_${Math.random().toString(16).slice(2, 10)}`
    });
    bindRetry(view);
    return;
  }
  if (state === '403' || (route.adminOnly && store.get().role !== 'admin')) {
    view.innerHTML = forbiddenPage({ traceId: `tr_${Math.random().toString(16).slice(2, 10)}`, resource: route.adminOnly ? '用户与角色' : '' });
    bindRetry(view);
    return;
  }
  if (state === 'loading') {
    view.innerHTML = skeletonPage(route.skeleton);
    // 评审演示：加载态停留 6 秒后自动恢复，避免误以为页面卡死
    setTimeout(() => {
      if (seq !== renderSeq) return;
      clearStateParam();
      view.innerHTML = skeletonPage(route.skeleton);
      setTimeout(render, 60);
    }, 6000);
    return;
  }

  try {
    const mod = await route.load();
    if (seq !== renderSeq) return;
    activePage = mod;
    await mod.render(view, {
      state,
      params,
      route: name,
      navigate,
      clearStateParam
    });
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error('[route] render failed', err);
    view.innerHTML = errorPage({
      code: '500',
      title: '页面渲染失败',
      desc: '页面初始化时出现异常，请重试；若持续失败请把 trace_id 发给管理员。',
      traceId: err?.traceId || `tr_${Math.random().toString(16).slice(2, 10)}`
    });
    bindRetry(view);
  }
}

function bindRetry(scope) {
  scope.querySelectorAll('[data-retry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearStateParam();
      render();
    });
  });
}

export function start() {
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/chat');
  render();
}

export function rerender() { render(); }




