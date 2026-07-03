/* 直播吧赛程比分 popup */

const HOME_URL = 'https://www.zhibo8.com/';
const SCORE_LIST_URL = 'https://bifen4pc2.qiumibao.com/json/list.htm';
const DETAIL_URL = (date, id) => `https://bifen4pc.qiumibao.com/json/${date}/${id}.htm`;

const TABS = [
  { key: 'all', name: '全部' },
  { key: 'football', name: '足球' },
  { key: 'basketball', name: '篮球' },
  { key: 'game', name: '电竞' },
  { key: 'other', name: '综合' },
  { key: 'finished', name: '完赛' },
];

const TYPE_NAMES = {
  football: '足球',
  basketball: '篮球',
  game: '电竞',
};

// 进球/事件代码 → 图标
const EVENT_ICONS = { 1: '⚽', 2: '⚽点球', 3: '⚽乌龙', 7: '🟥', 8: '🟨' };

const state = {
  matches: [],       // 首页解析出的赛程
  scores: {},        // id -> 实时比分
  activeTab: 'all',
  pinnedTab: null,
  detailCache: {},   // id -> {time, data}
};

const $list = document.getElementById('list');
const $tabs = document.getElementById('tabs');
const $tooltip = document.getElementById('tooltip');
const $updateTime = document.getElementById('updateTime');
const $refreshBtn = document.getElementById('refreshBtn');

/* ---------------- 数据获取 ---------------- */

