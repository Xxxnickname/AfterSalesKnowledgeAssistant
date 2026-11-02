/* kb.js — 1-5 知识库管理：文档 / FAQ / 术语 + 解析进度 + 下架确认 */
import { api } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { esc, fmtDateTime, toast, openModal, confirmDialog, emptyState, skeletonPage, statusBadge } from '../components.js';

let data = { docs: [], faqs: [], glossary: [] };
let tab = 'docs';
let q = { docs: '', faqs: '', glossary: '' };
let rootEl = null;
let timers = [];
let loaded = false;

const PARSE = {
  ready: ['success', '已就绪'], parsing: ['info', '解析中'], pending: ['warning', '待解析'], failed: ['danger', '解析失败']
};
const FAQ_STATUS = { published: ['success', '已发布'], review: ['warning', '待审核'], draft: ['neutral', '草稿'] };

function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function filteredDocs() {
  const s = q.docs.trim().toLowerCase();
  return data.docs.filter((d) => !s || [d.name, d.model, d.version, d.owner].some((v) => String(v).toLowerCase().includes(s)));
}
function filteredFaqs() {
  const s = q.faqs.trim().toLowerCase();
  return data.faqs.filter((f) => !s || [f.question, f.category, f.source].some((v) => String(v).toLowerCase().includes(s)));
}
function filteredTerms() {
  const s = q.glossary.trim().toLowerCase();
  return data.glossary.filter((g) => !s || [g.term, g.alias, g.definition, g.model].some((v) => String(v).toLowerCase().includes(s)));
}

function statHtml() {
  const chunks = data.docs.filter((d) => d.status !== 'offline').reduce((n, d) => n + (d.chunks || 0), 0);
  const pendingFaq = data.faqs.filter((f) => f.status !== 'published').length;
  const failed = data.docs.filter((d) => d.parse_status === 'failed').length;
  return `<div class="stat-strip">
    <div class="stat"><div class="stat__label">知识文档</div><div class="stat__value">${data.docs.length}<small>份</small></div><div class="stat__foot">${data.docs.filter((d) => d.status !== 'offline').length} 份在架</div></div>
    <div class="stat"><div class="stat__label">有效切片</div><div class="stat__value">${chunks.toLocaleString('zh-CN')}<small style="margin-left:4px">chunks</small></div><div class="stat__foot">已生成向量并建立索引</div></div>
    <div class="stat"><div class="stat__label">待审核 FAQ</div><div class="stat__value">${pendingFaq}<small>条</small></div><div class="stat__foot">审核通过后 5 秒内可检索</div></div>
    <div class="stat"><div class="stat__label">解析失败</div><div class="stat__value">${failed}<small>份</small></div><div class="stat__foot text-danger">需重新解析或人工校对</div></div>
  </div>`;
}

function tabsHtml() {
  return `<div class="kb-tabs-bar">
    <div class="tabs" role="tablist" aria-label="知识库分类">
      <button class="tab" role="tab" aria-selected="${tab === 'docs'}" data-tab="docs">文档 <span class="count">${data.docs.length}</span></button>
      <button class="tab" role="tab" aria-selected="${tab === 'faqs'}" data-tab="faqs">FAQ 库 <span class="count">${data.faqs.length}</span></button>
      <button class="tab" role="tab" aria-selected="${tab === 'glossary'}" data-tab="glossary">术语表 <span class="count">${data.glossary.length}</span></button>
    </div>
    <div class="kb-tabs-tools">
      <div class="search-box kb-search">${icon('search', 15)}<label class="sr-only" for="kbSearch">搜索</label><input class="input" id="kbSearch" placeholder="${tab === 'docs' ? '搜索文档 / 型号 / 版本…' : tab === 'faqs' ? '搜索问题 / 分类…' : '搜索术语 / 别名…'}" value="${esc(q[tab])}"></div>
      ${tab === 'docs' ? `<button class="btn btn--primary btn--sm" id="uploadBtn">${icon('upload', 14)} 上传文档</button>` : tab === 'faqs' ? `<button class="btn btn--primary btn--sm" id="newFaqBtn">${icon('plus', 14)} 新建 FAQ</button>` : `<button class="btn btn--primary btn--sm" id="newTermBtn">${icon('plus', 14)} 新增术语</button>`}
    </div>
  </div>`;
}

