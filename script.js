/* ===== 灵感卡片墙 - 核心逻辑 ===== */

const LS_CARDS = 'inspiration_cards_v2';
const LS_SETTINGS = 'inspiration_settings_v2';

/* 预设配色（基于莫兰迪色卡：薄纱蓝/雾凇灰/薄荷灰/淡丁香/云水灰/青瓷灰） */
/* 颜色在 PRESET_COLORS 里固定，角度由 ANGLE_POOL 随机挑选，组合起来丰富不单调 */
const PRESET_COLORS = [
  { c1: '#E2E7EA', c2: '#C4D5DD', name: '薄纱蓝' },  /* 色卡第一行 水沫蓝→薄纱蓝 */
  { c1: '#E2E6E9', c2: '#D8DEDE', name: '雾凇灰' },  /* 色卡 月影白→雾凇灰 */
  { c1: '#D0E2D4', c2: '#9AB5A4', name: '薄荷灰' },  /* 色卡 薄荷灰→水灰绿 */
  { c1: '#E2E6E9', c2: '#CAC1D6', name: '淡丁香' },  /* 色卡 月影白→淡丁香灰 */
  { c1: '#D8DEDE', c2: '#BDC5C7', name: '云水灰' },  /* 色卡 雾凇灰→云水灰 */
  { c1: '#D0E2D4', c2: '#9FAEA9', name: '青瓷灰' },  /* 色卡 薄荷灰→青瓷灰 */
];
const ANGLE_POOL = [85, 100, 115, 130, 145, 160];  /* 6 种候选角度，与颜色随机组合 */

/* 6 种预设（颜色+角度随机组合），用于填充预设色块条 */
const PRESETS = PRESET_COLORS.map(c => {
  const angle = ANGLE_POOL[Math.floor(Math.random() * ANGLE_POOL.length)];
  return { type: 'gradient', c1: c.c1, c2: c.c2, angle };
});

/* 状态 */
let cards = [];
let settings = {
  fast: 50, rows: 3, floatAmp: 5, floatDur: 5,
  globalBg: { type: 'gradient', c1: '#E2E7EA', c2: '#C4D5DD', angle: 135 },  /* 默认薄纱蓝，init 时会随机覆盖 */
};
/* bg=null 的卡片（如 seed 引导卡）在本次会话内各自的独立配色，保证同屏内颜色不同 */
const sessionBgMap = new Map();  /* key: card.id, value: {type,c1,c2,angle} */
let currentView = 'belt';
let orientation = 'h';     // 'h' 横向 | 'v' 竖向
let activeTag = null;
let searchKw = '';
let editingId = null;
let pendingDeleteId = null;
let draftTags = [];
let activeLanes = [];
let dragging = false;

/* ===== 工具 ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlight(text, kw) {
  const s = escapeHtml(text);
  if (!kw) return s;
  try {
    const re = new RegExp(escapeReg(kw), 'gi');
    return s.replace(re, m => `<mark class="hl">${m}</mark>`);
  } catch { return s; }
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTimeFull(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoToLocalInput(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(s) {
  const d = new Date(s);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
function nowIso() { return new Date().toISOString(); }

function buildBg(card) {
  let bg;
  if (!card) bg = settings.globalBg;
  else if (card.bg) bg = card.bg;
  else {
    // bg=null 的卡片：查会话级独立配色表；未命中则去重分配一张新的
    if (!sessionBgMap.has(card.id)) {
      const usedNames = new Set([...sessionBgMap.values()].map(b => {
        const found = PRESET_COLORS.find(p => p.c1 === b.c1 && p.c2 === b.c2);
        return found ? found.name : null;
      }));
      const unused = PRESET_COLORS.filter(p => !usedNames.has(p.name));
      const pool = unused.length ? unused : PRESET_COLORS;
      const c = pool[Math.floor(Math.random() * pool.length)];
      const angle = ANGLE_POOL[Math.floor(Math.random() * ANGLE_POOL.length)];
      sessionBgMap.set(card.id, { type: 'gradient', c1: c.c1, c2: c.c2, angle });
    }
    bg = sessionBgMap.get(card.id);
  }
  if (!bg) return 'linear-gradient(135deg,#E2E7EA,#C4D5DD)';
  return bg.type === 'solid'
    ? bg.c1
    : `linear-gradient(${bg.angle}deg, ${bg.c1}, ${bg.c2})`;
}

/* 颜色从 PRESET_COLORS 随机选，角度从 ANGLE_POOL 随机选，组合更丰富（6×6=36 种） */
function randomPreset() {
  const c = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
  const angle = ANGLE_POOL[Math.floor(Math.random() * ANGLE_POOL.length)];
  return { type: 'gradient', c1: c.c1, c2: c.c2, angle };
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 250);
  }, 1800);
}

