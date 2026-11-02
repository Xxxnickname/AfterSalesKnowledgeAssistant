/* qc.js — 1-7 会话质检：列表 / 消息流 / 依据 / 操作记录 / 问题标记 */
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDateTime, fmtDuration, starsHtml, toast, emptyState, skeletonPage, statusBadge } from '../components.js';

let items = [];
let filter = 'all';
let query = '';
let selectedId = null;
let detailTab = 'messages';
let notes = {};
let rootEl = null;
let loaded = false;

const QUICK_LINK = {
  '孙倩': 's_20261101_0037',
  '周浩': 's_20261101_0035',
  '刘敏': 's_20261101_0041',
  '陈雪': 's_20261101_0033',
  '赵启明': 's_20261101_0039',
  '林芳': 's_20261101_0024',
  '何俊': 's_20261101_0028',
  '沈国平': 's_20261101_0033'
};

function current() { return items.find((x) => x.id === selectedId) || null; }

function filtered() {
  const q = query.trim().toLowerCase();
  return items.filter((it) => {
    const matchQ = !q || [it.session_id, it.customer, it.company, it.agent].some((v) => String(v).toLowerCase().includes(q));
    let matchF = true;
    if (filter === 'low') matchF = it.score <= 2;
    if (filter === 'transfer') matchF = it.actions.some((a) => a.action.includes('接管') || a.action.includes('转'));
    if (filter === 'missing') matchF = it.citations.some((c) => c.verdict === 'missing');
    return matchQ && matchF;
  });
}

function statsHtml() {
  const pending = items.filter((x) => x.status === 'pending').length;
  const reviewed = items.filter((x) => x.status === 'reviewed').length;
  const low = items.filter((x) => x.score <= 2).length;
  const avg = items.reduce((n, x) => n + x.score, 0) / (items.length || 1);
  return `<div class="stat-strip">
    <div class="stat"><div class="stat__label">待质检</div><div class="stat__value">${pending}<small>条</small></div><div class="stat__foot">按低分与投诉风险优先</div></div>
    <div class="stat"><div class="stat__label">已复核</div><div class="stat__value">${reviewed}<small>条</small></div><div class="stat__foot">本月抽检完成 ${reviewed}/${items.length}</div></div>
    <div class="stat"><div class="stat__label">低分会话</div><div class="stat__value">${low}<small>条</small></div><div class="stat__foot">1–2 星 · 需逐条回访</div></div>
    <div class="stat"><div class="stat__label">平均评分</div><div class="stat__value">${avg.toFixed(1)}<small>/5</small></div><div class="stat__foot">演示样本 ${items.length} 条</div></div>
  </div>`;
}

function itemHtml(it) {
  return `<button class="qc-item ${it.id === selectedId ? 'is-active' : ''}" data-item="${esc(it.id)}">
    <div class="qc-item__top">
      <span class="qc-item__who">${esc(it.customer)} <span class="qc-item__company">· ${esc(it.company)}</span></span>
      <span class="qc-item__score">${starsHtml(it.score, 10)} ${it.score}.0</span>
    </div>
    <div class="qc-item__meta">${esc(it.session_id)} · ${esc(it.channel)} · ${esc(it.agent)}</div>
    <div class="qc-item__flags">${it.flags.length ? it.flags.map((f) => `<span class="badge badge--warning">${esc(f)}</span>`).join('') : '<span class="badge badge--success">无异常标记</span>'}</div>
    <div class="qc-item__foot"><span>${esc(fmtDateTime(it.started_at))} · ${esc(fmtDuration(it.duration_sec))}</span><span>${it.status === 'reviewed' ? '已复核' : '待质检'}</span></div>
  </button>`;
}

function listHtml() {
  return `<section class="card qc-list-card">
    <div class="qc-filters">
      <div class="search-box">${icon('search', 14)}<label class="sr-only" for="qcSearch">搜索会话</label><input class="input" id="qcSearch" placeholder="搜索会话号 / 客户 / 坐席" value="${esc(query)}" style="min-height:34px"></div>
      <div class="qc-filter-row">
        ${[['all', '全部'], ['low', '低分 ≤2'], ['transfer', '已转人工'], ['missing', '引用缺失']].map(([k, label]) => `<button class="qc-chip" data-filter="${k}" aria-pressed="${filter === k}">${label}</button>`).join('')}
      </div>
    </div>
    <div class="qc-list">${filtered().length ? filtered().map(itemHtml).join('') : emptyState({ iconName: 'shield', title: '没有匹配的会话', desc: '试试切换筛选条件或清空搜索。', action: '<button class="btn btn--primary btn--sm" data-clear-qc>清空筛选</button>', compact: true })}</div>
    <div class="pager"><span>${filtered().length} / ${items.length} 条</span><span>按评分升序</span></div>
  </section>`;
}