function docsHtml() {
  const list = filteredDocs();
  if (!list.length) return emptyState({ iconName: 'search', title: '没有匹配的文档', desc: '试试换一个型号或版本关键词。', action: '<button class="btn btn--primary" data-clear>清空搜索</button>', compact: true });
  return `<div class="table-wrap"><table class="table" style="min-width:980px">
    <thead><tr><th>文档</th><th style="width:92px">版本</th><th style="width:130px">规模</th><th style="width:170px">解析进度</th><th style="width:82px">切片</th><th style="width:160px">更新时间</th><th style="width:172px"></th></tr></thead>
    <tbody>${list.map((d) => {
      const [tone, label] = d.status === 'offline' ? ['neutral', '已下架'] : (PARSE[d.parse_status] || PARSE.pending);
      const barClass = d.parse_status === 'failed' ? 'progress__bar--danger' : d.parse_status === 'parsing' ? '' : d.parse_status === 'ready' ? 'progress__bar--success' : 'progress__bar--warning';
      return `<tr class="${d.status === 'offline' ? 'kb-row--offline' : ''}">
        <td><div class="kb-doc">
          <span class="kb-doc__icon ${d.parse_status === 'failed' ? 'kb-doc__icon--warn' : d.status === 'offline' ? 'kb-doc__icon--muted' : ''}">${icon(d.parse_status === 'failed' ? 'alertTriangle' : 'doc', 17)}</span>
          <div style="min-width:0"><div class="kb-doc__name" title="${esc(d.name)}">${esc(d.name)}</div><div class="kb-doc__meta"><span class="badge badge--neutral">${esc(d.model)}</span><span>${esc(d.type)}</span><span>· ${esc(d.owner)}</span></div><div class="kb-doc__note" title="${esc(d.note)}">${esc(d.note)}</div></div>
        </div></td>
        <td class="mono">${esc(d.version)}</td>
        <td><span class="num">${d.pages ? `${d.pages} 页` : '表格'}</span><div class="muted" style="font-size:var(--fs-12)">${Number(d.size_mb).toFixed(1)} MB</div></td>
        <td><div class="kb-parse"><div class="kb-parse__row"><span class="badge badge--${d.status === 'offline' ? 'neutral' : tone} badge--dot">${esc(label)}</span><span class="kb-parse__pct">${d.status === 'offline' ? '—' : `${d.progress}%`}</span></div><div class="progress"><div class="progress__bar ${d.status === 'offline' ? '' : barClass}" style="width:${d.progress}%"></div></div></div></td>
        <td class="mono num">${d.chunks ? d.chunks.toLocaleString('zh-CN') : '—'}</td>
        <td class="mono" style="font-size:var(--fs-12)">${esc(fmtDateTime(d.updated_at))}</td>
        <td><div class="kb-actions">
          ${d.status === 'offline'
            ? `<button class="btn btn--soft btn--sm" data-restore="${esc(d.id)}">恢复上架</button>`
            : `<button class="btn btn--ghost btn--sm" data-reparse="${esc(d.id)}" ${d.parse_status === 'parsing' ? 'disabled' : ''}>${d.parse_status === 'parsing' ? '解析中…' : '重新解析'}</button><button class="btn btn--danger-ghost btn--sm" data-delist="${esc(d.id)}">下架</button>`}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function faqsHtml() {
  const list = filteredFaqs();
  if (!list.length) return emptyState({ iconName: 'search', title: '没有匹配的 FAQ', desc: '试试换一个分类或问题关键词。', action: '<button class="btn btn--primary" data-clear>清空搜索</button>', compact: true });
  return `<div class="table-wrap"><table class="table" style="min-width:880px">
    <thead><tr><th>问题</th><th style="width:110px">分类</th><th style="width:100px">状态</th><th style="width:90px">命中次数</th><th>来源</th><th style="width:160px">更新时间</th><th style="width:80px"></th></tr></thead>
    <tbody>${list.map((f) => { const [tone, label] = FAQ_STATUS[f.status] || FAQ_STATUS.draft; return `<tr>
      <td><div class="kb-faq-q">${esc(f.question)}</div><div class="muted" style="font-size:var(--fs-12)">${esc(f.id)}</div></td>
      <td><span class="badge badge--neutral">${esc(f.category)}</span></td>
      <td><span class="badge badge--${tone} badge--dot">${esc(label)}</span></td>
      <td class="mono num">${Number(f.hits || 0).toLocaleString('zh-CN')}</td>
      <td class="muted" style="font-size:var(--fs-12)">${esc(f.source)}</td>
      <td class="mono" style="font-size:var(--fs-12)">${esc(fmtDateTime(f.updated_at))}</td>
      <td><button class="btn btn--ghost btn--sm" data-edit-faq="${esc(f.id)}">编辑</button></td>
    </tr>`; }).join('')}</tbody>
  </table></div>`;
}

function termsHtml() {
  const list = filteredTerms();
  if (!list.length) return emptyState({ iconName: 'search', title: '没有匹配的术语', desc: '试试搜索故障代码或部件名称。', action: '<button class="btn btn--primary" data-clear>清空搜索</button>', compact: true });
  return `<div class="kb-glossary">${list.map((g) => `<article class="kb-term">
    <div class="kb-term__head"><div><div class="kb-term__name">${esc(g.term)}</div><div class="kb-term__alias">${esc(g.alias)}</div></div><span class="badge badge--brand">${esc(g.model)}</span></div>
    <p class="kb-term__def">${esc(g.definition)}</p>
    <div class="kb-term__foot"><span>更新于 ${esc(fmtDateTime(g.updated_at))}</span><button class="btn btn--link" data-edit-term="${esc(g.term)}">编辑</button></div>
  </article>`).join('')}</div>`;
}

function shellHtml() {
  return `<div class="kb-page">
    <div class="page-head">
      <div><h2 class="page-head__title">知识库管理</h2><p class="page-head__desc">文档解析、FAQ 审核与术语维护。旧版本下架后，检索只返回在架版本。</p></div>
      <div class="page-head__actions"><span class="badge badge--success badge--dot">检索索引正常</span><button class="btn btn--sm" id="kbRefresh">${icon('refresh', 14)} 同步状态</button></div>
    </div>
    ${statHtml()}
    <div class="card">
      ${tabsHtml()}
      ${tab === 'docs' ? docsHtml() : tab === 'faqs' ? faqsHtml() : termsHtml()}
      <div class="pager"><span>${tab === 'docs' ? `${filteredDocs().length} 份文档` : tab === 'faqs' ? `${filteredFaqs().length} 条 FAQ` : `${filteredTerms().length} 个术语`} · G1 演示数据</span><span>最后同步 ${fmtDateTime(new Date().toISOString())}</span></div>
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
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    store.patchSection('kb', { tab });
    rerender();
  }));
  const search = root.querySelector('#kbSearch');
  search?.addEventListener('input', () => {
    q[tab] = search.value;
    rerender();
    const next = rootEl.querySelector('#kbSearch');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  root.querySelector('[data-clear]')?.addEventListener('click', () => { q[tab] = ''; rerender(); });
  root.querySelector('#kbRefresh')?.addEventListener('click', () => toast('索引状态已同步', { type: 'success', desc: '8 份文档 · 3 份在架版本可检索。' }));
  root.querySelector('#uploadBtn')?.addEventListener('click', openUpload);
  root.querySelector('#newFaqBtn')?.addEventListener('click', () => { toast('新建 FAQ', { type: 'info', desc: 'G1 演示：表单将在 G2 接入 /api/kb/faqs。' }); });
  root.querySelector('#newTermBtn')?.addEventListener('click', () => { toast('新增术语', { type: 'info', desc: 'G1 演示：术语编辑将在 G2 接入。' }); });

  root.querySelectorAll('[data-delist]').forEach((b) => b.addEventListener('click', () => delist(b.dataset.delist, b)));
  root.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
    const d = data.docs.find((x) => x.id === b.dataset.restore);
    if (!d) return;
    d.status = 'active';
    rerender();
    toast('文档已恢复上架', { type: 'success', desc: `${d.name} 将重新进入检索。` });
  }));
  root.querySelectorAll('[data-reparse]').forEach((b) => b.addEventListener('click', () => reparse(b.dataset.reparse, b)));

  root.querySelectorAll('[data-edit-faq]').forEach((b) => b.addEventListener('click', () => toast('FAQ 编辑器', { type: 'info', desc: 'G1 演示：审核与编辑将在 G2 接入。' })));
  root.querySelectorAll('[data-edit-term]').forEach((b) => b.addEventListener('click', () => toast('编辑术语', { type: 'info', desc: `G1 演示：${b.dataset.editTerm}` })));
}

function delist(id, btn) {
  const d = data.docs.find((x) => x.id === id);
  if (!d) return;
  confirmDialog({
    title: '下架这份文档？',
    message: `《${d.name}》${d.version} 将从检索中移除。`,
    confirmText: '确认下架',
    danger: true,
    detail: `影响：引用该文档的 ${d.chunks.toLocaleString('zh-CN')} 个切片不再返回；历史会话中的引用仍可追溯。`
  }).then((ok) => {
    if (!ok) return;
    d.status = 'offline';
    d.note = '已人工下架，检索不再返回';
    rerender();
    toast('文档已下架', { type: 'success', desc: `${d.name} 已移出检索索引。` });
  });
}

function reparse(id, btn) {
  const d = data.docs.find((x) => x.id === id);
  if (!d) return;
  clearTimers();
  d.parse_status = 'parsing';
  d.progress = 8;
  d.note = '正在重新解析，预计 2 分钟';
  rerender();
  timers.push(setTimeout(() => { d.progress = 38; rerender(); }, 650));
  timers.push(setTimeout(() => { d.progress = 72; rerender(); }, 1350));
  timers.push(setTimeout(() => {
    d.parse_status = 'ready';
    d.progress = 100;
    d.chunks = d.chunks || 428;
    d.note = '重新解析完成，索引已更新';
    d.updated_at = new Date().toISOString();
    rerender();
    toast('解析完成', { type: 'success', desc: `${d.name} 已重新入库，可被检索命中。` });
  }, 2200));
}

function openUpload() {
  const m = openModal({
    title: '上传知识文档',
    desc: '支持 PDF / XLSX / DOCX，单文件不超过 100MB',
    size: 'lg',
    body: `<div class="field">
      <label class="label" for="upModel">适用设备型号</label>
      <select class="select" id="upModel"><option>NC-500</option><option>PT-800</option><option>VF-320</option><option>全系列</option></select>
    </div>
    <div class="mt-8">
      <label class="kb-upload" for="upFile" style="display:block;cursor:pointer">
        <span class="kb-upload__icon">${icon('upload', 24)}</span>
        <div class="kb-upload__title">拖拽文件到这里，或点击选择</div>
        <div class="kb-upload__desc">图像型 PDF 将自动进入 OCR 队列；上传后可查看解析进度。</div>
        <input type="file" id="upFile" class="sr-only" accept=".pdf,.xlsx,.docx" />
      </label>
      <div id="upFileInfo" class="notice mt-6" hidden></div>
    </div>
    <div class="notice notice--brand mt-8">${icon('shieldCheck', 15)} 新版本上传完成并解析成功后，旧版本会自动下架，检索只返回新版本。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn--primary" id="upSubmit" disabled>上传并解析</button>`
  });
  m.body.querySelector('#upFile').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const info = m.body.querySelector('#upFileInfo');
    info.hidden = false;
    info.textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} MB · 已选择`;
    m.foot.querySelector('#upSubmit').disabled = false;
  });
  m.foot.querySelector('#upSubmit').addEventListener('click', () => {
    const name = m.body.querySelector('#upFileInfo').textContent.split(' · ')[0];
    m.close();
    toast('已加入解析队列', { type: 'success', desc: `${name} 正在 OCR 与切分，预计 3–5 分钟。` });
  });
}

export async function render(root, ctx) {
  rootEl = root;
  clearTimers();
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('list'); return; }
  if (!loaded) { data = await api.kb.getAll(); loaded = true; }
  tab = store.get().kb?.tab || 'docs';

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="page-head"><div><h2 class="page-head__title">知识库管理</h2><p class="page-head__desc">文档解析、FAQ 审核与术语维护。</p></div></div>
      <div class="card">${emptyState({ iconName: 'book', title: '知识库还没有文档', desc: '上传第一份设备手册后，助手才能按手册回答并标注出处。', action: '<button class="btn btn--primary" id="emptyUpload">上传第一份文档</button>' })}</div>`;
    root.querySelector('#emptyUpload')?.addEventListener('click', () => { ctx.clearStateParam(); render(root, { ...ctx, state: 'default' }); });
    return;
  }
  rerender();
}

export function destroy() { rootEl = null; clearTimers(); }





