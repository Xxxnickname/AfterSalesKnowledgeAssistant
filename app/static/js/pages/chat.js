/* chat.js — 1-1 客户聊天窗（含 1-2 评价弹层、转人工交接包） */
import { api } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import {
  esc, fmtDateTime, starsHtml, toast, openModal, openDrawer, confirmDialog,
  emptyState, skeletonPage
} from '../components.js';

const state = {
  faq: null,
  messages: [],
  escalated: false,
  escalation: null,
  feedback: null,
  ended: false,
  sessionId: null,
  busy: false,
  attachments: [],
  imageUrls: new Map(),
  seq: 0
};
let aborter = null;
let rootEl = null;
let ctxRef = null;

const RATING_LABEL = { 1: '很不满意', 2: '不满意', 3: '一般', 4: '满意', 5: '非常满意' };
const RATING_TAGS = ['回答准确', '处理很快', '态度友好', '没有解决', '答非所问', '引用看不懂'];

function nowISO() { return new Date().toISOString(); }
function clock(value) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function nextId(prefix = 'm') { return `${prefix}_${Date.now()}_${++state.seq}`; }

function welcomeMessage() {
  return {
    id: 'm_welcome',
    role: 'ai',
    text: state.faq?.greeting || '你好，我是恒锐精工售后助手。',
    at: nowISO(),
    welcome: true
  };
}

function loadState() {
  const saved = store.get().chat;
  state.messages = Array.isArray(saved.messages) && saved.messages.length ? saved.messages : [welcomeMessage()];
  state.escalated = Boolean(saved.escalated);
  state.escalation = saved.escalation || null;
  state.feedback = saved.feedback || null;
  state.ended = Boolean(saved.ended);
  state.sessionId = saved.sessionId || null;
}

function persist() {
  store.patchSection('chat', {
    messages: state.messages,
    escalated: state.escalated,
    escalation: state.escalation,
    feedback: state.feedback,
    ended: state.ended,
    sessionId: state.sessionId
  });
}

/* ---------------- 渲染 ---------------- */
function citationsHtml(citations = []) {
  if (!citations.length) return '';
  return `<div class="citations">${citations.map((c) => `
    <details class="citation">
      <summary>
        <span class="citation__icon">${icon('doc', 14)}</span>
        <span class="citation__label">
          <strong>依据：${esc(c.doc)} · 第 ${esc(c.page)} 页</strong>
          <span>${esc(c.section || '')}${c.version ? ` · ${esc(c.version)}` : ''}</span>
        </span>
        ${icon('chevronDown', 14, 'citation__chev')}
      </summary>
      <div class="citation__body">
        <div class="citation__quote">${esc(c.excerpt || '（原文摘录暂缺）')}</div>
        <div class="citation__foot">
          <span>手册原文摘录 · 仅供售后处理参考</span>
          <button class="btn btn--link btn--sm" data-doc="${esc(c.doc)}" data-page="${esc(c.page)}">查看手册目录</button>
        </div>
      </div>
    </details>`).join('')}</div>`;
}

function messageHtml(m) {
  if (m.role === 'system') {
    return `<div class="message message--system"><span class="system-pill">${icon('info', 13)} ${esc(m.text)}</span></div>`;
  }
  const mine = m.role === 'user';
  const url = state.imageUrls.get(m.id);
  const imageHtml = m.image ? `<div class="bubble__image">${url ? `<img src="${url}" alt="上传图片预览">` : icon('image', 20)}<span>${esc(m.image.name)} · ${esc(m.image.size)}</span></div>` : '';
  const followups = (!mine && m.followups?.length) ? `<div class="row-wrap" style="margin-top:var(--sp-4)">${m.followups.map((q) => `<button class="chip" data-followup="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '';
  return `<div class="message ${mine ? 'message--user' : 'message--ai'}">
    <span class="msg-avatar" aria-hidden="true">${mine ? '我' : 'AI'}</span>
    <div class="msg-main">
      ${mine ? '' : '<div class="msg-name">售后智能助手</div>'}
      <div class="bubble">${imageHtml}${esc(m.text)}</div>
      ${citationsHtml(m.citations || [])}
      ${followups}
      <div class="msg-time" title="${esc(fmtDateTime(m.at))}">${clock(m.at)}</div>
    </div>
  </div>`;
}

