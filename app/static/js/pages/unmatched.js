/* unmatched.js — 1-4 未命中问题池：频次排序 / 样例会话 / FAQ 草稿 */
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDateTime, timeAgo, toast, openDrawer, openModal, emptyState, skeletonPage } from '../components.js';

let items = [];
let query = '';
let channel = 'all';
let days = 7;
let sort = 'count';
let rootEl = null;
let loaded = false;

const STATUS = {
  new: ['warning', '未处理'],
  draft: ['info', '草稿待审'],
  ignored: ['neutral', '已忽略']
};

function filtered() {
  const q = query.trim().toLowerCase();
  const list = items.filter((it) => {
    const okChannel = channel === 'all' || it.channel === channel;
    const okQuery = !q || it.question.toLowerCase().includes(q) || it.id.includes(q);
    return okChannel && okQuery;
  });
  return list.sort((a, b) => sort === 'recent'
    ? new Date(b.last_seen) - new Date(a.last_seen)
    : b.count - a.count);
}

function statHtml(list) {
  const total = items.reduce((sum, it) => sum + it.count, 0);
  const high = items.filter((it) => it.count >= 10).length;
  const drafts = items.filter((it) => it.status === 'draft').length + 32;
  return `<div class="stat-strip">
    <div class="stat"><div class="stat__label">近 ${days} 天未命中</div><div class="stat__value">${total}<small>次</small></div><div class="stat__foot">${icon('activity', 12)} 占全部提问 7.6%</div></div>
    <div class="stat"><div class="stat__label">高频问题</div><div class="stat__value">${high}<small>条</small></div><div class="stat__foot">出现 ≥10 次，优先处理</div></div>
    <div class="stat"><div class="stat__label">已转 FAQ</div><div class="stat__value">${drafts}<small>条</small></div><div class="stat__foot">其中 ${items.filter((it) => it.status === 'draft').length} 条待审核</div></div>
    <div class="stat"><div class="stat__label">平均等待</div><div class="stat__value">2.4<small>天</small></div><div class="stat__foot">目标 ≤2 天 · 略超</div></div>
  </div>`;
}