function applyFloatVars() {
  const r = document.documentElement.style;
  r.setProperty('--float-amp', settings.floatAmp + 'px');
  r.setProperty('--float-dur', settings.floatDur + 's');
}

/* ===== 存储 ===== */
function load() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CARDS));
    if (Array.isArray(c)) cards = c;
  } catch {}
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
    if (s && typeof s === 'object') {
      settings = {
        fast: s.fast ?? settings.fast,
        rows: s.rows ?? settings.rows,
        floatAmp: s.floatAmp ?? settings.floatAmp,
        floatDur: s.floatDur ?? settings.floatDur,
        globalBg: { ...settings.globalBg, ...(s.globalBg || {}) },
      };
    }
  } catch {}
  if (!cards.length) seed();
}
function save() { localStorage.setItem(LS_CARDS, JSON.stringify(cards)); }
function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

/* 首次进入：功能介绍 + 使用引导卡（bg=null 跟随全局，每次打开随机莫兰迪色） */
function seed() {
  cards = [
    { id: uid(), title: '✦ 歡迎來到靈感卡片牆', body: '把冒出來的靈感、讀到的好句子、語錄隨手記下來。卡片會像傳送帶一樣自動滾動展示，懸停即可靜止閱讀。', source: '使用引導', createdAt: nowIso(), tags: ['引導'], bg: null },
    { id: uid(), title: '＋ 記下第一個靈感', body: '點右上角「新建」按鈕，填標題、正文、來源、標籤，還能給每張卡片單獨配色（漸層或純色）。', source: '使用引導', createdAt: nowIso(), tags: ['引導'], bg: null },
    { id: uid(), title: '🎞️ 三種視圖自由切', body: '傳送帶：單行橫向流動；瀑布：多行多列同時滾動；網格：靜態瀏覽全部並支援拖曳排序。點頂欄圖示切換。', source: '使用引導', createdAt: nowIso(), tags: ['引導'], bg: null },
    { id: uid(), title: '↔ 橫向 / 豎向切換', body: '傳送帶和瀑布都支援橫豎方向切換。豎向時卡片排成 3-4 列縱向流動，寬度填滿螢幕；多行之間還會奇偶反向滾動。', source: '使用引導', createdAt: nowIso(), tags: ['引導'], bg: null },
    { id: uid(), title: '🌊 水中浮動 · 懸停靜止', body: '未填滿時卡片置中並像水中漂浮般輕輕晃動；把滑鼠停在某張卡上，它會靜止方便閱讀，其餘卡片繼續浮動。', source: '使用引導', createdAt: nowIso(), tags: ['引導'], bg: null },
    { id: uid(), title: '🔍 搜尋高亮 · 標籤篩選', body: '頂部搜尋框即時過濾標題/正文/來源/標籤，關鍵詞會高亮；點標籤 chip 可按標籤篩選。資料存在瀏覽器本地，可匯入匯出。', source: '使用引導', createdAt: nowIso(), tags: ['引導'], bg: null },
  ];
  save();
}

/* ===== 过滤 ===== */
function matchSearch(card, kw) {
  if (!kw) return true;
  const k = kw.toLowerCase();
  return [card.title, card.body, card.source, ...(card.tags || [])]
    .some(v => String(v ?? '').toLowerCase().includes(k));
}
function matchTag(card, tag) { return !tag || (card.tags || []).includes(tag); }
function filteredCards() {
  return cards.filter(c => matchSearch(c, searchKw) && matchTag(c, activeTag));
}

/* ===== 卡片 HTML ===== */
function cardHTML(card, { draggable = false } = {}) {
  const bg = buildBg(card);
  const tags = (card.tags || []).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');
  const source = card.source ? `<span class="card-source">— ${highlight(card.source, searchKw)}</span>` : '';
  const delay = (Math.random() * 5).toFixed(2);
  return `<div class="card" data-id="${card.id}" ${draggable ? 'draggable="true"' : ''} style="background:${bg};animation-delay:-${delay}s">
    <div class="card-title">${highlight(card.title || '（無標題）', searchKw)}</div>
    <div class="card-body">${highlight(card.body || '', searchKw)}</div>
    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
    <div class="card-foot">${source}<span class="card-time">${fmtTime(card.createdAt)}</span></div>
  </div>`;
}