function streamHtml() {
  const showTyping = state.busy;
  return `<div class="chat-day"><span>今天 · ${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date())}</span></div>
    ${state.messages.map(messageHtml).join('')}
    ${showTyping ? `<div class="message message--ai" id="typingRow"><span class="msg-avatar">AI</span><div class="msg-main"><div class="msg-name">售后智能助手</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div></div>` : ''}`;
}

function queueHtml() {
  if (!state.escalated) return '';
  const data = state.escalation || {};
  return `<div class="queue-banner" role="status">
    <span class="queue-banner__icon">${icon('headset', 16)}</span>
    <div class="queue-banner__main">
      <div class="queue-banner__title">已转人工 · 当前排队第 ${esc(data.queue_position ?? 2)} 位</div>
      <div class="queue-banner__sub">预计等待 ${esc(data.eta_min ?? 3)} 分钟 · 服务时间 ${esc(data.business_hours || '09:00–21:00')} · 请保持页面打开</div>
    </div>
    <button class="btn btn--sm" id="viewHandoverBtn">${icon('inbox', 14)} 查看交接包</button>
  </div>`;
}

function quickHtml() {
  const onlyWelcome = state.messages.filter((m) => m.role !== 'system').length <= 1;
  if (!onlyWelcome || state.escalated || state.ended || state.busy) return '';
  return `<div class="quick-block">
    <div class="quick-title">${icon('spark', 13)} 常见问题 · 点击直接提问</div>
    <div class="quick-grid">
      ${(state.faq?.quick_questions || []).map((q) => `<button class="quick-btn" data-question="${esc(q)}">${icon('chat', 14)}<span>${esc(q)}</span>${icon('arrowRight', 13)}</button>`).join('')}
    </div>
  </div>`;
}

function composerHtml() {
  const locked = state.escalated || state.ended;
  const placeholder = state.ended
    ? '本次会话已结束，感谢你的反馈。'
    : state.escalated ? '已转人工，请等待坐席接入…' : '描述设备型号、报警代码或现象…';
  return `<div class="composer">
    <div id="attachSlot">${state.attachments.map((a, i) => `<div class="attach-chip"><img src="${a.url}" alt="待发送图片预览"><div class="grow"><strong>${esc(a.name)}</strong><span>${esc(a.size)} · 待发送</span></div><button class="icon-btn" data-remove-attach="${i}" aria-label="移除图片">${icon('close', 14)}</button></div>`).join('')}</div>
    <div class="composer__box">
      <button class="icon-btn" id="imageBtn" aria-label="上传设备照片" ${locked ? 'disabled' : ''}>${icon('image', 18)}</button>
      <label class="sr-only" for="chatInput">输入问题</label>
      <textarea class="composer__input" id="chatInput" rows="1" maxlength="1000" placeholder="${esc(placeholder)}" ${locked ? 'disabled' : ''}></textarea>
      <div class="composer__tools">
        <button class="composer__send" id="sendBtn" aria-label="发送消息" ${locked ? 'disabled' : ''}>${icon('send', 17)}</button>
      </div>
    </div>
    <div class="composer__foot">
      <span>${icon('shieldCheck', 12)} 回答引用官方手册原文</span>
      <span class="hide-mobile">Enter 发送 · Shift + Enter 换行</span>
    </div>
  </div>`;
}

