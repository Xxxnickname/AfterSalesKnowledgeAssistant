/* users.js — 1-8 用户与角色：仅 admin / 新增 / 分配角色 / 重置密码 / 禁用 */
import { api } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import {
  esc, fmtDateTime, toast, openModal, confirmDialog, emptyState, skeletonPage,
  forbiddenPage, initials
} from '../components.js';

let users = [];
let q = '';
let roleFilter = 'all';
let statusFilter = 'all';
let rootEl = null;
let loaded = false;

const STAFF = { agent: '坐席', supervisor: '主管', ops: '运营' };
const STAFF_TONE = { agent: 'info', supervisor: 'warning', ops: 'success' };

function filtered() {
  const s = q.trim().toLowerCase();
  return users.filter((u) => {
    const matchQ = !s || [u.name, u.username, u.dept, u.phone].some((v) => String(v).toLowerCase().includes(s));
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchQ && matchRole && matchStatus;
  });
}

function statsHtml() {
  const admins = users.filter((u) => u.role === 'admin').length;
  const agents = users.filter((u) => u.staff_role === 'agent').length;
  const disabled = users.filter((u) => u.status === 'disabled').length;
  return `<div class="stat-strip">
    <div class="stat"><div class="stat__label">账号总数</div><div class="stat__value">${users.length}<small>个</small></div><div class="stat__foot">覆盖 5 个业务部门</div></div>
    <div class="stat"><div class="stat__label">管理员</div><div class="stat__value">${admins}<small>个</small></div><div class="stat__foot">两级角色 · admin 可管理权限</div></div>
    <div class="stat"><div class="stat__label">售后坐席</div><div class="stat__value">${agents}<small>个</small></div><div class="stat__foot">今日在线 5 人</div></div>
    <div class="stat"><div class="stat__label">已禁用</div><div class="stat__value">${disabled}<small>个</small></div><div class="stat__foot">禁用后立即无法登录</div></div>
  </div>`;
}

