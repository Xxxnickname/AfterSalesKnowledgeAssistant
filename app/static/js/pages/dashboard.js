/* dashboard.js — 1-6 数据看板：4 指标 + 2 张手写 SVG 趋势图 + 差评列表 */
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDateTime, starsHtml, toast, emptyState, skeletonPage } from '../components.js';

let data = null;
let range = 14;
let hidden = { sessions: false, escalation: false };
let rootEl = null;

const REASONS = [
  ['低分未命中', 38], ['客户主动转人工', 27], ['敏感意图', 18], ['多轮未解决', 11], ['图片识别失败', 6]
];
const ALERTS = [
  { tone: 'danger', icon: 'clock', title: '1 个会话等待超过 6 分钟', sub: 's_20261101_0037 · 常州瑞泰医疗 · 投诉风险', time: '10:02' },
  { tone: 'warning', icon: 'alertTriangle', title: '1 份文档解析失败', sub: 'VF-320 备件目录 · 第 12–19 页表格识别失败', time: '09:58' },
  { tone: 'warning', icon: 'flag', title: '2 条低分评价待回访', sub: '孙倩（1 星）· 林芳（2 星）· 责任坐席李婷', time: '09:41' }
];

const W = 680, H = 236;
const PAD = { l: 44, r: 38, t: 16, b: 28 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

const xAt = (i, n) => PAD.l + (n <= 1 ? PLOT_W / 2 : (i * PLOT_W) / (n - 1));
const yAt = (v, min, max) => PAD.t + PLOT_H - ((v - min) / (max - min)) * PLOT_H;
const dayLabel = (d) => d.slice(5);

function sparkline(values, tone = 'var(--brand-500)') {
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i * 92) / (values.length - 1)},${27 - ((v - min) / span) * 22}`).join(' ');
  const [lx, ly] = pts.split(' ').pop().split(',');
  return `<svg class="dash-spark" viewBox="0 0 92 30" aria-hidden="true" style="color:${tone}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/><circle cx="${lx}" cy="${ly}" r="2.2" fill="currentColor"/></svg>`;
}

function deltaHtml(m) {
  const good = m.direction === 'down' ? m.delta < 0 : m.delta > 0;
  const up = m.delta > 0;
  return `<span class="delta ${good ? 'delta--up' : 'delta--down'}">${icon(up ? 'arrowUp' : 'arrowDown', 11)} ${Math.abs(m.delta).toFixed(m.key === 'first_response_p95' ? 2 : 1)}${m.key === 'first_response_p95' ? 's' : m.key === 'satisfaction' ? '' : 'pp'}</span>`;
}

function metricIcon(key) {
  return key === 'self_service_rate' ? 'target' : key === 'escalation_rate' ? 'headset' : key === 'first_response_p95' ? 'bolt' : 'star';
}

function metricsHtml(trend) {
  return `<div class="dash-metrics">${data.metrics.map((m) => {
    const values = trend.map((t) => m.key === 'self_service_rate' ? t.self_service : m.key === 'escalation_rate' ? (100 - t.self_service) : m.key === 'first_response_p95' ? t.first_response : t.satisfaction);
    return `<div class="dash-metric">
      <div class="dash-metric__top"><span>${esc(m.label)}</span><span class="badge badge--neutral">${icon(metricIcon(m.key), 11)} 目标 ${m.key === 'first_response_p95' ? '≤' : ''}${m.target}${m.unit === '%' ? '%' : m.unit === 's' ? 's' : ''}</span></div>
      <div class="dash-metric__value">${m.value.toFixed(m.key === 'first_response_p95' ? 2 : 1)}<small>${esc(m.unit)}</small></div>
      <div class="dash-metric__foot">${deltaHtml(m)}<span>较上周期</span></div>
      ${sparkline(values, m.key === 'escalation_rate' || m.key === 'first_response_p95' ? 'var(--warning-500)' : 'var(--brand-500)')}
    </div>`;
  }).join('')}</div>`;
}