function shellHtml() {
  const feedbackBadge = state.feedback ? `<span class="badge badge--success">${starsHtml(state.feedback.score, 10)} 已评价</span>` : '';
  return `<div class="chat-page">
    <aside class="chat-aside">
      <div class="chat-side-card chat-side-card--dark">
        <div class="chat-side-kicker"><span class="online-dot"></span> 7×24 在线 · 平均 8 秒响应</div>
        <h2 class="side-title">设备有故障，<br>先问售后助手。</h2>
        <p class="side-desc">回答只引用官方手册与历史工单；涉及金额、保修责任或客户投诉，会自动转给人工坐席。</p>
        <div class="model-chips"><span>NC-500</span><span>PT-800</span><span>VF-320</span></div>
      </div>
      <div class="chat-side-card">
        <h3 class="strong" style="font-size:var(--fs-14)">服务保障</h3>
        <ul class="side-list">
          <li>${icon('shieldCheck', 15)} 有据可答：每条结论带手册页码</li>
          <li>${icon('headset', 15)} 答不了就转人工，不凭模型猜测</li>
          <li>${icon('clock', 15)} 30 分钟无消息自动结束会话</li>
        </ul>
        <div class="side-meta"><span>人工服务</span><strong>09:00–21:00</strong></div>
        <div class="side-meta"><span>服务热线</span><strong class="mono">400-820-0188</strong></div>
      </div>
      <div class="chat-side-card">
        <div class="row-between"><h3 class="strong" style="font-size:var(--fs-14)">本次会话</h3>${feedbackBadge}</div>
        <div class="side-meta"><span>会话编号</span><strong class="mono" style="font-size:var(--fs-12)">${esc(state.sessionId || '新会话')}</strong></div>
        <div class="side-meta"><span>当前状态</span><strong>${state.escalated ? '人工排队中' : state.ended ? '已结束' : 'AI 服务中'}</strong></div>
        <div class="side-meta"><span>消息条数</span><strong class="num">${state.messages.length}</strong></div>
      </div>
    </aside>

    <section class="chat-panel" aria-label="客户聊天窗">
      <header class="chat-panel__head">
        <div class="chat-agent">
          <span class="chat-avatar">AI</span>
          <div>
            <div class="chat-agent__name">售后智能助手 <span class="badge badge--brand badge--dot">在线</span></div>
            <div class="chat-agent__sub">基于 3 本官方手册 · 引用可回溯</div>
          </div>
        </div>
        <div class="chat-head-actions">
          <button class="btn btn--soft" id="escalateBtn" aria-label="${state.escalated ? '查看转人工排队' : '转人工'}">${icon('headset', 15)} <span>${state.escalated ? '排队中' : '转人工'}</span></button>
          <div class="chat-menu-wrap">
            <button class="icon-btn" id="chatMenuBtn" aria-label="更多操作" aria-expanded="false">${icon('more', 18)}</button>
            <div class="menu" id="chatMenu" hidden>
              <button class="menu__item" id="menuHandover">${icon('inbox', 16)} 查看交接包</button>
              <button class="menu__item" id="menuEnd">${icon('checkCircle', 16)} 结束并评价</button>
              <div class="menu__sep"></div>
              <button class="menu__item menu__item--danger" id="menuRestart">${icon('refresh', 16)} 重新开始</button>
            </div>
          </div>
        </div>
      </header>
      <div id="queueSlot">${queueHtml()}</div>
      <div class="chat-stream" id="chatStream" aria-live="polite" aria-relevant="additions text">${streamHtml()}</div>
      <div id="quickSlot">${quickHtml()}</div>
      ${composerHtml()}
    </section>
  </div>
  <input type="file" id="imageInput" accept="image/*" class="sr-only" />`;
}