function rowsHtml(list) {
  if (!list.length) return emptyState({ iconName: 'users', title: '没有匹配的账号', desc: '试试清空搜索，或切换角色/状态筛选。', action: '<button class="btn btn--primary" data-clear-users>清空筛选</button>', compact: true });
  return `<div class="table-wrap" style="max-height:calc(100dvh - 400px);min-height:320px"><table class="table users-table" style="min-width:1000px">
    <thead><tr><th>账号 / 姓名</th><th style="width:88px">角色</th><th style="width:80px">业务身份</th><th style="width:110px">部门</th><th style="width:112px">手机</th><th style="width:78px">今日会话</th><th style="width:150px">最后登录</th><th style="width:82px">状态</th><th style="width:112px"></th></tr></thead>
    <tbody>${list.map((u) => `<tr class="${u.status === 'disabled' ? 'users-row--disabled' : ''}">
      <td><div class="users-person"><span class="avatar avatar--sm ${u.role === 'admin' ? 'avatar--dark' : ''}">${esc(initials(u.name))}</span><div><div class="users-person__name">${esc(u.name)}</div><div class="users-person__user">${esc(u.username)}</div></div></div></td>
      <td><span class="badge badge--${u.role === 'admin' ? 'brand' : 'neutral'}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
      <td><span class="badge badge--${STAFF_TONE[u.staff_role] || 'neutral'}">${esc(STAFF[u.staff_role] || '—')}</span></td>
      <td>${esc(u.dept)}</td>
      <td class="mono" style="font-size:var(--fs-12)">${esc(u.phone)}</td>
      <td class="mono num">${u.sessions_today}</td>
      <td class="mono" style="font-size:var(--fs-12)">${esc(fmtDateTime(u.last_login))}</td>
      <td><span class="badge badge--${u.status === 'active' ? 'success' : 'neutral'} badge--dot">${u.status === 'active' ? '启用' : '已禁用'}</span></td>
      <td><div class="users-actions">
        <button class="icon-btn tooltip" data-assign="${esc(u.id)}" data-tip="分配角色" aria-label="为 ${esc(u.name)} 分配角色">${icon('edit', 15)}</button>
        <button class="icon-btn tooltip" data-reset="${esc(u.id)}" data-tip="重置密码" aria-label="重置 ${esc(u.name)} 的密码">${icon('key', 15)}</button>
        <button class="icon-btn tooltip ${u.status === 'active' ? 'text-danger' : 'text-success'}" data-toggle="${esc(u.id)}" data-tip="${u.status === 'active' ? '禁用账号' : '启用账号'}" aria-label="${u.status === 'active' ? '禁用' : '启用'} ${esc(u.name)}">${icon(u.status === 'active' ? 'lock' : 'unlock', 15)}</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function shellHtml() {
  return `<div class="users-page">
    <div class="page-head">
      <div><h2 class="page-head__title">用户与角色</h2><p class="page-head__desc">两级角色 <span class="mono">admin / user</span>；业务身份（坐席 / 主管 / 运营）挂在 user 下，后端二次校验。</p></div>
      <div class="page-head__actions"><span class="badge badge--brand">${icon('shieldCheck', 12)} admin 专属</span><button class="btn btn--primary btn--sm" id="newUserBtn">${icon('userPlus', 14)} 新增账号</button></div>
    </div>
    ${statsHtml()}
    <div class="card">
      <div class="users-toolbar">
        <div class="users-toolbar__left">
          <div class="search-box users-search">${icon('search', 15)}<label class="sr-only" for="userSearch">搜索账号</label><input class="input" id="userSearch" placeholder="搜索姓名 / 账号 / 部门…" value="${esc(q)}"></div>
          <label class="sr-only" for="roleFilter">角色筛选</label>
          <select class="select" id="roleFilter" style="width:120px"><option value="all" ${roleFilter === 'all' ? 'selected' : ''}>全部角色</option><option value="admin" ${roleFilter === 'admin' ? 'selected' : ''}>管理员</option><option value="user" ${roleFilter === 'user' ? 'selected' : ''}>普通用户</option></select>
          <label class="sr-only" for="statusFilter">状态筛选</label>
          <select class="select" id="statusFilter" style="width:120px"><option value="all" ${statusFilter === 'all' ? 'selected' : ''}>全部状态</option><option value="active" ${statusFilter === 'active' ? 'selected' : ''}>启用</option><option value="disabled" ${statusFilter === 'disabled' ? 'selected' : ''}>已禁用</option></select>
        </div>
        <div class="users-toolbar__right"><span class="muted" style="font-size:var(--fs-12)">共 ${filtered().length} / ${users.length} 个账号</span></div>
      </div>
      ${rowsHtml(filtered())}
      <div class="users-note">${icon('shieldCheck', 14)} 权限说明：前端隐藏不等于权限，所有管理操作由后端再次校验并写审计日志（trace_id + 操作对象 + 结果）。</div>
    </div>
  </div>`;
}

function rerender() {
  if (!rootEl) return;
  rootEl.innerHTML = shellHtml();
  bind();
}

function bind() {
  const root = rootEl;
  const search = root.querySelector('#userSearch');
  search?.addEventListener('input', () => {
    q = search.value;
    rerender();
    const next = rootEl.querySelector('#userSearch');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  root.querySelector('#roleFilter')?.addEventListener('change', (e) => { roleFilter = e.target.value; rerender(); });
  root.querySelector('#statusFilter')?.addEventListener('change', (e) => { statusFilter = e.target.value; rerender(); });
  root.querySelector('[data-clear-users]')?.addEventListener('click', () => { q = ''; roleFilter = 'all'; statusFilter = 'all'; rerender(); });
  root.querySelector('#newUserBtn')?.addEventListener('click', openCreate);
  root.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => openAssign(b.dataset.assign)));
  root.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => resetPassword(b.dataset.reset)));
  root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleUser(b.dataset.toggle)));
}

function staffOptions(role, selected) {
  const list = role === 'admin' ? ['supervisor', 'ops'] : ['agent', 'supervisor', 'ops'];
  return list.map((k) => `<option value="${k}" ${selected === k ? 'selected' : ''}>${STAFF[k]}</option>`).join('');
}