async function fetchSchedule() {
  const res = await fetch(HOME_URL, { credentials: 'omit' });
  if (!res.ok) throw new Error(`首页请求失败 HTTP ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const seen = new Set();
  const matches = [];
  doc.querySelectorAll('.schedule li[id^="saishi"]').forEach((li) => {
    const id = (li.id || '').replace('saishi', '');
    if (!id || id === '0' || seen.has(id)) return;
    const time = li.getAttribute('data-time') || '';
    if (!time) return;
    seen.add(id);

    const league = li.querySelector('._league')?.textContent.trim() || '';
    const label = li.getAttribute('label') || '';
    const type = li.getAttribute('data-type') || 'other';

    // 解析对阵：<span class="_teams"> 左队 <img/><span> - </span><img/> 右队 </span>
    let leftName = '', rightName = '', leftLogo = '', rightLogo = '';
    const teamsEl = li.querySelector('._teams');
    if (teamsEl) {
      const imgs = teamsEl.querySelectorAll('img');
      if (imgs.length >= 2) {
        leftLogo = imgs[0].getAttribute('src') || '';
        rightLogo = imgs[imgs.length - 1].getAttribute('src') || '';
      }
      const nodes = Array.from(teamsEl.childNodes);
      const firstImgIdx = nodes.findIndex((n) => n.nodeName === 'IMG');
      const lastImgIdx = nodes.map((n) => n.nodeName).lastIndexOf('IMG');
      if (firstImgIdx > -1) {
        leftName = nodes.slice(0, firstImgIdx).map((n) => n.textContent).join('').trim();
        rightName = nodes.slice(lastImgIdx + 1).map((n) => n.textContent).join('').trim();
      } else {
        leftName = teamsEl.textContent.trim();
      }
    }

    // 直播链接与频道
    let url = '';
    const channels = [];
    li.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const text = a.textContent.trim();
      if (!url && /\/zhibo\//.test(href) && !/shouji/.test(href)) {
        url = href.startsWith('http') ? href : 'https://www.zhibo8.com' + href;
      }
      if (text && !['手机看直播', '比分', '动画'].includes(text)) channels.push(text);
    });

    matches.push({
      id,
      time,
      date: time.slice(0, 10),
      hm: time.slice(11, 16),
      type,
      league,
      label,
      leftName,
      rightName,
      leftLogo,
      rightLogo,
      url,
      channels: channels.join(' '),
    });
  });

  matches.sort((a, b) => a.time.localeCompare(b.time));
  state.matches = matches;
}

async function fetchScores() {
  try {
    const res = await fetch(SCORE_LIST_URL + '?r=' + Math.random(), { credentials: 'omit' });
    if (!res.ok) return;
    const data = await res.json();
    const map = {};
    (data.list || []).forEach((m) => { map[m.id] = m; });
    state.scores = map;
    $updateTime.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (e) {
    /* 静默失败，保留上次比分 */
  }
}

async function fetchDetail(match) {
  const cached = state.detailCache[match.id];
  if (cached && Date.now() - cached.time < 15000) return cached.data;
  try {
    const res = await fetch(DETAIL_URL(match.date, match.id) + '?r=' + Math.random(), { credentials: 'omit' });
    if (!res.ok) throw new Error('no detail');
    const data = await res.json();
    state.detailCache[match.id] = { time: Date.now(), data };
    return data;
  } catch (e) {
    state.detailCache[match.id] = { time: Date.now(), data: null };
    return null;
  }
}

/* ---------------- Tab ---------------- */

function renderTabs() {
  $tabs.innerHTML = '';
  TABS.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'tab' + (state.activeTab === tab.key ? ' active' : '');
    el.dataset.key = tab.key;

    const name = document.createElement('span');
    name.textContent = tab.name;
    el.appendChild(name);

    const pin = document.createElement('span');
    pin.className = 'pin' + (state.pinnedTab === tab.key ? ' pinned' : '');
    pin.textContent = '📌';
    pin.title = state.pinnedTab === tab.key ? '取消固定' : '固定此Tab（下次打开默认显示）';
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(tab.key);
    });
    el.appendChild(pin);

    el.addEventListener('click', () => {
      state.activeTab = tab.key;
      renderTabs();
      renderList();
    });
    $tabs.appendChild(el);
  });
}

function togglePin(key) {
  state.pinnedTab = state.pinnedTab === key ? null : key;
  chrome.storage.local.set({ pinnedTab: state.pinnedTab });
  renderTabs();
}

function matchInTab(m, tabKey) {
  switch (tabKey) {
    case 'all': return true;
    case 'football':
    case 'basketball':
    case 'game':
      return m.type === tabKey;
    case 'other':
      return !['football', 'basketball', 'game'].includes(m.type);
    case 'finished': {
      const s = state.scores[m.id];
      return !!s && s.state === '3';
    }
    default: return true;
  }
}

/* ---------------- 列表渲染 ---------------- */

function statusOf(m) {
  const s = state.scores[m.id];
  if (!s) return { text: '', cls: '' };
  if (s.state === '2') return { text: s.period_cn || '进行中', cls: 'live' };
  if (s.state === '3') return { text: '完赛', cls: 'done' };
  if (s.state === '4') return { text: s.period_cn || '延期', cls: '' };
  return { text: s.period_cn || '', cls: '' };
}

// 比分 json 中 home/visit 与页面左右队的对应关系由 rightishome 决定
function displayScore(m) {
  const s = state.scores[m.id];
  if (!s || (s.state !== '2' && s.state !== '3')) return null;
  const rightIsHome = s.rightishome === '1';
  return {
    left: rightIsHome ? s.visit_score : s.home_score,
    right: rightIsHome ? s.home_score : s.visit_score,
    live: s.state === '2',
  };
}

function renderList() {
  const items = state.matches.filter((m) => matchInTab(m, state.activeTab));
  $list.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.activeTab === 'finished' ? '暂无完赛比赛' : '暂无比赛';
    $list.appendChild(empty);
    return;
  }

  let lastDate = '';
  const today = new Date().toISOString().slice(0, 10);
  items.forEach((m) => {
    if (m.date !== lastDate) {
      lastDate = m.date;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = m.date === today ? `今天 ${m.date}` : m.date;
      $list.appendChild(sep);
    }
    $list.appendChild(buildRow(m));
  });
}

function buildRow(m) {
  const row = document.createElement('div');
  row.className = 'match';
  row.dataset.id = m.id;

  const time = document.createElement('div');
  time.className = 'm-time';
  time.textContent = m.hm;
  row.appendChild(time);

  const badge = document.createElement('span');
  badge.className = 'type-badge type-' + (TYPE_NAMES[m.type] ? m.type : 'other');
  badge.textContent = TYPE_NAMES[m.type] || '综合';
  row.appendChild(badge);

  const league = document.createElement('div');
  league.className = 'm-league';
  league.textContent = m.league;
  league.title = m.league;
  row.appendChild(league);

  if (m.leftName || m.rightName) {
    const teams = document.createElement('div');
    teams.className = 'm-teams';

    const left = document.createElement('div');
    left.className = 'm-team left';
    const leftSpan = document.createElement('span');
    leftSpan.textContent = m.leftName;
    left.appendChild(leftSpan);
    if (m.leftLogo) {
      const img = document.createElement('img');
      img.src = m.leftLogo;
      left.appendChild(img);
    }

    const vs = document.createElement('div');
    vs.className = 'm-vs';
    const sc = displayScore(m);
    if (sc) {
      vs.textContent = `${sc.left} - ${sc.right}`;
      vs.classList.add(sc.live ? 'live' : 'done');
    } else {
      vs.textContent = 'VS';
    }

    const right = document.createElement('div');
    right.className = 'm-team right';
    if (m.rightLogo) {
      const img = document.createElement('img');
      img.src = m.rightLogo;
      right.appendChild(img);
    }
    const rightSpan = document.createElement('span');
    rightSpan.textContent = m.rightName;
    right.appendChild(rightSpan);

    teams.appendChild(left);
    teams.appendChild(vs);
    teams.appendChild(right);
    row.appendChild(teams);
  } else {
    const single = document.createElement('div');
    single.className = 'm-single';
    single.textContent = m.channels || m.league;
    row.appendChild(single);
  }

  const status = document.createElement('div');
  const st = statusOf(m);
  status.className = 'm-status ' + st.cls;
  status.textContent = st.text || (m.date + ' ' + m.hm > nowStr() ? '未开始' : '');
  row.appendChild(status);

  if (m.url) {
    row.title = '点击打开直播页';
    row.addEventListener('click', () => chrome.tabs.create({ url: m.url }));
  }

  row.addEventListener('mouseenter', () => showTooltip(row, m));
  row.addEventListener('mouseleave', hideTooltip);
  return row;
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- 悬浮详情 ---------------- */

let hoverToken = 0;

async function showTooltip(row, m) {
  const token = ++hoverToken;
  $tooltip.classList.remove('hidden');
  $tooltip.innerHTML = '';
  $tooltip.appendChild(buildTooltipHeader(m));
  const loading = document.createElement('div');
  loading.className = 'tt-loading';
  loading.textContent = '加载详情中…';
  $tooltip.appendChild(loading);
  positionTooltip(row);

  const detail = await fetchDetail(m);
  if (token !== hoverToken) return; // 鼠标已移到其他比赛
  loading.remove();
  $tooltip.appendChild(buildTooltipBody(m, detail));
  positionTooltip(row);
}

function hideTooltip() {
  hoverToken++;
  $tooltip.classList.add('hidden');
}

function positionTooltip(row) {
  const r = row.getBoundingClientRect();
  const tw = $tooltip.offsetWidth;
  const th = $tooltip.offsetHeight;
  let left = r.left + (r.width - tw) / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.bottom + 6;
  if (top + th > window.innerHeight - 34) top = r.top - th - 6;
  if (top < 4) top = 4;
  $tooltip.style.left = left + 'px';
  $tooltip.style.top = top + 'px';
}

function buildTooltipHeader(m) {
  const frag = document.createDocumentFragment();
  const league = document.createElement('div');
  league.className = 'tt-league';
  league.textContent = m.league;
  frag.appendChild(league);
  const time = document.createElement('div');
  time.className = 'tt-time';
  time.textContent = `${m.time}${m.channels ? ' · ' + m.channels : ''}`;
  frag.appendChild(time);
  return frag;
}

function buildTooltipBody(m, detail) {
  const frag = document.createDocumentFragment();
  const s = state.scores[m.id] || detail;

  if (m.leftName || m.rightName) {
    const scoreRow = document.createElement('div');
    scoreRow.className = 'tt-score-row';

    scoreRow.appendChild(ttTeam(m.leftName, m.leftLogo));

    const mid = document.createElement('div');
    mid.className = 'tt-mid';
    const big = document.createElement('div');
    big.className = 'tt-big-score';
    const sc = detail && detail.home_score !== undefined ? detailScore(m, detail) : displayScore(m);
    if (sc) {
      big.textContent = `${sc.left} - ${sc.right}`;
      if (sc.live) big.classList.add('live');
    } else {
      big.textContent = 'VS';
    }
    mid.appendChild(big);

    const period = document.createElement('div');
    const st = detail?.period_cn || statusOf(m).text;
    period.className = 'tt-period' + ((detail?.state || state.scores[m.id]?.state) === '3' ? ' done' : '');
    period.textContent = st || '未开赛';
    mid.appendChild(period);

    scoreRow.appendChild(mid);
    scoreRow.appendChild(ttTeam(m.rightName, m.rightLogo));
    frag.appendChild(scoreRow);

    if (detail?.half_score) {
      const half = document.createElement('div');
      half.className = 'tt-half';
      half.textContent = detail.half_score;
      frag.appendChild(half);
    }

    const events = buildEvents(m, detail);
    if (events) frag.appendChild(events);
  }

  if (!detail || (!m.leftName && !m.rightName)) {
    const info = document.createElement('div');
    info.className = 'tt-info';
    if (!detail && !state.scores[m.id]) {
      info.textContent = '比赛尚未开始或暂无详细数据';
    }
    if (m.label) {
      const tags = document.createElement('div');
      tags.className = 'label-tags';
      m.label.split(',').filter(Boolean).slice(0, 8).forEach((t) => {
        const tag = document.createElement('span');
        tag.textContent = t;
        tags.appendChild(tag);
      });
      info.appendChild(tags);
    }
    frag.appendChild(info);
  }
  return frag;
}

function detailScore(m, d) {
  const rightIsHome = d.rightishome === '1';
  return {
    left: rightIsHome ? d.visit_score : d.home_score,
    right: rightIsHome ? d.home_score : d.visit_score,
    live: d.state === '2',
  };
}

function ttTeam(name, logo) {
  const el = document.createElement('div');
  el.className = 'tt-team';
  if (logo) {
    const img = document.createElement('img');
    img.src = logo;
    el.appendChild(img);
  }
  const n = document.createElement('div');
  n.className = 'name';
  n.textContent = name || '-';
  el.appendChild(n);
  return el;
}

// player_data: {left:[{value:"10'", player_name:"恩博洛", code:"1"}], right:[...]}
// left/right 以主队为 home：rightishome=1 时 home 显示在右侧
function buildEvents(m, detail) {
  const pd = detail?.player_data;
  if (!pd || (!pd.left?.length && !pd.right?.length)) return null;

  const rightIsHome = detail.rightishome === '1';
  // player_data 的 left/right 对应 home/visit 的展示侧，与页面一致时直接使用
  const leftEvents = pd.left || [];
  const rightEvents = pd.right || [];

  const wrap = document.createElement('div');
  wrap.className = 'tt-events';
  const title = document.createElement('div');
  title.className = 'tt-events-title';
  title.textContent = '进球 / 事件';
  wrap.appendChild(title);

  const addEvent = (e, side) => {
    const el = document.createElement('div');
    el.className = 'tt-event ' + side;
    const minute = document.createElement('span');
    minute.className = 'minute';
    minute.textContent = e.value || '';
    const name = document.createElement('span');
    name.textContent = `${EVENT_ICONS[e.code] || '⚽'} ${e.player_name || ''}`;
    el.appendChild(minute);
    el.appendChild(name);
    return el;
  };

  // 合并按时间排序展示，主/客分列左右
  const all = [
    ...leftEvents.map((e) => ({ e, side: rightIsHome ? 'right-side' : 'left-side' })),
    ...rightEvents.map((e) => ({ e, side: rightIsHome ? 'left-side' : 'right-side' })),
  ];
  all.sort((a, b) => parseInt(a.e.value) - parseInt(b.e.value));
  all.forEach(({ e, side }) => wrap.appendChild(addEvent(e, side)));
  return wrap;
}

/* ---------------- 初始化 ---------------- */

async function refreshAll(manual = false) {
  if (manual) $refreshBtn.classList.add('spinning');
  try {
    await Promise.all([fetchSchedule(), fetchScores()]);
    renderList();
  } catch (e) {
    $list.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = '加载失败：' + e.message + '，请检查网络后点击刷新重试';
    $list.appendChild(err);
  } finally {
    $refreshBtn.classList.remove('spinning');
  }
}

$refreshBtn.addEventListener('click', () => refreshAll(true));

(async function init() {
  const stored = await chrome.storage.local.get('pinnedTab');
  if (stored.pinnedTab && TABS.some((t) => t.key === stored.pinnedTab)) {
    state.pinnedTab = stored.pinnedTab;
    state.activeTab = stored.pinnedTab;
  }
  renderTabs();
  await refreshAll();

  // 每 10 秒刷新实时比分（popup 打开期间）
  setInterval(async () => {
    await fetchScores();
    renderList();
  }, 10000);
})();