function bind() {
  const view = rootEl;
  const input = view.querySelector('#chatInput');
  const sendBtn = view.querySelector('#sendBtn');
  const imageInput = view.querySelector('#imageInput');
  const stream = view.querySelector('#chatStream');

  const autoGrow = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };

  input?.addEventListener('input', autoGrow);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitText(input.value);
    }
  });
  sendBtn?.addEventListener('click', () => submitText(input?.value || ''));
  view.querySelector('#imageBtn')?.addEventListener('click', () => imageInput?.click());
  imageInput?.addEventListener('change', onPickImage);
  view.querySelectorAll('[data-question]').forEach((b) => b.addEventListener('click', () => submitText(b.dataset.question)));
  view.querySelectorAll('[data-followup]').forEach((b) => b.addEventListener('click', () => submitText(b.dataset.followup)));
  view.querySelectorAll('[data-remove-attach]').forEach((b) => b.addEventListener('click', () => {
    const [item] = state.attachments.splice(Number(b.dataset.removeAttach), 1);
    if (item) URL.revokeObjectURL(item.url);
    rerenderBody();
  }));
  view.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    toast(`正在打开《${b.dataset.doc}》第 ${b.dataset.page} 页`, { type: 'info', desc: 'G1 演示：PDF 阅读器将在后端联通后接入。' });
  }));

  view.querySelector('#escalateBtn')?.addEventListener('click', () => {
    if (state.escalated) openHandover();
    else escalate('客户主动要求转人工');
  });
  view.querySelector('#viewHandoverBtn')?.addEventListener('click', openHandover);
  view.querySelector('#menuHandover')?.addEventListener('click', () => { closeMenu(); openHandover(); });
  view.querySelector('#menuEnd')?.addEventListener('click', () => { closeMenu(); endSession(); });
  view.querySelector('#menuRestart')?.addEventListener('click', () => { closeMenu(); restart(); });

  const menuBtn = view.querySelector('#chatMenuBtn');
  const menu = view.querySelector('#chatMenu');
  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  const onDocClick = (e) => { if (!e.target.closest?.('.chat-menu-wrap')) closeMenu(); };
  aborter?.abort();
  aborter = new AbortController();
  document.addEventListener('click', onDocClick, { signal: aborter.signal });

  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menuBtn?.setAttribute('aria-expanded', 'false');
  }

  requestAnimationFrame(() => {
    if (stream) stream.scrollTop = stream.scrollHeight;
    if (!state.escalated && !state.ended) input?.focus({ preventScroll: true });
  });
}

function rerenderBody() {
  if (!rootEl) return;
  const activeId = document.activeElement?.id;
  const value = rootEl.querySelector('#chatInput')?.value || '';
  rootEl.innerHTML = shellHtml();
  bind();
  const input = rootEl.querySelector('#chatInput');
  if (input && activeId === 'chatInput') { input.value = value; input.focus(); }
}

/* ---------------- 交互 ---------------- */
function pushMessage(msg) {
  state.messages.push(msg);
  persist();
}

function onPickImage(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('请选择图片文件', { type: 'error' }); return; }
  if (file.size > 8 * 1024 * 1024) { toast('图片不能超过 8MB', { type: 'error', desc: '请压缩后重试。' }); return; }
  const url = URL.createObjectURL(file);
  state.attachments.push({ name: file.name, size: `${(file.size / 1024).toFixed(0)} KB`, url });
  e.target.value = '';
  rerenderBody();
}