function openCreate() {
  const m = openModal({
    title: '新增账号',
    desc: '创建后可分配业务身份；初始密码将通过安全渠道发送。',
    size: 'lg',
    body: `<div class="role-form">
      <div class="field"><label class="label" for="nuUser">登录账号 *</label><input class="input" id="nuUser" placeholder="3–20 位字母 / 数字 / 下划线" maxlength="20"><span class="hint">登录后不可修改，建议使用姓名拼音。</span></div>
      <div class="field"><label class="label" for="nuName">姓名 *</label><input class="input" id="nuName" placeholder="如：林晓" maxlength="20"></div>
      <div class="field"><label class="label" for="nuRole">角色 *</label><select class="select" id="nuRole"><option value="user">普通用户（user）</option><option value="admin">管理员（admin）</option></select></div>
      <div class="field"><label class="label" for="nuStaff">业务身份 *</label><select class="select" id="nuStaff">${staffOptions('user', 'agent')}</select></div>
      <div class="field"><label class="label" for="nuDept">部门</label><select class="select" id="nuDept"><option>售后一组</option><option>售后二组</option><option>华南售后组</option><option>华北售后组</option><option>知识运营</option><option>运营中心</option></select></div>
      <div class="field"><label class="label" for="nuPhone">手机</label><input class="input" id="nuPhone" placeholder="13800000000" maxlength="11"></div>
      <div class="field field--wide"><div class="notice notice--brand">${icon('shieldCheck', 14)} 新账号默认「启用」，首次登录需重置密码；所有管理操作写入审计日志。</div></div>
    </div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn--primary" id="createUser">创建账号</button>`
  });
  m.body.querySelector('#nuRole').addEventListener('change', (e) => {
    const staff = m.body.querySelector('#nuStaff');
    staff.innerHTML = staffOptions(e.target.value, e.target.value === 'admin' ? 'supervisor' : 'agent');
  });
  m.foot.querySelector('#createUser').addEventListener('click', async () => {
    const username = m.body.querySelector('#nuUser').value.trim();
    const name = m.body.querySelector('#nuName').value.trim();
    const role = m.body.querySelector('#nuRole').value;
    const staff = m.body.querySelector('#nuStaff').value;
    const dept = m.body.querySelector('#nuDept').value;
    const phone = m.body.querySelector('#nuPhone').value.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { toast('账号格式不正确', { type: 'error', desc: '需为 3–20 位字母、数字或下划线。' }); m.body.querySelector('#nuUser').focus(); return; }
    if (!name) { toast('请填写姓名', { type: 'error' }); m.body.querySelector('#nuName').focus(); return; }
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) { toast('账号已存在', { type: 'error', desc: '请换一个登录账号。' }); m.body.querySelector('#nuUser').focus(); return; }
    if (phone && !/^1\d{10}$/.test(phone)) { toast('手机号格式不正确', { type: 'error' }); m.body.querySelector('#nuPhone').focus(); return; }
    const btn = m.foot.querySelector('#createUser');
    btn.disabled = true; btn.textContent = '创建中…';
    const created = await api.users.create({ username, name, role, staff_role: staff, dept, phone: phone || '—' });
    users.unshift({ id: created.id, username, name, role, staff_role: staff, dept, phone: phone || '—', status: 'active', last_login: null, sessions_today: 0, created_at: new Date().toISOString() });
    m.close('created');
    rerender();
    toast('账号已创建', { type: 'success', desc: `${name}（${username}）已加入 ${dept}，初始密码需单独发送。` });
  });
}

function openAssign(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  const m = openModal({
    title: '分配角色',
    desc: `${u.name} · ${u.username}`,
    size: 'sm',
    body: `<div class="role-form">
      <div class="field field--wide"><label class="label" for="asRole">角色</label><select class="select" id="asRole"><option value="user" ${u.role === 'user' ? 'selected' : ''}>普通用户（user）</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员（admin）</option></select></div>
      <div class="field field--wide"><label class="label" for="asStaff">业务身份</label><select class="select" id="asStaff">${staffOptions(u.role, u.staff_role)}</select></div>
      <div class="field field--wide"><div class="notice">${icon('info', 14)} 变更立即生效；若该账号正在处理会话，不会中断当前会话。</div></div>
    </div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn--primary" id="saveAssign">保存角色</button>`
  });
  m.body.querySelector('#asRole').addEventListener('change', (e) => {
    m.body.querySelector('#asStaff').innerHTML = staffOptions(e.target.value, e.target.value === 'admin' ? 'supervisor' : 'agent');
  });
  m.foot.querySelector('#saveAssign').addEventListener('click', async () => {
    const role = m.body.querySelector('#asRole').value;
    const staff = m.body.querySelector('#asStaff').value;
    await api.users.update(u.id, { role, staff_role: staff });
    u.role = role;
    u.staff_role = staff;
    m.close('saved');
    rerender();
    toast('角色已更新', { type: 'success', desc: `${u.name} 现在是${role === 'admin' ? '管理员' : '普通用户'} · ${STAFF[staff]}。` });
  });
}