/* ===== 滚动轨道 =====
 * mode: 'scroll' 满→滚动；'float' 未满→居中浮动
 * axis: 'x' 横向 | 'y' 纵向
 * direction: +1 | -1 奇偶反向
 */
class Lane {
  constructor(track, viewport, axis, direction) {
    this.track = track;
    this.viewport = viewport;
    this.axis = axis;
    this.direction = direction;
    this.offset = 0;
    this.singleSize = 0;
    this.mode = 'scroll';
    this.hoveredEl = null;
    this.originalCount = track.children.length; // 原始一份卡数，用于幂等 setup
    this.bindHover();
  }
  bindHover() {
    this.track.addEventListener('mouseover', e => {
      const c = e.target.closest('.card');
      if (c) { this.hoveredEl = c; this.applyHoverClass(); }
    });
    // 离开卡片 → 立刻清除悬停（即便仍在 track/viewport 内也要恢复滚动）
    this.track.addEventListener('mouseout', e => {
      const c = e.target.closest('.card');
      const tgt = e.relatedTarget;
      if (c && tgt && !c.contains(tgt)) {
        // 指针真正离开了这张卡
        if (this.hoveredEl === c) { this.hoveredEl = null; this.applyHoverClass(); }
      }
    });
    // 兜底：完全离开 viewport（悬停在空白→无卡）也清理
    this.viewport.addEventListener('mouseleave', () => { this.hoveredEl = null; this.applyHoverClass(); });
  }
  setup() {
    // 恢复到原始一份，防止重复调用导致指数复制
    while (this.track.children.length > this.originalCount) {
      this.track.removeChild(this.track.lastChild);
    }
    const kids = this.track.children;
    if (!kids.length) { this.mode = 'float'; this.track.classList.add('centered'); return; }
    const first = kids[0], last = kids[kids.length - 1];
    const oneSize = this.axis === 'x'
      ? (last.offsetLeft + last.offsetWidth - first.offsetLeft)
      : (last.offsetTop + last.offsetHeight - first.offsetTop);
    const vSize = this.axis === 'x' ? this.viewport.clientWidth : this.viewport.clientHeight;
    this.mode = 'scroll';
    this.track.classList.remove('centered');
    this.track.classList.add('centered-no-float');
    // 瀑布强制滚动：内容不足时复制到填满 2 倍 viewport，避免静止不滚动
    let copies = 1;
    while (oneSize * copies < vSize * 2 && copies < 20) copies++;
    const originalHtml = this.track.innerHTML;
    for (let i = 1; i < copies; i++) {
      this.track.insertAdjacentHTML('beforeend', originalHtml);
    }
    const halfIdx = Math.floor(this.track.children.length / 2);
    this.singleSize = oneSize;
    if (halfIdx < this.track.children.length && this.track.children[halfIdx]) {
      // 用半程的实际位移做无缝基准（更精确）
      const half = this.track.children[halfIdx];
      this.singleSize = this.axis === 'x'
        ? (half.offsetLeft - first.offsetLeft)
        : (half.offsetTop - first.offsetTop);
    }
    this.applyHoverClass();
  }
  applyHoverClass() {
    const cards = [...this.track.children];
    cards.forEach(c => {
      c.classList.toggle('hover-still', c === this.hoveredEl);
      // scroll 模式：所有非悬停卡都带浮动 class（轻微微晃动）
      // float 模式：本来就静止居中，也带浮动 class
      c.classList.toggle('floating', c !== this.hoveredEl);
    });
  }
  update(dt, fast) {
    if (this.mode !== 'scroll') return;
    let speed = fast;
    if (dragging) speed = 0;
    else if (this.hoveredEl) speed = 0; // 悬停彻底暂停，被选卡静止
    this.offset += speed * this.direction * dt;
    if (this.singleSize > 0) {
      if (this.offset >= this.singleSize) this.offset -= this.singleSize;
      if (this.offset < 0) this.offset += this.singleSize;
    }
    this.track.style.transform = this.axis === 'x'
      ? `translateX(${-this.offset}px)`
      : `translateY(${-this.offset}px)`;
  }
}