async function submitText(raw) {
  const text = String(raw || '').trim();
  if (state.busy || state.ended) return;
  if (state.escalated) { toast('会话已转人工', { type: 'info', desc: '坐席接入后可继续沟通，当前排队第 ' + (state.escalation?.queue_position ?? 2) + ' 位。' }); return; }
  if (!text && !state.attachments.length) return;

  const attachments = state.attachments;
  const msg = { id: nextId(), role: 'user', text: text || '请看我上传的设备照片。', at: nowISO() };
  if (attachments.length) {
    msg.image = { name: attachments[0].name, size: attachments[0].size };
    state.imageUrls.set(msg.id, attachments[0].url);
    state.attachments = [];
  }
  pushMessage(msg);
  state.busy = true;
  rerenderBody();

  await new Promise((r) => setTimeout(r, 620));
  try {
    if (msg.image) {
      const reply = {
        id: nextId(), role: 'ai', at: nowISO(),
        text: '图片已收到，但分辨率较低（OCR 置信度 0.31），我无法可靠识别屏幕上的报警代码。为避免误判，我先为你转接人工，请把设备型号和屏幕文字一并发给坐席。'
      };
      pushMessage(reply);
      state.busy = false;
      rerenderBody();
      await escalate('图片无法可靠识别');
      return;
    }
    const result = await api.chat.send({ text, images: [], message_id: msg.id, session_id: state.sessionId });
    if (result?.session_id) state.sessionId = result.session_id;
    if (result?.answer) {
      pushMessage({
        id: nextId(), role: 'ai', at: nowISO(), text: result.answer,
        citations: result.citations || [], followups: result.followups || []
      });
    }
    if (result?.escalated) {
      state.escalated = true;
      state.escalation = {
        session_id: result.session_id,
        queue_position: result.session?.queue_position || result.queue_position || 1,
        eta_min: result.session?.eta_min || result.eta_min || 3,
        handover: result.handover || result.session?.handover || {},
        assigned_team: '售后队列',
        business_hours: '09:00–21:00',
      };
      pushMessage({
        id: nextId(), role: 'system', at: nowISO(),
        text: `已转人工 · 排队第 ${state.escalation.queue_position} 位 · 预计 ${state.escalation.eta_min} 分钟`
      });
      state.busy = false;
      persist();
      rerenderBody();
      toast('已为你转接人工坐席', { type: 'success', desc: `当前第 ${state.escalation.queue_position} 位。` });
      setTimeout(() => { if (state.escalated) openHandover(); }, 700);
    } else if (!result?.answer) {
      pushMessage({ id: nextId(), role: 'ai', at: nowISO(), text: '这个问题我暂时没有找到可靠依据，已为你转接人工同事。' });
      state.busy = false;
      rerenderBody();
      await escalate('检索未命中，自动转人工');
    } else {
      state.busy = false;
      persist();
      rerenderBody();
    }
  } catch (err) {
    state.busy = false;
    pushMessage({ id: nextId(), role: 'system', text: '回复生成失败，已保留你的问题并转人工处理。', at: nowISO() });
    rerenderBody();
    toast('AI 服务暂时不可用，已转人工', { type: 'error', desc: err?.message || '请稍后重试。' });
  }
}

async function escalate(reason) {
  if (state.escalated) { openHandover(); return; }
  state.busy = true;
  rerenderBody();
  try {
    const data = await api.chat.escalate({ reason, session_id: state.sessionId });
    if (data.session_id) state.sessionId = data.session_id;
    state.escalation = data;
    state.escalated = true;
    state.busy = false;
    pushMessage({
      id: nextId(), role: 'system', at: nowISO(),
      text: `已转人工 · 排队第 ${data.queue_position} 位 · 预计 ${data.eta_min} 分钟，交接包已生成`
    });
    rerenderBody();
    toast('已为你转接人工坐席', { type: 'success', desc: `当前第 ${data.queue_position} 位，预计等待 ${data.eta_min} 分钟。` });
    setTimeout(() => { if (state.escalated) openHandover(); }, 700);
  } catch (err) {
    state.busy = false;
    rerenderBody();
    toast('转人工失败，请重试', { type: 'error', desc: err?.message });
  }
}