function resetPassword(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  confirmDialog({
    title: '重置登录密码？',
    message: `将为 ${u.name}（${u.username}）生成新的临时密码。`,
    confirmText: '重置密码',
    detail: '原密码立即失效；临时密码仅显示一次，请通过安全渠道发送给本人。'
  }).then(async (ok) => {
    if (!ok) return;
    const res = await api.users.resetPassword(u.id);
    const pwd = res.temp_password;
    const m = openModal({
      title: '临时密码已生成',
      desc: '仅显示一次，请立即复制并通过安全渠道发送。',
      size: 'sm',
      body: `<div class="pwd-box"><code id="pwdText">${esc(pwd)}</code><button class="btn btn--soft btn--sm" id="copyPwd">${icon('copy', 14)} 复制</button></div>
        <p class="pwd-hint">${icon('alertTriangle', 13)} 首次登录后必须修改密码；请勿通过群聊或邮件明文发送。</p>
        <div class="notice mt-8">${icon('info', 13)} 操作已记入审计日志：${esc(u.name)} · 重置密码 · trace_id tr_${Math.random().toString(16).slice(2, 8)}</div>`,
      footer: `<button class="btn btn--primary" data-close>完成</button>`
    });
    m.foot.querySelector('[data-close]')?.addEventListener('click', () => m.close());
    m.body.querySelector('#copyPwd').addEventListener('click', async () => {
      const btn = m.body.querySelector('#copyPwd');
      try { await navigator.clipboard.writeText(pwd); btn.textContent = '已复制'; btn.disabled = true; toast('临时密码已复制', { type: 'success', duration: 1800 }); }
      catch { toast('无法自动复制，请手动选择复制', { type: 'warning' }); }
    });
  });
}

function toggleUser(id) {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  if (u.status === 'active') {
    confirmDialog({
      title: '禁用这个账号？',
      message: `${u.name}（${u.username}）将立即无法登录。`,
      confirmText: '禁用账号',
      danger: true,
      detail: '影响：该账号立即退出登录，进行中的会话不受影响；可在同一位置重新启用。'
    }).then((ok) => {
      if (!ok) return;
      u.status = 'disabled';
      rerender();
      toast('账号已禁用', { type: 'success', desc: `${u.name} 已无法登录，操作已写入审计日志。` });
    });
  } else {
    u.status = 'active';
    rerender();
    toast('账号已启用', { type: 'success', desc: `${u.name} 可以重新登录。` });
  }
}

export async function render(root, ctx) {
  rootEl = root;
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('list'); return; }

  if (store.get().role !== 'admin') {
    root.innerHTML = forbiddenPage({ traceId: `tr_${Math.random().toString(16).slice(2, 10)}`, resource: '用户与角色' });
    root.querySelector('[data-retry]')?.addEventListener('click', () => {
      ctx.clearStateParam();
      render(root, { ...ctx, state: 'default' });
    });
    return;
  }

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="page-head"><div><h2 class="page-head__title">用户与角色</h2><p class="page-head__desc">两级角色 admin / user；业务身份挂在 user 下。</p></div></div>
      <div class="card">${emptyState({ iconName: 'users', title: '还没有账号', desc: '先创建管理员账号，再为售后坐席分配业务身份。', action: '<button class="btn btn--primary" id="emptyNewUser">新增第一个账号</button>' })}</div>`;
    root.querySelector('#emptyNewUser')?.addEventListener('click', () => { ctx.clearStateParam(); render(root, { ...ctx, state: 'default' }); });
    return;
  }

  if (!loaded) { users = await api.users.list(); loaded = true; }
  rerender();
}

export function destroy() { rootEl = null; }