function rowsHtml(list) {
  const max = Math.max(...items.map((it) => it.count), 1);
  return list.map((it, idx) => {
    const [tone, label] = STATUS[it.status] || STATUS.new;
    return `<tr class="um-row" data-row="${esc(it.id)}" tabindex="0">
      <td><span class="um-rank ${idx < 3 ? 'um-rank--top' : ''}">${String(idx + 1).padStart(2, '0')}</span></td>
      <td>
        <div class="um-question"><div><div class="um-q">${esc(it.question)}</div><div class="um-q-sub">${esc(it.id)} · 最近 ${timeAgo(it.last_seen)} · ${esc(it.channel)}<span class="only-mobile"> · 点按查看</span></div></div></div>
      </td>
      <td>
        <div class="um-count"><span class="um-count__num">${it.count}</span><span class="um-count__bar" aria-hidden="true"><span style="width:${Math.round(it.count / max * 100)}%"></span></span></div>
      </td>
      <td class="nowrap mono" style="font-size:var(--fs-12)">${esc(fmtDateTime(it.last_seen))}</td>
      <td><span class="badge badge--neutral">${esc(it.channel)}</span></td>
      <td><span class="badge badge--${tone} badge--dot">${esc(label)}</span></td>
      <td>
        <div class="um-actions">
          <button class="btn btn--ghost btn--sm" data-sample="${esc(it.id)}">查看样例</button>
          <button class="btn btn--soft btn--sm" data-draft="${esc(it.id)}">${icon('wand', 13)} 转 FAQ</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function shellHtml() {
  const list = filtered();
  return `<div class="um-page">
    <div class="page-head">
      <div>
        <h2 class="page-head__title">未命中问题池</h2>
        <p class="page-head__desc">客户问了但检索答不上的问题。按频次排序，优先把高频问题转成 FAQ。</p>
      </div>
      <div class="page-head__actions">
        <span class="badge badge--warning badge--dot">${items.filter((it) => it.status === 'new').length} 条未处理</span>
        <button class="btn btn--sm" id="exportBtn">${icon('download', 14)} 导出清单</button>
      </div>
    </div>
    ${statHtml(list)}
    <div class="card um-table-card">
      <div class="um-filters">
        <div class="um-filters__left">
          <div class="segmented" role="group" aria-label="时间范围">
            ${[7, 14, 30].map((d) => `<button data-days="${d}" aria-pressed="${days === d}">近 ${d} 天</button>`).join('')}
          </div>
          <label class="sr-only" for="umChannel">渠道筛选</label>
          <select class="select" id="umChannel" style="width:130px;min-height:34px">
            <option value="all" ${channel === 'all' ? 'selected' : ''}>全部渠道</option>
            <option value="网页" ${channel === '网页' ? 'selected' : ''}>网页</option>
            <option value="企业微信" ${channel === '企业微信' ? 'selected' : ''}>企业微信</option>
            <option value="电话" ${channel === '电话' ? 'selected' : ''}>电话</option>
          </select>
          <div class="search-box um-search">${icon('search', 15)}<label class="sr-only" for="umSearch">搜索问题</label><input class="input" id="umSearch" placeholder="搜索问题或编号…" value="${esc(query)}"></div>
        </div>
        <div class="um-filters__right">
          <span class="um-sort">排序
            <button data-sort="count" data-dir="${sort === 'count' ? 'desc' : ''}">出现次数 ${sort === 'count' ? icon('arrowDown', 12) : ''}</button>
            <button data-sort="recent" data-dir="${sort === 'recent' ? 'desc' : ''}">最近出现 ${sort === 'recent' ? icon('arrowDown', 12) : ''}</button>
          </span>
        </div>
      </div>
      ${list.length ? `<div class="table-wrap" style="max-height:calc(100dvh - 420px);min-height:280px">
        <table class="table um-table">
          <thead><tr><th style="width:52px">#</th><th>问题</th><th style="width:170px">出现次数</th><th style="width:170px">最近出现</th><th style="width:92px">渠道</th><th style="width:110px">状态</th><th style="width:190px"></th></tr></thead>
          <tbody>${rowsHtml(list)}</tbody>
        </table>
      </div>` : emptyState({ iconName: 'search', title: '没有匹配的未命中问题', desc: '试试清空搜索或切换渠道/时间范围；如果是新问题，等下一次问答后会自动进入问题池。', action: '<button class="btn btn--primary" data-clear>清空筛选</button>' })}
      <div class="pager"><span>点击行查看样例并转 FAQ · 共 ${list.length} 条</span><div class="pager__pages"><button class="pager__btn" disabled>${icon('chevronLeft', 12)}</button><button class="pager__btn" aria-current="true">1</button><button class="pager__btn" disabled>${icon('chevronRight', 12)}</button></div></div>
    </div>
  </div>`;
}

function bind() {
  const root = rootEl;
  root.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.days); rerender(); }));
  root.querySelector('#umChannel')?.addEventListener('change', (e) => { channel = e.target.value; rerender(); });
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { sort = b.dataset.sort; rerender(); }));
  const search = root.querySelector('#umSearch');
  search?.addEventListener('input', () => {
    query = search.value;
    rerender();
    const next = rootEl.querySelector('#umSearch');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  root.querySelector('[data-clear]')?.addEventListener('click', () => { query = ''; channel = 'all'; days = 7; rerender(); });
  root.querySelector('#exportBtn')?.addEventListener('click', () => toast('已生成未命中清单', { type: 'success', desc: 'G1 演示：导出文件将在 G2 由 /api/unmatched/export 生成。' }));
  root.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openSample(items.find((x) => x.id === b.dataset.sample)); }));
  root.querySelectorAll('[data-draft]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openDraft(items.find((x) => x.id === b.dataset.draft)); }));
  root.querySelectorAll('[data-row]').forEach((row) => {
    row.addEventListener('click', (e) => { if (e.target.closest('button')) return; openSample(items.find((x) => x.id === row.dataset.row)); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSample(items.find((x) => x.id === row.dataset.row)); });
  });
}

function rerender() {
  if (!rootEl) return;
  rootEl.innerHTML = shellHtml();
  bind();
}

function openSample(it) {
  if (!it) return;
  const s = it.sample_session || {};
  const msgs = s.messages || [];
  const drawer = openDrawer({
    title: '未命中样例',
    sub: `${it.id} · 近 ${days} 天出现 ${it.count} 次`,
    body: `
      <div class="um-sample-head">
        <span class="empty-state__icon" style="width:40px;height:40px;margin:0;border-radius:var(--r-lg);background:var(--warning-50);color:var(--warning-600);border-color:var(--warning-100)">${icon('search', 20)}</span>
        <div class="grow">
          <div class="um-sample-q">${esc(it.question)}</div>
          <div class="um-sample-meta"><span>出现 <strong>${it.count}</strong> 次</span><span>最近 <strong>${esc(fmtDateTime(it.last_seen))}</strong></span><span>结果 <strong>${esc(s.outcome || '转人工')}</strong></span></div>
        </div>
      </div>
      <div class="notice notice--warning um-draft-tip">${icon('alertTriangle', 15)} 同类问题 7 天内出现 ≥5 次，建议转 FAQ 草稿，减少重复转人工。</div>
      <div class="um-chat">
        ${msgs.map((m) => `<div class="um-chat-row ${m.role === 'agent' ? 'um-chat-row--agent' : ''}">
          <span class="um-chat-avatar">${m.role === 'customer' ? '客' : m.role === 'ai' ? 'AI' : '坐'}</span>
          <div><div class="um-chat-bubble">${esc(m.text)}</div><div class="um-chat-meta">${m.role === 'customer' ? '客户' : m.role === 'ai' ? 'AI 助手' : '坐席'} · ${esc(fmtDateTime(m.at))}</div></div>
        </div>`).join('')}
      </div>
      <div class="notice mt-8">${icon('info', 14)} 样例会话编号 <span class="mono">${esc(s.id || '—')}</span> · 渠道 ${esc(s.channel || it.channel)} · 创建于 ${esc(fmtDateTime(s.created_at))}</div>`,
    footer: `<button class="btn" data-close>关闭</button><button class="btn btn--primary" id="drawerDraft">${icon('wand', 15)} 生成 FAQ 草稿</button>`
  });
  drawer.foot.querySelector('#drawerDraft').addEventListener('click', () => { drawer.close(); openDraft(it); });
}

function openDraft(it) {
  if (!it) return;
  const m = openModal({
    title: '生成 FAQ 草稿',
    desc: `${it.id} · 累计出现 ${it.count} 次`,
    size: 'lg',
    body: `<div class="um-draft-form">
      <div class="field">
        <label class="label" for="draftQ">标准问题</label>
        <input class="input" id="draftQ" value="${esc(it.question)}" maxlength="120">
      </div>
      <div class="field">
        <label class="label" for="draftC">分类</label>
        <select class="select" id="draftC">
          <option>报警处理</option><option>工艺调试</option><option>保修政策</option><option>服务流程</option><option>安装搬迁</option>
        </select>
      </div>
      <div class="field">
        <label class="label" for="draftA">标准答案</label>
        <textarea class="textarea" id="draftA" maxlength="1000" placeholder="请根据官方手册填写可执行步骤，并标注章节与页码。">【待补充】请运营根据手册与工程师意见填写标准答案。

建议引用：${esc(it.question.includes('PT-800') ? 'PT-800 激光打标系统用户手册' : it.question.includes('VF-320') ? 'VF-320 变频空压机安装指南' : 'NC-500 操作与维护手册')} 相关章节。</textarea>
        <p class="hint">草稿不会直接入库；需运营审核并绑定引用后才能被检索命中。</p>
      </div>
      <div class="notice notice--brand">${icon('shieldCheck', 15)} 有据可答：答案必须绑定手册页码/条款，审核通过后 5 秒内生效。</div>
    </div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn--primary" id="saveDraft">保存为草稿（不入库）</button>`
  });
  m.foot.querySelector('#saveDraft').addEventListener('click', async () => {
    const q = m.body.querySelector('#draftQ').value.trim();
    const a = m.body.querySelector('#draftA').value.trim();
    if (!q) { toast('请填写标准问题', { type: 'error' }); return; }
    if (!a || a.startsWith('【待补充】')) { toast('请先补充标准答案', { type: 'error', desc: '草稿需包含可执行的处理步骤。' }); return; }
    const btn = m.foot.querySelector('#saveDraft');
    btn.disabled = true;
    btn.textContent = '生成中…';
    await api.unmatched.draftFaq(it.id);
    it.status = 'draft';
    m.close('saved');
    rerender();
    toast('FAQ 草稿已生成', { type: 'success', desc: '已进入运营审核队列，审核通过后才会入库。' });
  });
}

export async function render(root, ctx) {
  rootEl = root;
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('list'); return; }
  if (!loaded) { items = await api.unmatched.list(days); loaded = true; }

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="page-head"><div><h2 class="page-head__title">未命中问题池</h2><p class="page-head__desc">客户问了但检索答不上的问题。</p></div></div>
      <div class="card">${emptyState({ iconName: 'inbox', title: '近 7 天没有未命中问题', desc: '说明检索覆盖良好。可以到知识库补充手册，或查看看板确认自助解决率。', action: '<a class="btn btn--primary" href="#/kb">去知识库</a>' })}</div>`;
    return;
  }
  rerender();
}

export function destroy() { rootEl = null; }