async function openHandover() {
  let data = state.escalation;
  if (!data) {
    try { data = await api.chat.escalate({ reason: '客户主动要求转人工', session_id: state.sessionId }); if (data.session_id) state.sessionId = data.session_id; state.escalation = data; persist(); }
    catch (err) { toast('交接包加载失败', { type: 'error', desc: err?.message }); return; }
  }
  const h = data.handover || {};
  const collected = Object.entries(h.collected || {});
  const docs = h.top_docs || [];
  openDrawer({
    title: '转人工交接包',
    sub: `${data.session_id} · 已进入${data.assigned_team || '售后队列'} · 排队第 ${data.queue_position} 位`,
    body: `
      <div class="notice notice--brand" style="margin-bottom:var(--sp-5)">
        ${icon('shieldCheck', 15)} 交接包四段完整率 100%，坐席接管后可继续服务。
      </div>
      <section class="handover-section">
        <div class="handover-title"><span class="step">1</span> 会话摘要</div>
        <p class="handover-text">${esc(h.summary)}</p>
      </section>
      <section class="handover-section">
        <div class="handover-title"><span class="step">2</span> 已收集信息</div>
        <dl class="handover-kv">${collected.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </section>
      <section class="handover-section">
        <div class="handover-title"><span class="step">3</span> AI 建议</div>
        <p class="handover-text">${esc(h.ai_suggestion)}</p>
      </section>
      <section class="handover-section">
        <div class="handover-title"><span class="step">4</span> 推荐知识 Top3</div>
        <div class="doc-rank">${docs.map((d, i) => `
          <div class="doc-rank__item">
            <span class="doc-rank__no">${i + 1}</span>
            <div class="doc-rank__main">
              <div class="doc-rank__name">${esc(d.doc)}</div>
              <div class="doc-rank__meta">第 ${esc(d.page)} 页 · ${esc(d.section)}</div>
            </div>
            <span class="doc-rank__score">${Number(d.score).toFixed(2)}</span>
          </div>`).join('')}</div>
      </section>`,
    footer: `
      <button class="btn" data-close>关闭</button>
      <a class="btn btn--primary" href="#/workbench?session=${esc(data.session_id)}">模拟坐席接管 ${icon('arrowRight', 16)}</a>`
  });
}

async function endSession() {
  if (state.ended) { toast('本次会话已结束', { type: 'info', desc: state.feedback ? '你已完成评价，不能重复提交。' : '' }); return; }
  const ok = await confirmDialog({
    title: '结束本次会话？',
    message: '结束后将不能再发送消息，并进入质检抽样。',
    confirmText: '结束并评价',
    detail: '若问题尚未解决，建议先点击「转人工」等待坐席接入。'
  });
  if (!ok) return;
  state.ended = true;
  pushMessage({ id: nextId(), role: 'system', at: nowISO(), text: '会话已结束，感谢你的使用。' });
  persist();
  rerenderBody();
  openFeedback();
}

function openFeedback() {
  if (state.feedback) {
    toast('本次会话已评价', { type: 'info', desc: `你已提交 ${state.feedback.score} 星评价，不能重复提交。` });
    return;
  }
  let score = 0;
  const tags = new Set();
  const m = openModal({
    title: '这次服务体验如何？',
    desc: '1–5 星 · 可选文字评价（不超过 200 字）',
    size: 'sm',
    body: `
      <div class="rating-stars" role="radiogroup" aria-label="服务评分">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn" role="radio" aria-checked="false" aria-label="${n} 星" data-score="${n}">${icon('star', 32)}</button>`).join('')}
      </div>
      <p class="rating-label" id="ratingLabel">请选择评分</p>
      <div class="rating-tags" aria-label="快速标签">
        ${RATING_TAGS.map((t) => `<button type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <div class="field">
        <label class="label" for="fbComment">补充说明（可选）</label>
        <textarea class="textarea" id="fbComment" maxlength="200" placeholder="哪里有帮助，或哪里需要改进？"></textarea>
        <div class="char-count" id="fbCount">0 / 200</div>
      </div>`,
    footer: `<button class="btn" data-close>稍后再说</button><button class="btn btn--primary" id="fbSubmit" disabled>提交评价</button>`
  });

  const starBtns = [...m.body.querySelectorAll('.star-btn')];
  const label = m.body.querySelector('#ratingLabel');
  const submit = m.foot.querySelector('#fbSubmit');
  const comment = m.body.querySelector('#fbComment');
  const count = m.body.querySelector('#fbCount');

  starBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      score = Number(btn.dataset.score);
      starBtns.forEach((b) => {
        const on = Number(b.dataset.score) <= score;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(Number(b.dataset.score) === score));
      });
      label.textContent = `${score} 星 · ${RATING_LABEL[score]}`;
      submit.disabled = false;
    });
    btn.addEventListener('mouseenter', () => { if (!score) label.textContent = `${btn.dataset.score} 星 · ${RATING_LABEL[btn.dataset.score]}`; });
  });
  m.body.querySelector('.rating-stars').addEventListener('mouseleave', () => {
    label.textContent = score ? `${score} 星 · ${RATING_LABEL[score]}` : '请选择评分';
  });
  m.body.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    if (tags.has(t)) tags.delete(t); else tags.add(t);
    b.classList.toggle('is-on', tags.has(t));
  }));
  comment.addEventListener('input', () => { count.textContent = `${comment.value.length} / 200`; });

  submit.addEventListener('click', async () => {
    if (!score) return;
    submit.disabled = true;
    submit.textContent = '提交中…';
    try {
      await api.feedback.submit({ session_id: state.sessionId || 's_20261101_0042', score, comment: comment.value.trim() });
      state.feedback = { score, comment: comment.value.trim(), tags: [...tags], at: nowISO() };
      persist();
      pushMessage({ id: nextId(), role: 'system', at: nowISO(), text: `感谢评价：${score} 星${comment.value.trim() ? '，已记录你的补充说明' : ''}。` });
      m.close('submitted');
      rerenderBody();
      toast('评价已提交', { type: 'success', desc: '感谢反馈，我们会用于改进知识库与转人工体验。' });
    } catch (err) {
      submit.disabled = false;
      submit.textContent = '提交评价';
      toast('提交失败，请重试', { type: 'error', desc: err?.message });
    }
  });
}