/* ===== 渲染 ===== */
function renderTagFilter() {
  const wrap = $('#tagFilter');
  const all = new Set();
  cards.forEach(c => (c.tags || []).forEach(t => all.add(t)));
  let html = `<button class="tag-chip-filter ${activeTag === null ? 'active' : ''}" data-tag="">全部</button>`;
  [...all].sort().forEach(t => {
    html += `<button class="tag-chip-filter ${activeTag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
  });
  wrap.innerHTML = html;
}

function laneDom(axis, direction, list, draggable) {
  const vp = document.createElement('div');
  vp.className = 'lane-vp ' + axis;
  const track = document.createElement('div');
  track.className = 'lane-track ' + axis;
  track.innerHTML = list.map(c => cardHTML(c, { draggable })).join('');
  vp.appendChild(track);
  return { vp, track };
}

/* buildLanes：用于瀑布视图
 * - 横向瀑布：固定 2 行，一行向左一行向右（+1 / -1 交替）
 * - 竖向瀑布：固定 3 列，中间列随机上下方向，两边列与中间列相反
 * 其他（传送带）调用方自行控制参数：rows/reverse
 */
function buildLanes(container, axis, list, draggable, opts) {
  container.innerHTML = '';
  let n; // lane 数量
  let dirs; // 每个 lane 的方向数组
  if (opts && opts.mode === 'falls') {
    if (axis === 'x') {
      // 横向瀑布：严格 2 行，左右反向
      n = 2;
      dirs = [+1, -1];
    } else {
      // 竖向瀑布：严格 3 列，中间随机，两边与中间相反
      n = 3;
      const midDir = Math.random() < 0.5 ? +1 : -1;
      dirs = [-midDir, midDir, -midDir];
    }
  } else {
    // 传送带等普通用法：rows = settings.rows，按 reverse 参数奇偶反向
    n = Math.max(2, settings.rows);
    dirs = Array.from({ length: n }, (_, i) => (opts && opts.reverse && (i % 2 === 1)) ? -1 : +1);
  }
  const per = Math.ceil(list.length / n);
  const lanes = [];
  for (let i = 0; i < n; i++) {
    const slice = list.slice(i * per, (i + 1) * per);
    if (!slice.length) continue;
    const dir = dirs[i] ?? +1;
    const { vp, track } = laneDom(axis, dir, slice, draggable);
    container.appendChild(vp);
    lanes.push(new Lane(track, vp, axis, dir));
  }
  return lanes;
}

function renderBelt() {
  const list = filteredCards();
  const stage = $('#beltStage');
  stage.innerHTML = '';
  if (!list.length) return;
  let lanes;
  if (orientation === 'h') {
    const { vp, track } = laneDom('x', 1, list, false);
    stage.appendChild(vp);
    lanes = [new Lane(track, vp, 'x', 1)];
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'lanes-cols';
    stage.appendChild(wrap);
    // 传送带竖向：3-4 列不反向
    lanes = buildLanes(wrap, 'y', list, false, { reverse: false });
  }
  activeLanes = lanes;
  requestAnimationFrame(() => lanes.forEach(l => l.setup()));
}

function renderFalls() {
  const list = filteredCards();
  const stage = $('#fallsStage');
  stage.innerHTML = '';
  if (!list.length) return;
  const wrap = document.createElement('div');
  if (orientation === 'h') {
    wrap.className = 'lanes-rows';
    stage.appendChild(wrap);
    // 横向瀑布：2 行，左右反向
    activeLanes = buildLanes(wrap, 'x', list, true, { mode: 'falls' });
  } else {
    wrap.className = 'lanes-cols';
    stage.appendChild(wrap);
    // 竖向瀑布：3 列，中间随机、两边反向中间
    activeLanes = buildLanes(wrap, 'y', list, true, { mode: 'falls' });
  }
  requestAnimationFrame(() => activeLanes.forEach(l => l.setup()));
}

function renderGrid() {
  const list = filteredCards();
  const wrap = $('#gridWrap');
  wrap.innerHTML = list.map(c => cardHTML(c, { draggable: true })).join('');
  // 网格卡片也持续浮动；悬停静止
  $$('#gridWrap .card').forEach(c => c.classList.add('floating'));
  activeLanes = [];
}

function renderCurrent() {
  if (currentView === 'belt') renderBelt();
  else if (currentView === 'falls') renderFalls();
  else renderGrid();
  updateEmpty();
}

function updateEmpty() {
  const list = filteredCards();
  const empty = $('#emptyState');
  if (list.length) {
    empty.classList.add('hidden');
  } else {
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent =
      cards.length === 0 ? '還沒有靈感，記下第一個吧' : '沒有符合的卡片，換個關鍵詞試試';
  }
}

/* ===== 动画循环 ===== */
let rafId = null, lastT = 0;
function loop(t) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t;
  activeLanes.forEach(l => l.update(dt, settings.fast));
  rafId = requestAnimationFrame(loop);
}
function startLoop() { if (!rafId) { lastT = 0; rafId = requestAnimationFrame(loop); } }
function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

/* ===== 视图 / 方向切换 ===== */
function setView(v) {
  currentView = v;
  $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.remove('active'));
  $('#view' + v.charAt(0).toUpperCase() + v.slice(1)).classList.add('active');
  renderCurrent();
  if (v === 'grid') stopLoop(); else startLoop();
}
function toggleOrient() {
  orientation = orientation === 'h' ? 'v' : 'h';
  $('#orientBtn').textContent = orientation === 'h' ? '↔' : '↕';
  $('#orientBtn').title = orientation === 'h' ? '橫向（點此切豎向）' : '豎向（點此切橫向）';
  renderCurrent();
}

/* ===== 卡片点击/查看 ===== */
function openView(id) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  $('#vTitle').innerHTML = highlight(c.title || '（無標題）', searchKw);
  $('#vBody').innerHTML = highlight(c.body || '', searchKw);
  $('#vSource').textContent = c.source ? `— ${c.source}` : '';
  $('#vTime').textContent = fmtTimeFull(c.createdAt);
  $('#vTags').innerHTML = (c.tags || []).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');
  $('#viewModal').classList.remove('hidden');
  $('#viewModal').dataset.id = id;
}
function closeView() { $('#viewModal').classList.add('hidden'); }

/* ===== 编辑/新建模态 ===== */
function fillPresets() {
  $('#presets').innerHTML = PRESETS.map((p, i) =>
    `<div class="preset" data-i="${i}" style="background:${p.type === 'solid' ? p.c1 : `linear-gradient(${p.angle}deg,${p.c1},${p.c2})`}" title="預設 ${i + 1}"></div>`
  ).join('');
}
function syncBgPreview() {
  const type = document.querySelector('input[name="bgType"]:checked').value;
  const c1 = $('#fC1').value, c2 = $('#fC2').value, ang = $('#fAngle').value;
  $('#angleVal').textContent = ang;
  $('#bgPreview').style.background = type === 'solid' ? c1 : `linear-gradient(${ang}deg, ${c1}, ${c2})`;
  $('#c2Wrap').style.display = type === 'solid' ? 'none' : '';
  $('#angleWrap').style.display = type === 'solid' ? 'none' : '';
}
function openEditor(id) {
  editingId = id || null;
  const c = id ? cards.find(x => x.id === id) : null;
  $('#modalTitle').textContent = id ? '編輯靈感' : '新建靈感';
  $('#fTitle').value = c?.title || '';
  $('#fBody').value = c?.body || '';
  $('#fSource').value = c?.source || '';
  $('#fTime').value = isoToLocalInput(c?.createdAt || nowIso());
  draftTags = c ? [...(c.tags || [])] : [];
  // 编辑用卡片自身配色；新建时随机分配一个莫兰迪预设
  const bg = c?.bg || randomPreset();
  document.querySelector(`input[name="bgType"][value="${bg.type === 'solid' ? 'solid' : 'gradient'}"]`).checked = true;
  $('#fC1').value = bg.c1; $('#fC2').value = bg.c2; $('#fAngle').value = bg.angle;
  $('#fUseGlobal').checked = id ? !c?.bg : false;  // 新建时默认不跟随全域，让用户自由配色
  toggleBgDisabled();
  renderDraftTags();
  syncBgPreview();
  $('#deleteBtn').classList.toggle('hidden', !id);
  $('#cardModal').classList.remove('hidden');
}
function toggleBgDisabled() {
  const useG = $('#fUseGlobal').checked;
  $$('#bgPickers input, #presets').forEach(el => { el.disabled = useG; el.style.opacity = useG ? 0.4 : 1; });
  $$('input[name="bgType"]').forEach(r => r.disabled = useG);
}
function renderDraftTags() {
  $('#tagChips').innerHTML = draftTags.map((t, i) =>
    `<span class="tag-pill">${escapeHtml(t)}<span class="x" data-i="${i}">✕</span></span>`
  ).join('');
}
function saveCard() {
  const title = $('#fTitle').value.trim();
  const body = $('#fBody').value.trim();
  if (!title && !body) { toast('標題和正文不能都為空'); return; }
  const useG = $('#fUseGlobal').checked;
  const type = document.querySelector('input[name="bgType"]:checked').value;
  const bg = useG ? null : { type, c1: $('#fC1').value, c2: $('#fC2').value, angle: +$('#fAngle').value };
  const data = {
    title, body, source: $('#fSource').value.trim(),
    createdAt: localInputToIso($('#fTime').value), tags: [...draftTags], bg,
  };
  if (editingId) {
    const idx = cards.findIndex(c => c.id === editingId);
    if (idx > -1) cards[idx] = { ...cards[idx], ...data };
    toast('已更新');
  } else {
    cards.unshift({ id: uid(), ...data });
    toast('已新增');
  }
  save();
  $('#cardModal').classList.add('hidden');
  renderTagFilter();
  renderCurrent();
}

/* ===== 删除二次确认 ===== */
function askDelete(id) {
  pendingDeleteId = id;
  const c = cards.find(x => x.id === id);
  $('#confirmText').textContent = `「${c?.title || '無標題'}」將被永久移除，無法復原。`;
  $('#confirmModal').classList.remove('hidden');
}
function doDelete() {
  if (!pendingDeleteId) return;
  cards = cards.filter(c => c.id !== pendingDeleteId);
  pendingDeleteId = null;
  save();
  $('#confirmModal').classList.add('hidden');
  $('#cardModal').classList.add('hidden');
  renderTagFilter();
  renderCurrent();
  toast('已刪除');
}

/* ===== 搜索 ===== */
function onSearch() { searchKw = $('#searchInput').value.trim(); renderCurrent(); }

/* ===== 导入导出 ===== */
function exportJSON() {
  const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inspiration-cards-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已匯出');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const arr = JSON.parse(reader.result);
      if (!Array.isArray(arr)) throw 0;
      const valid = arr.filter(c => c && typeof c === 'object' && (c.title || c.body));
      valid.forEach(c => {
        if (!c.id) c.id = uid();
        if (!c.createdAt) c.createdAt = nowIso();
        if (!Array.isArray(c.tags)) c.tags = [];
        if (c.bg && typeof c.bg !== 'object') c.bg = null;
      });
      cards = valid.concat(cards);
      save();
      renderTagFilter();
      renderCurrent();
      toast(`已匯入 ${valid.length} 張`);
    } catch { toast('匯入失敗：檔案格式不正確'); }
  };
  reader.readAsText(file);
}

/* ===== 拖拽排序 ===== */
let dragSrcId = null;
function bindDnd(container) {
  container.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    dragSrcId = card.dataset.id;
    dragging = true;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcId);
  });
  container.addEventListener('dragend', e => {
    dragging = false;
    const card = e.target.closest('.card');
    if (card) card.classList.remove('dragging');
    $$('.card.drag-over').forEach(c => c.classList.remove('drag-over'));
    dragSrcId = null;
  });
  container.addEventListener('dragover', e => {
    const card = e.target.closest('.card');
    if (!card || card.dataset.id === dragSrcId) return;
    e.preventDefault();
    $$('.card.drag-over').forEach(c => c.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });
  container.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.card');
    if (!card || !dragSrcId || card.dataset.id === dragSrcId) return;
    const from = cards.findIndex(c => c.id === dragSrcId);
    const to = cards.findIndex(c => c.id === card.dataset.id);
    if (from < 0 || to < 0) return;
    const rect = card.getBoundingClientRect();
    const after = (e.clientX - rect.left) > rect.width / 2;
    const [moved] = cards.splice(from, 1);
    let insertAt = cards.findIndex(c => c.id === card.dataset.id);
    if (after) insertAt += 1;
    cards.splice(insertAt, 0, moved);
    save();
    renderCurrent();
  });
}

/* ===== 设置面板 ===== */
function openSettings() {
  $('#setFast').value = settings.fast; $('#fastVal').textContent = settings.fast;
  $('#setRows').value = settings.rows; $('#rowsVal').textContent = settings.rows;
  $('#setAmp').value = settings.floatAmp; $('#ampVal').textContent = settings.floatAmp;
  $('#setDur').value = settings.floatDur; $('#durVal').textContent = settings.floatDur;
  const g = settings.globalBg;
  document.querySelector(`input[name="gBgType"][value="${g.type === 'solid' ? 'solid' : 'gradient'}"]`).checked = true;
  $('#gC1').value = g.c1; $('#gC2').value = g.c2; $('#gAngle').value = g.angle;
  syncGlobalPreview();
  $('#settingsModal').classList.remove('hidden');
}
function syncGlobalPreview() {
  const type = document.querySelector('input[name="gBgType"]:checked').value;
  const c1 = $('#gC1').value, c2 = $('#gC2').value, ang = $('#gAngle').value;
  $('#gAngleVal').textContent = ang;
  $('#gBgPreview').style.background = type === 'solid' ? c1 : `linear-gradient(${ang}deg, ${c1}, ${c2})`;
  $('#gC2Wrap').style.display = type === 'solid' ? 'none' : '';
  $('#gAngleWrap').style.display = type === 'solid' ? 'none' : '';
}
function saveGlobalFromSettings() {
  settings.globalBg = {
    type: document.querySelector('input[name="gBgType"]:checked').value,
    c1: $('#gC1').value, c2: $('#gC2').value, angle: +$('#gAngle').value,
  };
  saveSettings();
  renderCurrent();
}

/* ===== 事件绑定 ===== */
function bindEvents() {
  $('#viewSwitch').addEventListener('click', e => {
    const b = e.target.closest('.view-btn');
    if (b) setView(b.dataset.view);
  });
  $('#orientBtn').addEventListener('click', toggleOrient);
  $('#searchInput').addEventListener('input', onSearch);

  $('#tagFilter').addEventListener('click', e => {
    const b = e.target.closest('.tag-chip-filter');
    if (!b) return;
    activeTag = b.dataset.tag || null;
    renderTagFilter();
    renderCurrent();
  });

  $('#newBtn').addEventListener('click', () => openEditor(null));
  $('#emptyNewBtn').addEventListener('click', () => openEditor(null));

  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); $('#menuPop').classList.toggle('hidden'); });
  document.addEventListener('click', e => {
    if (!e.target.closest('#menuPop') && !e.target.closest('#menuBtn')) $('#menuPop').classList.add('hidden');
  });
  $('#exportBtn').addEventListener('click', () => { exportJSON(); $('#menuPop').classList.add('hidden'); });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
    $('#menuPop').classList.add('hidden');
  });
  $('#settingsBtn').addEventListener('click', () => { openSettings(); $('#menuPop').classList.add('hidden'); });

  // 卡片点击（委托）→ 打开查看
  ['beltStage', 'fallsStage', 'gridWrap'].forEach(id => {
    $('#' + id).addEventListener('click', e => {
      if (dragging) return;
      const card = e.target.closest('.card');
      if (card) openView(card.dataset.id);
    });
  });

  // 网格悬停：进入卡片静止，离开卡片立刻清除（不用等到出 gridWrap）
  const grid = $('#gridWrap');
  grid.addEventListener('mouseover', e => {
    const c = e.target.closest('.card');
    if (c) {
      $$('#gridWrap .hover-still').forEach(x => x.classList.remove('hover-still'));
      c.classList.add('hover-still');
    }
  });
  grid.addEventListener('mouseout', e => {
    const c = e.target.closest('.card');
    const tgt = e.relatedTarget;
    if (c && tgt && !c.contains(tgt)) {
      c.classList.remove('hover-still');
    }
  });
  grid.addEventListener('mouseleave', () => $$('#gridWrap .hover-still').forEach(x => x.classList.remove('hover-still')));

  // 查看模态
  $('#viewClose').addEventListener('click', closeView);
  $('#viewClose2').addEventListener('click', closeView);
  $('#viewEdit').addEventListener('click', () => { const id = $('#viewModal').dataset.id; closeView(); openEditor(id); });
  $('#viewModal').addEventListener('click', e => { if (e.target.id === 'viewModal') closeView(); });

  // 编辑模态
  $('#modalClose').addEventListener('click', () => $('#cardModal').classList.add('hidden'));
  $('#cancelBtn').addEventListener('click', () => $('#cardModal').classList.add('hidden'));
  $('#saveBtn').addEventListener('click', saveCard);
  $('#deleteBtn').addEventListener('click', () => askDelete(editingId));
  $('#cardModal').addEventListener('click', e => { if (e.target.id === 'cardModal') $('#cardModal').classList.add('hidden'); });

  // 标签输入
  $('#fTagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = e.target.value.trim().replace(/,$/, '').trim();
      if (v && !draftTags.includes(v)) { draftTags.push(v); renderDraftTags(); }
      e.target.value = '';
    } else if (e.key === 'Backspace' && !e.target.value && draftTags.length) {
      draftTags.pop(); renderDraftTags();
    }
  });
  $('#tagChips').addEventListener('click', e => {
    const x = e.target.closest('.x');
    if (x) { draftTags.splice(+x.dataset.i, 1); renderDraftTags(); }
  });

  // 背景配色控件
  $$('input[name="bgType"]').forEach(r => r.addEventListener('change', syncBgPreview));
  ['#fC1', '#fC2'].forEach(s => $(s).addEventListener('input', syncBgPreview));
  $('#fAngle').addEventListener('input', syncBgPreview);
  $('#fUseGlobal').addEventListener('change', () => { toggleBgDisabled(); syncBgPreview(); });
  $('#presets').addEventListener('click', e => {
    const p = e.target.closest('.preset');
    if (!p || $('#fUseGlobal').checked) return;
    const pre = PRESETS[+p.dataset.i];
    document.querySelector(`input[name="bgType"][value="${pre.type}"]`).checked = true;
    $('#fC1').value = pre.c1; $('#fC2').value = pre.c2; $('#fAngle').value = pre.angle;
    syncBgPreview();
  });

  // 删除确认
  $('#confirmCancel').addEventListener('click', () => { $('#confirmModal').classList.add('hidden'); pendingDeleteId = null; });
  $('#confirmOk').addEventListener('click', doDelete);
  $('#confirmModal').addEventListener('click', e => { if (e.target.id === 'confirmModal') { $('#confirmModal').classList.add('hidden'); pendingDeleteId = null; } });

  // 设置
  $('#settingsClose').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsCancel').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') $('#settingsModal').classList.add('hidden'); });
  $('#setFast').addEventListener('input', e => { settings.fast = +e.target.value; $('#fastVal').textContent = settings.fast; saveSettings(); });
  $('#setRows').addEventListener('input', e => { settings.rows = +e.target.value; $('#rowsVal').textContent = settings.rows; saveSettings(); if (currentView !== 'grid') renderCurrent(); });
  $('#setAmp').addEventListener('input', e => { settings.floatAmp = +e.target.value; $('#ampVal').textContent = settings.floatAmp; saveSettings(); applyFloatVars(); });
  $('#setDur').addEventListener('input', e => { settings.floatDur = +e.target.value; $('#durVal').textContent = settings.floatDur; saveSettings(); applyFloatVars(); });
  $$('input[name="gBgType"]').forEach(r => r.addEventListener('change', () => { syncGlobalPreview(); saveGlobalFromSettings(); }));
  ['#gC1', '#gC2'].forEach(s => $(s).addEventListener('input', () => { syncGlobalPreview(); saveGlobalFromSettings(); }));
  $('#gAngle').addEventListener('input', () => { syncGlobalPreview(); saveGlobalFromSettings(); });

  // 拖拽排序
  bindDnd($('#gridWrap'));
  bindDnd($('#fallsStage'));

  window.addEventListener('resize', () => activeLanes.forEach(l => l.setup()));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $$('.modal-mask:not(.hidden)').forEach(m => m.classList.add('hidden'));
      pendingDeleteId = null;
    }
  });
}

/* ===== 启动 ===== */
function init() {
  load();
  // 清空会话级卡片独立配色，让 bg=null 的卡片在本次刷新中重新去重随机分配
  sessionBgMap.clear();
  // 每次打开页面，全局背景从莫兰迪预设里随机选一个（不持久化，刷新即换）
  settings.globalBg = randomPreset();
  applyFloatVars();
  fillPresets();
  bindEvents();
  renderTagFilter();
  setView('belt');
}
init();