function messagesHtml(it) {
  return it.messages.map((m) => {
    const mine = m.role === 'agent';
    const label = m.role === 'customer' ? '客户' : m.role === 'ai' ? 'AI 助手' : m.role === 'agent' ? esc(it.agent) : '系统';
    return `<div class="qc-msg ${mine ? 'qc-msg--agent' : ''}">
      <span class="qc-msg__avatar">${m.role === 'customer' ? '客' : m.role === 'ai' ? 'AI' : '坐'}</span>
      <div class="qc-msg__main">
        <div class="qc-msg__meta">${label} · ${esc(fmtDateTime(m.at))}</div>
        <div class="qc-msg__bubble">${esc(m.text)}</div>
        ${m.citation ? `<span class="qc-cite">${icon('doc', 10)} ${esc(m.citation.doc)} · P.${esc(m.citation.page)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function citationsHtml(it) {
  if (!it.citations.length) return emptyState({ iconName: 'doc', title: '本轮没有可追溯引用', desc: '视觉识别失败或闲聊类会话可能没有引用；请人工判断是否属于应转人工场景。', compact: true });
  return `<div class="table-wrap"><table class="table" style="min-width:640px">
    <thead><tr><th>文档</th><th style="width:76px">页码</th><th>章节</th><th style="width:110px">校验</th><th>备注</th></tr></thead>
    <tbody>${it.citations.map((c) => `<tr>
      <td class="cell-title">${esc(c.doc)}</td>
      <td class="mono">P.${esc(c.page)}</td>
      <td>${esc(c.section)}</td>
      <td>${c.verdict === 'valid' ? '<span class="badge badge--success badge--dot">可追溯</span>' : '<span class="badge badge--danger badge--dot">缺失</span>'}</td>
      <td class="muted" style="font-size:var(--fs-12)">${esc(c.note)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function actionsHtml(it) {
  return `<div class="qc-timeline">${it.actions.map((a) => `<div class="qc-time-item">
    <span class="qc-time-dot">${icon(a.action.includes('评价') ? 'star' : a.action.includes('转') || a.action.includes('接管') ? 'headset' : a.action.includes('上传') ? 'image' : a.action.includes('生成') ? 'spark' : 'activity', 12)}</span>
    <div class="qc-time-main"><div class="qc-time-title">${esc(a.actor)} · ${esc(a.action)}</div><div class="qc-time-sub">${esc(a.detail)}</div></div>
    <span class="qc-time-at">${esc(fmtDateTime(a.at))}</span>
  </div>`).join('')}</div>`;
}

function detailHtml(it) {
  if (!it) return `<section class="card qc-detail">${emptyState({ iconName: 'shield', title: '请选择一条会话', desc: '从左侧列表选择会话，查看消息流、引用依据与操作记录。' })}</section>`;
  const jump = QUICK_LINK[it.customer] || 's_20261101_0042';
  const note = notes[it.id] ?? '';
  return `<section class="card qc-detail">
    <div class="qc-detail__head">
      <div class="qc-detail__title">
        <span class="qc-detail__id mono">${esc(it.session_id)}</span>
        ${statusBadge(it.status === 'reviewed' ? 'CLOSED' : 'WAITING', it.status === 'reviewed' ? '已复核' : '待质检')}
        <span class="badge badge--${it.score <= 2 ? 'danger' : 'success'}">${starsHtml(it.score, 10)} ${it.score}.0 星</span>
        ${it.issue_type ? `<span class="badge badge--warning">${esc(it.issue_type)}</span>` : ''}
      </div>
      <div class="qc-detail__meta">
        <span>客户 <strong>${esc(it.customer)} · ${esc(it.company)}</strong></span>
        <span>坐席 <strong>${esc(it.agent)}</strong></span>
        <span>渠道 <strong>${esc(it.channel)}</strong></span>
        <span>时长 <strong>${esc(fmtDuration(it.duration_sec))}</strong></span>
        <span>trace <strong class="mono">${esc(it.trace_id)}</strong></span>
      </div>
    </div>
    <div class="qc-tabs"><div class="tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="${detailTab === 'messages'}" data-dtab="messages">消息流 <span class="count">${it.messages.length}</span></button>
      <button class="tab" role="tab" aria-selected="${detailTab === 'citations'}" data-dtab="citations">依据 <span class="count">${it.citations.length}</span></button>
      <button class="tab" role="tab" aria-selected="${detailTab === 'actions'}" data-dtab="actions">操作记录 <span class="count">${it.actions.length}</span></button>
    </div></div>
    <div class="qc-body">${detailTab === 'messages' ? messagesHtml(it) : detailTab === 'citations' ? citationsHtml(it) : actionsHtml(it)}</div>
    <div class="qc-review">
      <div class="qc-review__row">
        <div class="field"><label class="label" for="qcIssue">问题类型</label>
          <select class="select" id="qcIssue">${['无问题', '答非所问', '引用错误', '响应超时', '重复回答', '多模态失败', '未及时转人工'].map((x) => `<option ${it.issue_type === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        </div>
        <div class="field"><label class="label" for="qcNote">质检备注</label><input class="input" id="qcNote" placeholder="记录判定依据或整改建议…" value="${esc(note)}" maxlength="200"></div>
        <button class="btn btn--primary" id="saveQc">${icon('check', 15)} 保存质检结果</button>
      </div>
      <div class="qc-review__actions">
        <span class="qc-review__hint">${icon('info', 12)} 保存后状态变为「已复核」，并写入审计日志。</span>
        <a class="btn btn--ghost btn--sm" href="#/workbench?session=${esc(jump)}">${icon('external', 13)} 跳回原会话</a>
      </div>
    </div>
  </section>`;
}

function shellHtml() {
  return `<div class="qc-page">
    <div class="page-head">
      <div><h2 class="page-head__title">会话质检</h2><p class="page-head__desc">抽检低分、转人工与引用异常会话；标记问题类型并回写改进项。</p></div>
      <div class="page-head__actions"><span class="badge badge--brand badge--dot">本周抽检 8 条</span><button class="btn btn--sm" id="qcExport">${icon('download', 14)} 导出质检报告</button></div>
    </div>
    <div class="notice notice--brand" style="margin-bottom:var(--sp-4);font-size:var(--fs-14)">
      ${icon('info', 15)} <span><strong>会话质检不是知识入库。</strong>它抽检真实会话，标记答非所问、引用错误、超时等问题，结果进入整改与 FAQ 候选；新增或修改知识请到 <a href="#/kb">知识库管理</a>。</span>
    </div>
    ${statsHtml()}
    <div class="qc-layout">${listHtml()}${detailHtml(current())}</div>
  </div>`;
}

function rerender() {
  if (!rootEl) return;
  rootEl.innerHTML = shellHtml();
  bind();
}

function bind() {
  const root = rootEl;
  root.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', () => {
    selectedId = b.dataset.item;
    detailTab = 'messages';
    rerender();
  }));
  root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; rerender(); }));
  root.querySelector('#qcSearch')?.addEventListener('input', (e) => {
    query = e.target.value;
    rerender();
    const next = rootEl.querySelector('#qcSearch');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  root.querySelector('[data-clear-qc]')?.addEventListener('click', () => { filter = 'all'; query = ''; rerender(); });
  root.querySelectorAll('[data-dtab]').forEach((b) => b.addEventListener('click', () => { detailTab = b.dataset.dtab; rerender(); }));
  root.querySelector('#qcNote')?.addEventListener('input', (e) => { notes[selectedId] = e.target.value; });
  root.querySelector('#saveQc')?.addEventListener('click', () => {
    const it = current();
    if (!it) return;
    const issue = root.querySelector('#qcIssue').value;
    const note = root.querySelector('#qcNote').value.trim();
    it.issue_type = issue === '无问题' ? null : issue;
    it.status = 'reviewed';
    notes[it.id] = note;
    rerender();
    toast('质检结果已保存', { type: 'success', desc: `${it.session_id} 已标记为「${issue}」，已写入审计日志。` });
  });
  root.querySelector('#qcExport')?.addEventListener('click', () => toast('质检报告已生成', { type: 'success', desc: 'G1 演示：导出将在 G2 由 /api/qc/export 生成。' }));
}

export async function render(root, ctx) {
  rootEl = root;
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('split'); return; }
  if (!loaded) { items = await api.qc.getAll(); loaded = true; }

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="page-head"><div><h2 class="page-head__title">会话质检</h2><p class="page-head__desc">抽检低分、转人工与引用异常会话。</p></div></div>
      <div class="card">${emptyState({ iconName: 'shieldCheck', title: '本周还没有质检样本', desc: '抽样任务会在每天 09:00 生成；也可以先去看板查看差评反馈。', action: '<a class="btn btn--primary" href="#/dashboard">打开数据看板</a>' })}</div>`;
    return;
  }

  if (!selectedId || !items.some((x) => x.id === selectedId)) {
    selectedId = (items.slice().sort((a, b) => a.score - b.score)[0] || {}).id || null;
  }
  rerender();
}

export function destroy() { rootEl = null; }