async function restart() {
  const ok = await confirmDialog({
    title: '重新开始会话？',
    message: '当前对话记录与评价状态会被清空，无法恢复。',
    confirmText: '重新开始',
    danger: true,
    detail: '演示数据不会影响其他页面。'
  });
  if (!ok) return;
  state.imageUrls.clear();
  state.attachments = [];
  store.resetChat();
  state.messages = [welcomeMessage()];
  state.escalated = false;
  state.escalation = null;
  state.feedback = null;
  state.ended = false;
  state.sessionId = null;
  state.busy = false;
  persist();
  rerenderBody();
  toast('已开始新的会话', { type: 'success' });
}

/* ---------------- 页面入口 ---------------- */
export async function render(root, ctx) {
  rootEl = root;
  ctxRef = ctx;
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('chat'); return; }

  state.faq = await api.chat.getFaqs();
  loadState();

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="chat-page">
      <aside class="chat-aside">
        <div class="chat-side-card chat-side-card--dark">
          <div class="chat-side-kicker"><span class="online-dot"></span> 7×24 在线</div>
          <h2 class="side-title">设备有故障，<br>先问售后助手。</h2>
          <p class="side-desc">回答只引用官方手册与历史工单。</p>
        </div>
      </aside>
      <section class="chat-panel">
        <header class="chat-panel__head"><div class="chat-agent"><span class="chat-avatar">AI</span><div><div class="chat-agent__name">售后智能助手</div><div class="chat-agent__sub">基于 3 本官方手册</div></div></div></header>
        <div style="flex:1;display:flex;align-items:center;justify-content:center">
          ${emptyState({ iconName: 'chat', title: '还没有会话记录', desc: '发起一次咨询，助手会按手册给出处理步骤并标注出处；答不了会自动转人工。', action: '<button class="btn btn--primary" data-start-chat>开始新咨询</button>' })}
        </div>
      </section>
    </div>`;
    root.querySelector('[data-start-chat]')?.addEventListener('click', () => {
      ctx.clearStateParam();
      render(root, { ...ctx, state: 'default' });
    });
    return;
  }

  rerenderBody();
}

export function destroy() {
  aborter?.abort();
  aborter = null;
  rootEl = null;
  ctxRef = null;
}









