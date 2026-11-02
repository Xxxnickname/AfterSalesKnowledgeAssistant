/* workbench.js — 1-3 坐席工作台：三栏 / 接管 / 409 / 并发上限 / 交接包 */
import { api } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import {
  esc, fmtDateTime, fmtDuration, toast, openModal, openDrawer, confirmDialog,
  emptyState, skeletonPage, statusBadge
} from '../components.js';

let sessions = [];
let selectedId = null;
let tab = 'waiting';
let draft = '';
let rootEl = null;
let busyId = null;

const QUICK_REPLIES = [
  '我已远程查看设备日志，请稍等 2 分钟。',
  '请拍一张报警界面的照片发给我，注意包含报警代码。',
  '这个故障需要工程师上门，我先帮你创建服务工单。'
];

function clock(value) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function waitText(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function selected() { return sessions.find((s) => s.id === selectedId) || null; }
function myActive() { return sessions.filter((s) => s.status === 'ACTIVE' && s.taken_by === '陈立'); }
function byTab(t) { return sessions.filter((s) => s.status === (t === 'waiting' ? 'WAITING' : 'ACTIVE')); }

function applySavedState() {
  const saved = store.get().workbench || {};
  for (const id of saved.takenIds || []) {
    const s = sessions.find((x) => x.id === id);
    if (s && s.status === 'WAITING' && !s.locked_by) {
      s.status = 'ACTIVE';
      s.taken_by = '陈立';
      s.started_at = s.started_at || new Date().toISOString();
    }
  }
  return saved;
}

/* ---------------- 片段 ---------------- */
function sessionItem(s) {
  const active = s.id === selectedId;
  const prio = s.customer.level === 'VIP' ? '' : s.customer.tags.includes('投诉风险') ? '' : 'wb-prio--mid';
  return `<button class="wb-session ${active ? 'is-active' : ''}" data-session="${esc(s.id)}" aria-current="${active ? 'true' : 'false'}">
    <div class="wb-session__top">
      <span class="wb-session__name"><span class="wb-prio ${prio}"></span><span class="avatar">${esc(s.customer.name.slice(0, 1))}</span>${esc(s.customer.name)}</span>
      <span class="wb-session__time">${s.status === 'WAITING' ? waitText(s.wait_seconds) : clock(s.started_at || s.last_at)}</span>
    </div>
    <div class="wb-session__company">${esc(s.customer.company)} · ${esc(s.customer.device.model)}</div>
    <div class="wb-session__msg">${esc(s.last_message)}</div>
    <div class="wb-session__foot">
      ${s.locked_by ? `<span class="wb-lock">${icon('lock', 11)} ${esc(s.locked_by)} 锁定</span>` : ''}
      ${s.status === 'ACTIVE' ? `<span class="badge badge--success">${esc(s.taken_by === '陈立' ? '我处理中' : (s.taken_by || '已接管'))}</span>` : `<span class="badge badge--warning">待接入</span>`}
      <span class="badge badge--neutral">${esc(s.channel)}</span>
      ${s.customer.tags.slice(0, 1).map((t) => `<span class="badge badge--neutral">${esc(t)}</span>`).join('')}
    </div>
  </button>`;
}

function queueHtml() {
  const list = byTab(tab);
  const saved = store.get().workbench || {};
  const taken = new Set(saved.takenIds || []);
  const waiting = sessions.filter((s) => s.status === 'WAITING');
  const active = sessions.filter((s) => s.status === 'ACTIVE');
  return `<section class="wb-col wb-queue" aria-label="会话队列">
    <div class="wb-col__head" style="padding-bottom:0;border-bottom:0">
      <div class="wb-col__title">会话队列 <span class="badge badge--neutral">${sessions.length}</span></div>
      <div class="wb-col__sub">按等待时长与优先级排序</div>
    </div>
    <div class="wb-tabs" role="tablist" aria-label="队列筛选">
      <button class="wb-tab" role="tab" aria-selected="${tab === 'waiting'}" data-tab="waiting">待接入 <span class="n">${waiting.length}</span></button>
      <button class="wb-tab" role="tab" aria-selected="${tab === 'active'}" data-tab="active">进行中 <span class="n">${active.length}</span></button>
    </div>
    <div class="wb-list" role="tabpanel">
      ${list.length ? list.map(sessionItem).join('') : `<div class="wb-nodata">${tab === 'waiting' ? '暂无待接入会话，队列已清空。' : '暂无进行中的会话。'}</div>`}
    </div>
    <div style="flex:none;padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--line);font-size:var(--fs-12);color:var(--ink-500)">
      单坐席并发 ${myActive().length}/5 · 超时 60 秒自动回队
    </div>
  </section>`;
}

function handoverHtml(s) {
  const h = s.handover || {};
  const collected = Object.entries(h.collected || {});
  const docs = h.top_docs || [];
  return `<details class="wb-handover" open>
    <summary>
      <span class="wb-handover__title">${icon('inbox', 14)} 交接包 <span class="badge badge--success">4/4 段完整</span></span>
      <span class="wb-handover__summary">${esc(h.summary || '')}</span>
      ${icon('chevronDown', 14, 'wb-handover__chev')}
    </summary>
    <div class="wb-handover__body">
      <div class="wb-ho">
        <div class="wb-ho__summary">
          <span class="wb-ho__k"><i>1</i> 摘要</span>
          <p>${esc(h.summary || '—')}</p>
        </div>
        <div class="wb-ho__grid">
          <div class="wb-ho__cell">
            <span class="wb-ho__k"><i>2</i> 已收集信息</span>
            <dl class="wb-ho__kv">${collected.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          </div>
          <div class="wb-ho__cell">
            <span class="wb-ho__k"><i>3</i> AI 建议</span>
            <p class="wb-ho__p" title="${esc(h.ai_suggestion || '')}">${esc(h.ai_suggestion || '—')}</p>
            <span class="wb-ho__k wb-ho__k--sub"><i>4</i> 推荐知识 Top3</span>
            <div class="wb-ho__docs">${docs.map((d, i) => `<div class="wb-ho__doc"><span class="no">0${i + 1}</span><span class="nm" title="${esc(d.doc)} · P.${esc(d.page)} · ${esc(d.section)}">${esc(d.doc)} · P.${esc(d.page)} · ${esc(d.section)}</span><span class="sc">${Number(d.score).toFixed(2)}</span></div>`).join('')}</div>
          </div>
        </div>
      </div>
    </div>
  </details>`;
}
function messagesHtml(s) {
  return s.messages.map((m) => {
    if (m.role === 'system') return `<div class="wb-msg wb-msg--system"><span class="wb-msg__system">${esc(m.text)}</span></div>`;
    const mine = m.role === 'agent';
    const who = m.role === 'customer' ? esc(s.customer.name.slice(0, 1)) : m.role === 'ai' ? 'AI' : esc((s.taken_by || '坐').slice(0, 1));
    return `<div class="wb-msg ${mine ? 'wb-msg--agent' : ''}">
      <span class="wb-msg__avatar">${who}</span>
      <div class="wb-msg__main">
        <div class="wb-msg__meta">${m.role === 'customer' ? esc(s.customer.name) : m.role === 'ai' ? 'AI 助手' : esc(s.taken_by || '坐席')} · ${esc(fmtDateTime(m.at))}</div>
        <div class="wb-msg__bubble">${esc(m.text)}</div>
        ${m.citation ? `<span class="wb-cite">${icon('doc', 10)} ${esc(m.citation.doc)} · P.${esc(m.citation.page)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function mainHtml(s) {
  if (!s) {
    return `<section class="wb-col wb-main">${emptyState({ iconName: 'headset', title: '请选择一个会话', desc: '从左侧待接入队列选择会话，查看交接包并接管。' })}</section>`;
  }
  const mine = s.status === 'ACTIVE' && s.taken_by === '陈立';
  const other = s.status === 'ACTIVE' && s.taken_by !== '陈立';
  const waiting = s.status === 'WAITING';
  const locked = Boolean(s.locked_by);
  return `<section class="wb-col wb-main" aria-label="会话详情">
    <div class="wb-main__head">
      <div class="wb-main__who">
        <span class="avatar avatar--dark">${esc(s.customer.name.slice(0, 1))}</span>
        <div>
          <div class="wb-main__name">${esc(s.customer.name)}</div><div class="wb-main__company">${esc(s.customer.company)}</div>
          <div class="wb-main__meta"><span class="mono">${esc(s.id)}</span> · ${esc(s.channel)}渠道 · ${statusBadge(s.status)}</div>
        </div>
      </div>
      <div class="wb-main__actions">
        ${waiting ? `<button class="btn btn--primary btn--sm" id="takeoverBtn" aria-label="${locked ? '会话已被接管' : '接管会话'}" ${busyId === s.id ? 'disabled' : ''}>${icon(locked ? 'lock' : 'headset', 14)} <span>${locked ? `已被${esc(s.locked_by)}锁定` : '接管会话'}</span></button>` : ''}
        ${mine ? `<span class="badge badge--success badge--dot">我处理中</span><button class="btn btn--sm" id="transferBtn">转接</button><button class="btn btn--danger-ghost btn--sm" id="endBtn">结束</button>` : ''}
        ${other ? `<span class="badge badge--warning">${esc(s.taken_by)} 处理中</span>` : ''}
      </div>
    </div>
    ${handoverHtml(s)}
    <div class="wb-stream" id="wbStream" aria-live="polite">${messagesHtml(s)}</div>
    <div class="wb-composer">
      <div class="wb-composer__box">
        <label class="sr-only" for="wbInput">回复客户</label>
        <textarea id="wbInput" rows="1" placeholder="${mine ? '输入回复，Enter 发送…' : waiting ? '接管后即可回复客户' : '当前会话由其他坐席处理'}" ${mine ? '' : 'disabled'}>${esc(draft)}</textarea>
        <button class="composer__send" id="wbSend" aria-label="发送回复" ${mine ? '' : 'disabled'}>${icon('send', 16)}</button>
      </div>
      <div class="wb-composer__hint"><span>${icon('shieldCheck', 11)} 回复将记入会话记录与审计</span><span class="mono">${esc(s.customer.device.model)} · ${esc(s.customer.device.serial)}</span></div>
    </div>
  </section>`;
}

function sideHtml(s) {
  if (!s) return `<aside class="wb-side"></aside>`;
  const c = s.customer;
  const docs = s.handover?.top_docs || [];
  return `<aside class="wb-side" aria-label="客户信息与推荐知识">
    <div class="wb-side-card">
      <div class="wb-side-card__head"><span class="wb-side-card__title">客户信息</span><span class="badge badge--${c.level === 'VIP' ? 'warning' : 'neutral'}">${esc(c.level)}</span></div>
      <div class="wb-side-card__body">
        <div class="wb-customer">
          <span class="avatar avatar--lg avatar--${c.level === 'VIP' ? 'warm' : 'blue'}">${esc(c.name.slice(0, 1))}</span>
          <div class="grow"><div class="wb-customer__name">${esc(c.name)}</div><div class="wb-customer__company">${esc(c.company)}</div></div>
        </div>
        <div class="wb-tags">${c.tags.map((t) => `<span class="badge badge--neutral">${esc(t)}</span>`).join('')}</div>
        <dl class="wb-kv">
          <dt>联系电话</dt><dd class="mono">${esc(c.phone)}</dd>
          <dt>所在地区</dt><dd>${esc(c.region)}</dd>
          <dt>设备型号</dt><dd>${esc(c.device.name)} · ${esc(c.device.model)}</dd>
          <dt>设备序列号</dt><dd class="mono">${esc(c.device.serial)}</dd>
          <dt>购买日期</dt><dd class="mono">${esc(c.device.purchased_at)}</dd>
          <dt>保修到期</dt><dd class="mono">${esc(c.device.warranty_until)}</dd>
        </dl>
      </div>
    </div>
    <div class="wb-side-card">
      <div class="wb-side-card__head"><span class="wb-side-card__title">推荐知识 Top3</span><span class="badge badge--brand">混合检索</span></div>
      <div class="wb-side-card__body">
        <div class="wb-recs">${docs.map((d, i) => `<button class="wb-rec" data-doc="${i}"><span class="wb-rec__no">${i + 1}</span><span class="wb-rec__main"><span class="wb-rec__name">${esc(d.doc)}</span><span class="wb-rec__meta">P.${esc(d.page)} · ${esc(d.section)}</span></span><span class="wb-rec__score">${Number(d.score).toFixed(2)}</span></button>`).join('')}</div>
      </div>
    </div>
    <div class="wb-side-card">
      <div class="wb-side-card__head"><span class="wb-side-card__title">快捷回复</span><span class="muted" style="font-size:var(--fs-12);color:var(--ink-500)">点击填入</span></div>
      <div class="wb-side-card__body"><div class="wb-quick">${QUICK_REPLIES.map((q) => `<button data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>
    </div>
    <div class="wb-side-card">
      <div class="wb-side-card__body">
        <div class="wb-sla"><div><div class="wb-sla__label">本次首响</div><div class="wb-sla__num">00:38</div></div><div style="text-align:right"><div class="wb-sla__label">目标</div><div class="strong num" style="font-size:var(--fs-18)">≤ 02:00</div></div></div>
        <div class="progress" style="margin-top:var(--sp-3)"><div class="progress__bar progress__bar--success" style="width:32%"></div></div>
        <div class="row-between mt-4" style="font-size:var(--fs-12);color:var(--ink-500)"><span>已响应</span><span>超时风险低</span></div>
      </div>
    </div>
  </aside>`;
}

function shellHtml() {
  const s = selected();
  return `<div class="workbench">
    <div class="wb-head">
      <div class="page-head">
        <div>
          <h2 class="page-head__title">坐席工作台</h2>
          <p class="page-head__desc">接管会话后，交接包、消息流与客户信息在同一屏完成处理。</p>
        </div>
        <div class="page-head__actions">
          <span class="wb-agent-status"><span class="dot"></span> 在线 · 可接入</span>
          <button class="btn btn--sm" id="refreshBtn">${icon('refresh', 14)} 刷新队列</button>
        </div>
      </div>
      <div class="wb-metrics">
        <span class="wb-metric">待接入 <strong>${sessions.filter((x) => x.status === 'WAITING').length}</strong></span><span class="sep"></span>
        <span class="wb-metric">进行中 <strong>${sessions.filter((x) => x.status === 'ACTIVE').length}</strong></span><span class="sep"></span>
        <span class="wb-metric">我的并发 <strong>${myActive().length}/5</strong></span><span class="sep"></span>
        <span class="wb-metric">在线坐席 <strong>5</strong></span>
        <span class="muted" style="font-size:var(--fs-12);margin-left:auto">最后刷新 ${fmtDateTime(new Date().toISOString()).slice(11, 19)}</span>
      </div>
    </div>
    <div class="wb-grid">${queueHtml()}${mainHtml(s)}${sideHtml(s)}</div>
  </div>`;
}

/* ---------------- 绑定 ---------------- */
function bind() {
  const root = rootEl;
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    rerender();
  }));
  root.querySelectorAll('[data-session]').forEach((b) => b.addEventListener('click', () => {
    selectedId = b.dataset.session;
    draft = '';
    store.patchSection('workbench', { selectedId });
    rerender();
  }));
  root.querySelector('#refreshBtn')?.addEventListener('click', () => {
    toast('队列已刷新', { type: 'success', desc: '已按等待时长重新排序。' });
    rerender();
  });
  root.querySelector('#takeoverBtn')?.addEventListener('click', () => { const s = selected(); if (s) takeover(s); });
  root.querySelector('#endBtn')?.addEventListener('click', () => { const s = selected(); if (s) endSession(s); });
  root.querySelector('#transferBtn')?.addEventListener('click', () => {
    toast('已转接至售后二组', { type: 'info', desc: 'G1 演示：G2 将写入转接记录并通知目标坐席。' });
  });

  const input = root.querySelector('#wbInput');
  const send = root.querySelector('#wbSend');
  input?.addEventListener('input', () => { draft = input.value; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 72)}px`; });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendReply(); }
  });
  send?.addEventListener('click', sendReply);

  root.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    if (!input || input.disabled) { toast('请先接管会话', { type: 'warning' }); return; }
    input.value = b.dataset.quick;
    draft = input.value;
    input.focus();
    input.dispatchEvent(new Event('input'));
  }));
  root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => {
    const s = selected();
    if (!s) return;
    const d = s.handover.top_docs[Number(b.dataset.doc)];
    openDocDrawer(d, s);
  }));

  requestAnimationFrame(() => {
    const stream = root.querySelector('#wbStream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  });
}

function rerender() {
  if (!rootEl) return;
  rootEl.innerHTML = shellHtml();
  bind();
}

/* ---------------- 操作 ---------------- */
async function takeover(s) {
  if (s.locked_by) {
    const dialog = openModal({
      title: '接管失败 · 409 CONFLICT',
      desc: '同一会话同一时刻只允许一名坐席接管',
      size: 'sm',
      body: `<div class="notice notice--warning">${icon('alertTriangle', 15)} 该会话已被 <strong>${esc(s.locked_by)}</strong> 接管，请勿重复操作。刷新列表可查看最新状态。</div>
        <dl class="kv mt-8"><dt>会话编号</dt><dd class="mono">${esc(s.id)}</dd><dt>当前处理人</dt><dd>${esc(s.locked_by)}</dd><dt>HTTP 状态</dt><dd class="mono">409</dd></dl>`,
      footer: `<button class="btn" data-close>知道了</button><button class="btn btn--primary" id="conflictRefresh">刷新列表</button>`
    });
    dialog.foot.querySelector('#conflictRefresh').addEventListener('click', () => { dialog.close(); rerender(); });
    return;
  }
  if (s.status !== 'WAITING') return;
  if (myActive().length >= 5) {
    toast('已达单坐席并发上限 5', { type: 'warning', desc: '请先结束一个进行中的会话，再接新会话。' });
    return;
  }
  busyId = s.id;
  rerender();
  try {
    await api.sessions.takeover(s.id);
    s.status = 'ACTIVE';
    s.taken_by = '陈立';
    s.started_at = new Date().toISOString();
    const saved = store.get().workbench || {};
    store.patchSection('workbench', { takenIds: [...new Set([...(saved.takenIds || []), s.id])], selectedId: s.id });
    tab = 'active';
    busyId = null;
    selectedId = s.id;
    rerender();
    toast('接管成功', { type: 'success', desc: `你已接管 ${s.customer.name} 的会话，可以开始回复。` });
  } catch (err) {
    busyId = null;
    rerender();
    toast('接管失败', { type: 'error', desc: err?.message || '请稍后重试。' });
  }
}

async function sendReply() {
  const s = selected();
  if (!s) return;
  if (s.status !== 'ACTIVE' || s.taken_by !== '陈立') { toast('请先接管会话', { type: 'warning' }); return; }
  const input = rootEl.querySelector('#wbInput');
  const text = (input?.value || '').trim();
  if (!text) return;
  const msg = { id: `m_${Date.now()}`, role: 'agent', text, at: new Date().toISOString() };
  s.messages.push(msg);
  s.last_message = text;
  s.last_at = msg.at;
  draft = '';
  rerender();
  try { await api.sessions.reply(s.id, text); } catch { /* mock 无失败分支 */ }
  toast('回复已发送', { type: 'success', duration: 1800 });
}

async function endSession(s) {
  const ok = await confirmDialog({
    title: '结束当前会话？',
    message: `即将结束 ${s.customer.name}（${s.customer.company}）的会话。`,
    confirmText: '结束会话',
    danger: true,
    detail: '结束后会话进入质检抽样，客户将收到满意度评价入口；该操作不可撤销。'
  });
  if (!ok) return;
  try {
    await api.sessions.close(s.id, '已解决');
  } catch (err) {
    toast('结束会话失败', { type: 'error', desc: err?.message || '请稍后重试。' });
    return;
  }
  s.status = 'CLOSED';
  s.last_message = '会话已由坐席结束';
  s.last_at = new Date().toISOString();
  const next = sessions.find((x) => x.status === 'WAITING');
  selectedId = next ? next.id : null;
  store.patchSection('workbench', { selectedId });
  tab = next ? 'waiting' : 'active';
  rerender();
  toast('会话已结束', { type: 'success', desc: '已标记为「已解决」，可在会话质检中复核。' });
}

function openDocDrawer(d, s) {
  openDrawer({
    title: d.doc,
    sub: `第 ${d.page} 页 · ${d.section} · 相关度 ${Number(d.score).toFixed(2)}`,
    body: `
      <div class="notice notice--brand">${icon('spark', 15)} 该片段由 BM25 + 向量混合检索召回，经 bge-reranker 重排后进入 Top3。</div>
      <section class="handover-section">
        <div class="handover-title"><span class="step">1</span> 命中片段</div>
        <p class="handover-text">当前会话的检索片段已锁定到「${esc(d.section)}」。G1 演示环境不加载 42MB 手册原文件；G2 将由 <span class="mono">/api/kb/chunks</span> 返回原文与页码锚点。</p>
      </section>
      <section class="handover-section">
        <div class="handover-title"><span class="step">2</span> 为什么推荐</div>
        <p class="handover-text">设备型号 ${esc(s.customer.device.model)} 匹配文档适用范围；故障描述与章节标题语义相似；引用可回溯到具体页码。</p>
      </section>
      <section class="handover-section">
        <div class="handover-title"><span class="step">3</span> 使用建议</div>
        <p class="handover-text">先按章节步骤向客户复述关键动作，再把页码发给客户；若客户执行后仍报警，按交接包中的 AI 建议升级为上门工单。</p>
      </section>`,
    footer: `<button class="btn" data-close>关闭</button><a class="btn btn--primary" href="#/kb">打开知识库 ${icon('arrowRight', 15)}</a>`
  });
}

/* ---------------- 入口 ---------------- */
export async function render(root, ctx) {
  rootEl = root;
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('split'); return; }

  const data = await api.sessions.getWorkbench();
  sessions = [...data.waiting, ...data.active].map((s) => structuredClone(s));
  const saved = applySavedState();

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="workbench">
      <div class="wb-head"><div class="page-head"><div><h2 class="page-head__title">坐席工作台</h2><p class="page-head__desc">接管会话后，交接包、消息流与客户信息在同一屏完成处理。</p></div></div></div>
      <div class="card" style="flex:1">${emptyState({ iconName: 'headset', title: '当前没有待接入会话', desc: '队列已清空。新会话进入后会出现在左侧，并按等待时长排序。', action: '<button class="btn btn--primary" data-empty-refresh>刷新队列</button>' })}</div>
    </div>`;
    root.querySelector('[data-empty-refresh]')?.addEventListener('click', () => {
      ctx.clearStateParam();
      render(root, { ...ctx, state: 'default' });
    });
    return;
  }

  const paramId = ctx.params.get('session');
  if (paramId && sessions.some((s) => s.id === paramId)) selectedId = paramId;
  else if (paramId) toast('未找到指定会话，已为你选择队首会话', { type: 'info' });
  if (!selectedId || !sessions.some((s) => s.id === selectedId)) {
    selectedId = saved.selectedId && sessions.some((s) => s.id === saved.selectedId)
      ? saved.selectedId
      : (sessions.find((s) => s.status === 'WAITING') || sessions[0])?.id || null;
  }
  const picked = selected();
  tab = picked?.status === 'ACTIVE' ? 'active' : 'waiting';
  rerender();
}

export function destroy() {
  rootEl = null;
  draft = '';
  busyId = null;
}