function chartAHtml(trend) {
  const maxS = 200, maxE = 60;
  const n = trend.length;
  const band = PLOT_W / n;
  const yTicks = [0, 50, 100, 150, 200].map((v) => {
    const y = yAt(v, 0, maxS);
    return `<line class="dash-grid-line" x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}"/><text class="dash-axis" x="${PAD.l - 7}" y="${y + 3}" text-anchor="end">${v}</text><text class="dash-axis" x="${W - PAD.r + 6}" y="${y + 3}">${Math.round(v / maxS * maxE)}</text>`;
  }).join('');
  const sPts = trend.map((t, i) => `${xAt(i, n)},${yAt(t.sessions, 0, maxS)}`).join(' ');
  const area = `${PAD.l},${PAD.t + PLOT_H} ${sPts} ${W - PAD.r},${PAD.t + PLOT_H}`;
  const bars = trend.map((t, i) => {
    const h = (t.escalation / maxE) * PLOT_H;
    const x = xAt(i, n) - Math.min(11, band * .42) / 2;
    return `<rect class="dash-bar" x="${x}" y="${PAD.t + PLOT_H - h}" width="${Math.min(11, band * .42)}" height="${h}" rx="2"><title>${t.date} · 转人工 ${t.escalation} 次</title></rect>`;
  }).join('');
  const dots = trend.map((t, i) => `<circle class="dash-dot" cx="${xAt(i, n)}" cy="${yAt(t.sessions, 0, maxS)}" r="2.6"><title>${t.date} · 会话 ${t.sessions} 次 · 转人工 ${t.escalation} 次</title></circle>`).join('');
  const xLabels = trend.map((t, i) => (i % 3 === 0) ? `<text class="dash-axis" x="${xAt(i, n)}" y="${H - 8}" text-anchor="middle">${dayLabel(t.date)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日会话量与转人工量趋势图">
    <title>每日会话量与转人工量（近 ${n} 天）</title>
    ${yTicks}
    ${hidden.sessions ? '' : `<polygon class="dash-area" points="${area}"/><polyline class="dash-line" points="${sPts}"/>${dots}`}
    ${hidden.escalation ? '' : bars}
    ${xLabels}
  </svg>`;
}

function chartBHtml(trend) {
  const min = 55, max = 75;
  const n = trend.length;
  const ticks = [55, 60, 65, 70, 75].map((v) => {
    const y = yAt(v, min, max);
    return `<line class="dash-grid-line" x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}"/><text class="dash-axis" x="${PAD.l - 7}" y="${y + 3}" text-anchor="end">${v}%</text>`;
  }).join('');
  const pts = trend.map((t, i) => `${xAt(i, n)},${yAt(t.self_service, min, max)}`).join(' ');
  const dots = trend.map((t, i) => `<circle class="dash-dot" cx="${xAt(i, n)}" cy="${yAt(t.self_service, min, max)}" r="2.6"><title>${t.date} · 自助解决率 ${t.self_service}%</title></circle>`).join('');
  const last = trend[n - 1];
  const targetY = yAt(65, min, max);
  const xLabels = trend.map((t, i) => (i % 3 === 0) ? `<text class="dash-axis" x="${xAt(i, n)}" y="${H - 8}" text-anchor="middle">${dayLabel(t.date)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="自助解决率与目标线">
    <title>自助解决率 vs 目标 65%（近 ${n} 天）</title>
    ${ticks}
    <line class="dash-line--target" x1="${PAD.l}" y1="${targetY}" x2="${W - PAD.r}" y2="${targetY}"/>
    <text class="dash-axis" x="${W - PAD.r}" y="${targetY - 5}" text-anchor="end">目标 65%</text>
    <polyline class="dash-line" points="${pts}"/>
    ${dots}
    <circle class="dash-dot" cx="${xAt(n - 1, n)}" cy="${yAt(last.self_service, min, max)}" r="4"/>
    <text class="dash-label" x="${xAt(n - 1, n) - 6}" y="${yAt(last.self_service, min, max) - 10}" text-anchor="end">${last.self_service}%</text>
    ${xLabels}
  </svg>`;
}

function feedHtml() {
  return `<div class="table-wrap"><table class="table dash-feed" style="min-width:760px">
    <thead><tr><th style="width:88px">评分</th><th style="width:170px">客户</th><th style="width:104px">原因</th><th>评论</th><th style="width:130px">会话 / 时间</th><th style="width:80px">状态</th></tr></thead>
    <tbody>${data.negative.map((n) => `<tr>
      <td><div class="row" style="gap:4px">${starsHtml(n.score, 11)}<span class="mono" style="font-size:var(--fs-12);color:var(--ink-400)">${n.score}.0</span></div></td>
      <td><div class="dash-feed__who">${esc(n.customer)}</div><div class="dash-feed__sub">${esc(n.company)}</div></td>
      <td><span class="badge badge--warning">${esc(n.reason)}</span></td>
      <td><div class="dash-feed__comment" title="${esc(n.comment)}">${esc(n.comment)}</div></td>
      <td><div class="mono" style="font-size:var(--fs-12)">${esc(n.session_id)}</div><div class="dash-feed__sub">${esc(fmtDateTime(n.created_at))}</div></td>
      <td>${n.resolved ? '<span class="badge badge--success badge--dot">已处理</span>' : '<span class="badge badge--danger badge--dot">待回访</span>'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function shellHtml() {
  const trend = data.trend.slice(-range);
  return `<div class="dash-page">
    <div class="page-head">
      <div><h2 class="page-head__title">数据看板</h2><p class="page-head__desc">近 ${range} 天 · 数据截至 ${esc(fmtDateTime(data.generated_at))} · 演示环境</p></div>
      <div class="page-head__actions">
        <div class="segmented" role="group" aria-label="时间范围">
          <button data-range="7" aria-pressed="${range === 7}">近 7 天</button>
          <button data-range="14" aria-pressed="${range === 14}">近 14 天</button>
          <button data-range="30" aria-pressed="false" disabled title="G1 演示数据仅含近 14 天">近 30 天</button>
        </div>
        <button class="btn btn--sm" id="exportBtn">${icon('download', 14)} 导出报表</button>
      </div>
    </div>
    ${metricsHtml(trend)}
    <div class="dash-charts">
      <section class="card dash-chart">
        <div class="dash-chart__head"><div><div class="dash-chart__title">每日会话量与转人工量</div><div class="dash-chart__sub">左轴：会话量 · 右轴：转人工次数</div></div><span class="badge badge--neutral">${trend.length} 天</span></div>
        <div class="dash-legend">
          <button data-series="sessions" aria-pressed="${!hidden.sessions}"><span class="swatch"></span>会话量</button>
          <button data-series="escalation" aria-pressed="${!hidden.escalation}"><span class="swatch swatch--alt"></span>转人工量</button>
        </div>
        <div class="dash-chart__body">${chartAHtml(trend)}</div>
      </section>
      <section class="card dash-chart">
        <div class="dash-chart__head"><div><div class="dash-chart__title">自助解决率 vs 目标</div><div class="dash-chart__sub">目标线 65% · 当前 ${data.metrics[0].value}%</div></div><span class="badge badge--success badge--dot">达标</span></div>
        <div class="dash-legend"><button aria-pressed="true" style="cursor:default"><span class="swatch"></span>自助解决率</button><span class="dash-legend" style="padding:0"><span class="swatch swatch--line"></span>目标 65%</span></div>
        <div class="dash-chart__body">${chartBHtml(trend)}</div>
      </section>
    </div>
    <div class="dash-bottom">
      <section class="card">
        <div class="card__head"><div><div class="card__title">差评反馈</div><div class="card__desc">近 14 天 1–3 星评价 · ${data.negative.filter((n) => !n.resolved).length} 条待回访</div></div><button class="btn btn--ghost btn--sm" id="allFeedback">查看全部</button></div>
        ${data.negative.length ? feedHtml() : emptyState({ iconName: 'star', title: '暂无差评', desc: '当前时间范围内没有 1–3 星评价。', compact: true })}
      </section>
      <div class="stack">
        <section class="card">
          <div class="card__head" style="padding:var(--sp-4) var(--sp-5)"><div><div class="card__title" style="font-size:var(--fs-14)">转人工原因分布</div><div class="card__desc">演示分布 · 近 14 天</div></div></div>
          <div class="dash-bars">${REASONS.map(([label, v]) => `<div class="dash-bar-row"><span>${esc(label)}</span><span class="track"><span style="width:${v}%"></span></span><span class="v">${v}%</span></div>`).join('')}</div>
        </section>
        <section class="card">
          <div class="card__head" style="padding:var(--sp-4) var(--sp-5)"><div><div class="card__title" style="font-size:var(--fs-14)">待处理提醒</div><div class="card__desc">3 项需要关注</div></div><span class="badge badge--warning">SLA</span></div>
          <div class="dash-alerts">${ALERTS.map((a) => `<div class="dash-alert"><span class="dash-alert__icon ${a.tone === 'danger' ? 'dash-alert__icon--danger' : ''}">${icon(a.icon, 14)}</span><div class="dash-alert__main"><div class="dash-alert__title">${esc(a.title)}</div><div class="dash-alert__sub">${esc(a.sub)}</div></div><span class="dash-alert__time">${esc(a.time)}</span></div>`).join('')}</div>
        </section>
      </div>
    </div>
  </div>`;
}

function bind() {
  const root = rootEl;
  root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    range = Number(b.dataset.range);
    rerender();
  }));
  root.querySelectorAll('[data-series]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.series;
    if (hidden.sessions && hidden.escalation) { toast('至少保留一条趋势线', { type: 'warning' }); return; }
    hidden = { ...hidden, [key]: !hidden[key] };
    rerender();
  }));
  root.querySelector('#exportBtn')?.addEventListener('click', () => toast('报表已生成', { type: 'success', desc: `近 ${range} 天服务指标将导出为 CSV（G1 演示占位）。` }));
  root.querySelector('#allFeedback')?.addEventListener('click', () => toast('差评工作台', { type: 'info', desc: 'G1 演示：可到「会话质检」逐条复核。', duration: 3200 }));
}

function rerender() {
  if (!rootEl) return;
  rootEl.innerHTML = shellHtml();
  bind();
}

export async function render(root, ctx) {
  rootEl = root;
  if (ctx.state === 'loading') { root.innerHTML = skeletonPage('list'); return; }
  data = await api.dashboard.get();

  if (ctx.state === 'empty') {
    root.innerHTML = `<div class="page-head"><div><h2 class="page-head__title">数据看板</h2><p class="page-head__desc">近 14 天 · 演示环境</p></div></div>
      <div class="card">${emptyState({ iconName: 'chart', title: '所选时间范围暂无数据', desc: '指标与趋势会在有真实会话后生成。可以切换到近 14 天查看演示数据，或前往知识库补全资料。', action: '<button class="btn btn--primary" data-empty-range>查看近 14 天</button><a class="btn" href="#/kb">去知识库</a>' })}</div>`;
    root.querySelector('[data-empty-range]')?.addEventListener('click', () => {
      ctx.clearStateParam();
      render(root, { ...ctx, state: 'default' });
    });
    return;
  }
  hidden = { sessions: false, escalation: false };
  rerender();
}

export function destroy() { rootEl = null; }



