/* components.js — Toast / Modal / Drawer / Confirm / 空态 / 错误页 / 骨架 */
import { icon } from './icons.js';

/* ---------------- 基础工具 ---------------- */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d).replace(/\//g, '-');
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' })
    .format(d).replace(/\//g, '-');
}

export function timeAgo(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return String(value);
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return fmtDate(value);
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

export function starsHtml(score, size = 13) {
  const n = Math.round(Number(score) || 0);
  let out = '<span class="stars" aria-label="' + n + ' 星">';
  for (let i = 1; i <= 5; i += 1) {
    out += `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="fill:${i <= n ? 'currentColor' : 'var(--ink-200)'}" aria-hidden="true">${'<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3Z"/>'}</svg>`;
  }
  return out + '</span>';
}

export function initials(name = '') {
  return String(name).trim().slice(0, 1).toUpperCase() || '?';
}

/* ---------------- Toast ---------------- */
const TOAST_ICON = { success: 'checkCircle', error: 'xCircle', warning: 'alertTriangle', info: 'info' };

export function toast(message, opts = {}) {
  const { type = 'info', title = '', desc = '', duration = 3200 } = typeof opts === 'string' ? { type: opts } : opts;
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const headline = title || message;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <span class="toast__icon">${icon(TOAST_ICON[type] || 'info', 18)}</span>
    <div class="toast__body">
      ${headline ? `<div class="toast__title">${esc(headline)}</div>` : ''}
      ${desc ? `<div class="toast__desc">${esc(desc)}</div>` : ''}
    </div>
    <button class="icon-btn toast__close" aria-label="关闭提示" style="width:24px;height:24px">${icon('close', 14)}</button>`;
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('.toast__close').addEventListener('click', close);
  root.append(el);
  if (duration > 0) setTimeout(close, duration);
  return close;
}

/* ---------------- Modal ---------------- */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
let modalSeq = 0;

export function openModal({ title, desc = '', body = '', footer = '', size = '', onClose, closeOnBackdrop = true, labelledBy } = {}) {
  const root = document.getElementById('modalRoot');
  const prevFocus = document.activeElement;
  const id = `modal-${++modalSeq}`;
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.innerHTML = `
    <div class="modal ${size ? `modal--${size}` : ''}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy || `${id}-title`}">
      <div class="modal__head">
        <div>
          <h2 class="modal__title" id="${labelledBy || `${id}-title`}">${esc(title)}</h2>
          ${desc ? `<p class="modal__desc">${esc(desc)}</p>` : ''}
        </div>
        <button class="icon-btn modal__close" data-close aria-label="关闭">${icon('close', 18)}</button>
      </div>
      <div class="modal__body">${body}</div>
      ${footer ? `<div class="modal__foot ${footer.includes('modal__foot--split') ? 'modal__foot--split' : ''}">${footer}</div>` : ''}
    </div>`;

  let closed = false;
  const close = (reason = 'close') => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    onClose?.(reason);
  };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close('esc'); return; }
    if (e.key !== 'Tab') return;
    const nodes = [...layer.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  layer.addEventListener('click', (e) => {
    if (e.target === layer && closeOnBackdrop) close('backdrop');
  });
  layer.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close('close')));
  document.addEventListener('keydown', onKey, true);
  root.append(layer);
  requestAnimationFrame(() => {
    const target = layer.querySelector('[data-autofocus]') || layer.querySelector(FOCUSABLE);
    target?.focus();
  });
  return { el: layer, close, body: layer.querySelector('.modal__body'), foot: layer.querySelector('.modal__foot') };
}

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确认', cancelText = '取消', danger = false, detail = '' } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const m = openModal({
      title,
      size: 'sm',
      body: `
        <div class="row" style="align-items:flex-start;gap:var(--sp-5)">
          <span class="empty-state__icon" style="width:40px;height:40px;margin:0;border-radius:var(--r-lg);background:${danger ? 'var(--danger-50)' : 'var(--brand-50)'};color:${danger ? 'var(--danger-600)' : 'var(--brand-600)'};border:1px solid ${danger ? 'var(--danger-100)' : 'var(--brand-100)'}">${icon(danger ? 'alertTriangle' : 'info', 20)}</span>
          <div class="grow">
            <p style="font-size:var(--fs-14);color:var(--ink-700);line-height:1.7">${message}</p>
            ${detail ? `<div class="notice ${danger ? 'notice--danger' : ''} mt-6">${detail}</div>` : ''}
          </div>
        </div>`,
      footer: `
        <button class="btn" data-cancel>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok data-autofocus>${esc(confirmText)}</button>`,
      onClose: () => { if (!decided) { decided = true; resolve(false); } }
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => { decided = true; resolve(true); m.close('ok'); });
    m.foot.querySelector('[data-cancel]').addEventListener('click', () => { decided = true; resolve(false); m.close('cancel'); });
  });
}

/* ---------------- Drawer ---------------- */
export function openDrawer({ title, sub = '', body = '', footer = '', wide = false, onClose } = {}) {
  document.querySelectorAll('#toastRoot .toast').forEach((t) => t.remove());
  const root = document.getElementById('modalRoot');
  const prevFocus = document.activeElement;
  const layer = document.createElement('div');
  layer.className = 'drawer-layer';
  layer.innerHTML = `
    <aside class="drawer ${wide ? 'drawer--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="drawer__head">
        <div><h2 class="drawer__title">${esc(title)}</h2>${sub ? `<p class="drawer__sub">${esc(sub)}</p>` : ''}</div>
        <button class="icon-btn" data-close aria-label="关闭">${icon('close', 18)}</button>
      </div>
      <div class="drawer__body">${body}</div>
      ${footer ? `<div class="drawer__foot">${footer}</div>` : ''}
    </aside>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    prevFocus?.focus?.();
    onClose?.();
  };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const nodes = [...layer.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  layer.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey, true);
  root.append(layer);
  requestAnimationFrame(() => layer.querySelector(FOCUSABLE)?.focus());
  return { el: layer, close, body: layer.querySelector('.drawer__body'), foot: layer.querySelector('.drawer__foot') };
}

/* ---------------- 四态 ---------------- */
export function emptyState({ iconName = 'inbox', title = '暂无数据', desc = '', action = '', compact = false } = {}) {
  return `<div class="empty-state ${compact ? 'empty-state--compact' : ''}" role="status">
    <div class="empty-state__icon">${icon(iconName, 24)}</div>
    <div class="empty-state__title">${esc(title)}</div>
    ${desc ? `<p class="empty-state__desc">${esc(desc)}</p>` : ''}
    ${action ? `<div class="empty-state__actions">${action}</div>` : ''}
  </div>`;
}

export function errorPage({ code = '500', title = '页面出了点问题', desc = '请求没有完成，请重试；若持续失败请把 trace_id 发给管理员。', traceId = '' } = {}) {
  const trace = traceId || `tr_${Math.random().toString(16).slice(2, 10)}`;
  return `<div class="error-page" role="alert">
    <span class="error-page__code">ERROR ${esc(code)}</span>
    <div class="error-page__mark">${icon('alertTriangle', 26)}</div>
    <h2 class="error-page__title">${esc(title)}</h2>
    <p class="error-page__desc">${esc(desc)}</p>
    <span class="error-page__trace">${icon('hash', 13)} trace_id: ${esc(trace)}</span>
    <div class="error-page__actions">
      <button class="btn btn--primary" data-retry>${icon('refresh', 16)} 重试</button>
      <a class="btn" href="#/chat">返回首页</a>
    </div>
  </div>`;
}

export function forbiddenPage({ traceId = '', resource = '', desc = '' } = {}) {
  const trace = traceId || `tr_${Math.random().toString(16).slice(2, 10)}`;
  const detail = desc || (resource
    ? `当前身份无权查看「${resource}」。该页面仅限 <strong>admin</strong> 访问；如需权限请联系系统管理员，或在左下角切换演示身份。`
    : '当前账号没有访问该页面的权限。请切换为有权限的账号，或联系系统管理员申请开通。');
  return `<div class="error-page error-page--forbidden" role="alert">
    <span class="error-page__code">403 FORBIDDEN</span>
    <div class="error-page__mark">${icon('lock', 26)}</div>
    <h2 class="error-page__title">没有访问权限</h2>
    <p class="error-page__desc">${detail}</p>
    <span class="error-page__trace">${icon('hash', 13)} trace_id: ${trace}</span>
    <div class="error-page__actions">
      <a class="btn btn--primary" href="#/chat">返回客户聊天窗</a>
      <button class="btn" data-retry>${icon('refresh', 16)} 重新校验</button>
    </div>
  </div>`;
}

export function skeletonPage(kind = 'list') {
  if (kind === 'chat') {
    return `<div class="loading-page" aria-busy="true" aria-label="加载中">
      <div class="skeleton sk-line w-40" style="height:14px"></div>
      <div class="card mt-8" style="padding:var(--sp-10)">
        <div class="row" style="align-items:flex-start"><div class="skeleton sk-circle" style="width:36px;height:36px"></div><div class="grow"><div class="skeleton sk-line w-40"></div><div class="skeleton sk-line w-80"></div></div></div>
        <div class="row mt-12" style="justify-content:flex-end"><div class="skeleton" style="width:56%;height:54px;border-radius:var(--r-xl)"></div></div>
        <div class="row mt-12" style="align-items:flex-start"><div class="skeleton sk-circle" style="width:36px;height:36px"></div><div class="grow"><div class="skeleton sk-line w-60"></div><div class="skeleton sk-line w-80"></div><div class="skeleton sk-line w-40"></div></div></div>
      </div>
      <div class="skeleton mt-8" style="height:64px;border-radius:var(--r-xl)"></div>
    </div>`;
  }
  return `<div class="loading-page" aria-busy="true" aria-label="加载中">
    <div class="skeleton sk-line w-40" style="height:18px"></div>
    <div class="loading-page__grid">
      ${Array.from({ length: 4 }).map(() => `<div class="loading-card"><div class="skeleton sk-line w-60"></div><div class="skeleton sk-line w-40" style="height:22px"></div><div class="skeleton sk-line w-80"></div></div>`).join('')}
    </div>
    <div class="card mt-12" style="padding:var(--sp-8)">
      ${Array.from({ length: 7 }).map(() => `<div class="loading-row"><div class="skeleton sk-circle" style="width:32px;height:32px"></div><div class="grow"><div class="skeleton sk-line w-40"></div><div class="skeleton sk-line w-60"></div></div><div class="skeleton" style="width:80px;height:24px"></div></div>`).join('')}
    </div>
  </div>`;
}

export function statusBadge(status, label) {
  const map = {
    ready: ['success', '已就绪'], parsing: ['info', '解析中'], pending: ['warning', '待解析'], failed: ['danger', '解析失败'], offline: ['neutral', '已下架'],
    WAITING: ['warning', '待接入'], ACTIVE: ['success', '进行中'], CLOSED: ['neutral', '已结束'], ESCALATED: ['danger', '已转人工'],
    active: ['success', '启用'], disabled: ['neutral', '已禁用'], published: ['success', '已发布'], review: ['warning', '待审核'], draft: ['neutral', '草稿']
  };
  const [tone, text] = map[status] || ['neutral', status];
  return `<span class="badge badge--${tone} badge--dot">${esc(label || text)}</span>`;
}




