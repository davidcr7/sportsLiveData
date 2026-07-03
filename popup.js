const HOME_URL = "https://www.zhibo8.com/";
const NEWS_URL = "https://news.zhibo8.com/";
const MOBILE_LINK_TEXT = "手机看直播";
const PINNED_CATEGORY_KEY = "zhibo8PinnedCategoryV1";
const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "important", label: "已关注" },
  { id: "finished", label: "已完赛" },
  { id: "football", label: "足球" },
  { id: "basketball", label: "篮球" },
  { id: "game", label: "电竞" },
  { id: "other", label: "综合" }
];

const state = {
  matches: [],
  allMatches: [],
  importantMatches: [],
  finishedMatches: [],
  groups: new Map(),
  selectedCategory: "important",
  pinnedCategory: null,
  selectedDate: null,
  fetchedAt: null,
  scoreFetchedAt: null,
  fromCache: false,
  scoresFromCache: false,
  loading: false,
  filterGroups: [],
  activeFilter: null
};

const content = document.querySelector("#content");
const categoryTabs = document.querySelector("#categoryTabs");
const dateTabs = document.querySelector("#dateTabs");
const pinTabButton = document.querySelector("#pinTabButton");
const refreshButton = document.querySelector("#refreshButton");
const updateStatus = document.querySelector("#updateStatus");
const filterPanel = document.querySelector("#filterPanel");

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value) {
  try {
    return new URL(value, HOME_URL).href;
  } catch {
    return null;
  }
}

function parseMatch(item, fallback = {}) {
  const teamsElement = item.querySelector("._teams");
  const scoreElement = teamsElement?.querySelector("span");
  const score = cleanText(scoreElement?.textContent) || "—";
  const teamNames = teamsElement
    ? [...teamsElement.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => cleanText(node.textContent))
        .filter(Boolean)
    : [];
  const teamBadges = teamsElement
    ? [...teamsElement.querySelectorAll("img")]
        .map((image) => absoluteUrl(image.getAttribute("src")))
        .filter(Boolean)
    : [];
  const links = [...item.querySelectorAll("a")]
    .map((anchor) => ({
      label: cleanText(anchor.textContent),
      url: absoluteUrl(anchor.getAttribute("href"))
    }))
    .filter((link) => link.url && link.label && link.label !== MOBILE_LINK_TEXT)
    .filter(
      (link, index, all) =>
        all.findIndex(
          (candidate) => candidate.url === link.url && candidate.label === link.label
        ) === index
    );

  const rawDateTime = item.dataset.time || "";
  const [date = "", timeFromData = ""] = rawDateTime.split(" ");
  const header = item.closest(".vct-box")?.querySelector("._header ._title");
  const labels = cleanText(item.getAttribute("label"))
    .split(",")
    .map(cleanText)
    .filter(Boolean);
  const inferredType = labels.includes("足球")
    ? "football"
    : labels.includes("篮球")
      ? "basketball"
      : labels.includes("电竞") || labels.includes("游戏")
        ? "game"
        : "other";

  return {
    id: item.id || `${rawDateTime}-${cleanText(item.textContent)}`,
    matchId: (item.id || "").replace(/^saishi/, ""),
    date: date || header?.getAttribute("title") || fallback.date || "",
    dateLabel: cleanText(header?.textContent) || fallback.dateLabel || "",
    time: cleanText(item.querySelector("time")?.textContent) || timeFromData,
    league: cleanText(item.querySelector("._league")?.textContent),
    labels,
    dataType: item.dataset.type || inferredType,
    isImportant: [...item.children].some((child) => child.tagName === "B"),
    home: teamNames[0] || "",
    away: teamNames.length > 1 ? teamNames[teamNames.length - 1] : "",
    homeBadge: teamBadges[0] || null,
    awayBadge: teamBadges.length > 1 ? teamBadges[teamBadges.length - 1] : null,
    score,
    links
  };
}

function extractSchedulePayload(html) {
  const marker = /var\s+schedule\s*=\s*/g;
  const match = marker.exec(html);
  if (!match) {
    return null;
  }

  const start = html.indexOf("[", match.index + match[0].length);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseScheduleItem(rawItem, day) {
  const html =
    typeof rawItem === "string"
      ? rawItem
      : `<li label="${rawItem.label || ""}" id="saishi${rawItem.id || ""}" data-time="${rawItem.match_date || ""}">${rawItem.content || ""}</li>`;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const item = parsed.querySelector("li");
  return item
    ? parseMatch(item, {
        date: day.date,
        dateLabel: day.date_format
      })
    : null;
}

function uniqueMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = `${match.date}|${match.time}|${match.id}|${match.league}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseScheduleDays(days) {
  return uniqueMatches(
    (Array.isArray(days) ? days : []).flatMap((day) =>
      (day.list || []).map((item) => parseScheduleItem(item, day)).filter(Boolean)
    )
  )
    .filter((match) => match.date && match.time)
    .sort((left, right) =>
      `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`)
    );
}

const FILTER_GROUP_CATEGORY = {
  足球: "football",
  篮球: "basketball",
  其他: "other"
};

function parseFilterValue(raw) {
  return cleanText(raw)
    .split(",")
    .map(cleanText)
    .filter(Boolean);
}

function parseFilterGroups(documentFromSite) {
  return [...documentFromSite.querySelectorAll(".more-stype ._items")]
    .map((item) => {
      const label = cleanText(item.querySelector("._top span")?.textContent);
      const chips = [...item.querySelectorAll("._list span")]
        .map((span) => ({
          label: cleanText(span.textContent),
          keywords: parseFilterValue(span.getAttribute("value"))
        }))
        .filter((chip) => chip.label && chip.keywords.length);
      return {
        label,
        categoryId: FILTER_GROUP_CATEGORY[label] || "all",
        chips
      };
    })
    .filter((group) => group.label && group.chips.length);
}

function parseSchedule(html) {
  const documentFromSite = new DOMParser().parseFromString(html, "text/html");
  const visibleMatches = [
    ...documentFromSite.querySelectorAll(".schedule .vct-box li")
  ].map((item) => parseMatch(item));
  const payload = extractSchedulePayload(html);
  const normalizedAll = payload
    ? parseScheduleDays(payload)
    : uniqueMatches(visibleMatches);
  const importantMatches = normalizedAll.filter((match) => match.isImportant);

  return {
    all: normalizedAll,
    important: importantMatches.length
      ? importantMatches
      : uniqueMatches(visibleMatches),
    filterGroups: parseFilterGroups(documentFromSite)
  };
}

function absoluteRecordUrl(value) {
  if (!value) {
    return null;
  }
  try {
    if (/^https?:\/\//.test(value)) {
      return value;
    }
    const base = /native|\/(?:zuqiu|nba|game|other)\/\d{4}-/.test(value)
      ? NEWS_URL
      : HOME_URL;
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function recordLinks(item) {
  const candidates = [
    ["集锦", item.jijin_url],
    ["录像", item.luxiang_url],
    ["战报", item.news_url],
    ["文字", item.url]
  ];
  return candidates
    .map(([label, value]) => ({ label, url: absoluteRecordUrl(value) }))
    .filter((link) => link.url)
    .filter(
      (link, index, all) =>
        all.findIndex((candidate) => candidate.url === link.url) === index
    );
}

function parseFinishedRecords(records) {
  return uniqueMatches(
    (Array.isArray(records) ? records : []).flatMap((record) =>
      (record.list || []).map((item) => {
        const homeScore = cleanText(item.left_team?.score);
        const awayScore = cleanText(item.right_team?.score);
        const labels = cleanText(item.label)
          .split(",")
          .map(cleanText)
          .filter(Boolean);
        return {
          id: `record-${record.date}-${item.saishi_id}`,
          matchId: String(item.saishi_id || ""),
          date: record.date || item.sdate || "",
          dateLabel: cleanText(record.date_str),
          time: cleanText(item.stime),
          league:
            cleanText(item.title) && item.title !== "-"
              ? cleanText(item.title)
              : cleanText(item.league?.name_cn),
          labels,
          dataType: item.type || "other",
          isImportant: false,
          home: cleanText(item.left_team?.name || item.home_team),
          away: cleanText(item.right_team?.name || item.visit_team),
          homeBadge: absoluteUrl(item.left_team?.logo_url),
          awayBadge: absoluteUrl(item.right_team?.logo_url),
          score:
            homeScore !== "" && awayScore !== ""
              ? `${homeScore} - ${awayScore}`
              : "—",
          liveState: "3",
          liveStatus: "完赛",
          hasLiveData: false,
          homeEvents: [],
          awayEvents: [],
          links: recordLinks(item)
        };
      })
    )
  ).sort((left, right) =>
    `${right.date} ${right.time}`.localeCompare(`${left.date} ${left.time}`)
  );
}

function groupMatches(matches) {
  const groups = new Map();
  for (const match of matches) {
    if (!groups.has(match.date)) {
      groups.set(match.date, {
        date: match.date,
        label: match.dateLabel,
        matches: []
      });
    }
    groups.get(match.date).matches.push(match);
  }
  return groups;
}

function normalizeMatchEvents(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    time: cleanText(item.value),
    player: cleanText(item.player_name),
    code: String(item.code || "")
  }));
}

function applyLiveScores(matches, scores) {
  const liveById = new Map(
    (Array.isArray(scores) ? scores : []).map((score) => [String(score.id), score])
  );

  return matches.map((match) => {
    const live = liveById.get(match.matchId);
    if (!live) {
      return match;
    }

    const homeScore = cleanText(live.left?.score);
    const awayScore = cleanText(live.right?.score);
    return {
      ...match,
      score:
        homeScore !== "" && awayScore !== ""
          ? `${homeScore} - ${awayScore}`
          : match.score,
      liveState: String(live.state || ""),
      liveStatus: cleanText(live.period_cn || live.period_state),
      hasLiveData: true,
      homeEvents: normalizeMatchEvents(live.left?.player_data),
      awayEvents: normalizeMatchEvents(live.right?.player_data)
    };
  });
}

function liveStatusClass(match) {
  if (match.liveState === "2") {
    return "is-live";
  }
  if (match.liveState === "3") {
    return "is-finished";
  }
  if (match.liveState === "4") {
    return "is-delayed";
  }
  return "is-upcoming";
}

function matchesForCategory(category) {
  if (category === "finished") {
    return state.finishedMatches;
  }
  if (category === "important") {
    const important = state.allMatches.filter((match) => match.isImportant);
    return important.length ? important : state.importantMatches;
  }
  if (category === "football") {
    return state.allMatches.filter(
      (match) => match.dataType === "football" || match.labels.includes("足球")
    );
  }
  if (category === "basketball") {
    return state.allMatches.filter(
      (match) => match.dataType === "basketball" || match.labels.includes("篮球")
    );
  }
  if (category === "game") {
    return state.allMatches.filter(
      (match) =>
        match.dataType === "game" ||
        match.labels.includes("电竞") ||
        match.labels.includes("游戏")
    );
  }
  if (category === "other") {
    return state.allMatches.filter(
      (match) =>
        match.labels.includes("综合") ||
        !["football", "basketball", "game"].includes(match.dataType)
    );
  }
  return state.allMatches;
}

function matchesKeywords(match, keywords) {
  const labelTokens = new Set(match.labels);
  const freeText = `${match.league} ${match.home} ${match.away}`;
  return keywords.some(
    (keyword) => labelTokens.has(keyword) || freeText.includes(keyword)
  );
}

function applyActiveFilter(matches) {
  if (!state.activeFilter) {
    return matches;
  }
  return matches.filter((match) =>
    matchesKeywords(match, state.activeFilter.keywords)
  );
}

function updateVisibleMatches() {
  state.matches = applyActiveFilter(matchesForCategory(state.selectedCategory));
  state.groups = groupMatches(state.matches);
  if (!state.groups.has(state.selectedDate)) {
    state.selectedDate = chooseDefaultDate();
  }
}

async function readPinnedCategory() {
  if (isPreviewMode()) {
    return localStorage.getItem(PINNED_CATEGORY_KEY);
  }
  const result = await chrome.storage.local.get(PINNED_CATEGORY_KEY);
  return result[PINNED_CATEGORY_KEY] || null;
}

async function writePinnedCategory(category) {
  if (isPreviewMode()) {
    if (category) {
      localStorage.setItem(PINNED_CATEGORY_KEY, category);
    } else {
      localStorage.removeItem(PINNED_CATEGORY_KEY);
    }
    return;
  }
  if (category) {
    await chrome.storage.local.set({ [PINNED_CATEGORY_KEY]: category });
  } else {
    await chrome.storage.local.remove(PINNED_CATEGORY_KEY);
  }
}

function chinaDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyFor(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateTabLabel(group) {
  const current = chinaDateKey();
  const tomorrowDate = new Date(
    new Date(`${current}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000
  );
  const tomorrow = dateKeyFor(tomorrowDate);

  const [, month, day] = group.date.split("-");
  const weekdayMatch = group.label.match(/星期./);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short"
  }).format(new Date(`${group.date}T00:00:00+08:00`));

  if (group.date === current) {
    return { day: "今天", date: `${month}/${day}` };
  }
  if (group.date === tomorrow) {
    return { day: "明天", date: `${month}/${day}` };
  }
  return {
    day: weekdayMatch?.[0] || weekday,
    date: `${month}/${day}`
  };
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function createPlayIcon(className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (className) {
    svg.setAttribute("class", className);
  }
  const path = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  path.setAttribute("d", "M8 5v14l11-7z");
  svg.append(path);
  return svg;
}

function createFilterIcon(className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (className) {
    svg.setAttribute("class", className);
  }
  for (const d of ["M4 6h16", "M7 12h10", "M10 18h4"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function createTeam(name, badge, side) {
  const team = createElement("div", `team team--${side}`);
  if (badge) {
    const image = createElement("img", "team__badge");
    image.src = badge;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    team.append(image);
  }
  team.append(createElement("span", "team__name", name || "待定"));
  return team;
}

function eventDisplay(code) {
  const displays = {
    "1": { label: "进球", symbol: "⚽", className: "is-goal" },
    "2": { label: "乌龙球", symbol: "↩", className: "is-own-goal" },
    "4": { label: "两黄变红", symbol: "", className: "is-second-yellow" },
    "5": { label: "红牌", symbol: "", className: "is-red-card" },
    "6": { label: "点球", symbol: "⚽", className: "is-penalty" },
    "36": { label: "失点", symbol: "×", className: "is-missed-penalty" }
  };
  return displays[String(code)] || {
    label: "事件",
    symbol: "•",
    className: "is-other"
  };
}

function createEventColumn(teamName, events, side) {
  const column = createElement("div", `event-column event-column--${side}`);
  column.append(createElement("div", "event-column__team", teamName || "待定"));

  const list = createElement("div", "event-list");
  if (!events.length) {
    list.append(createElement("div", "event-empty", "暂无事件"));
  } else {
    for (const event of events) {
      const display = eventDisplay(event.code);
      const row = createElement("div", "event-row");
      const icon = createElement(
        "span",
        `event-row__icon ${display.className}`,
        display.symbol
      );
      icon.title = display.label;
      row.append(
        createElement("span", "event-row__time", event.time || "—"),
        icon,
        createElement(
          "span",
          "event-row__player",
          event.player || "未知球员"
        ),
        createElement("span", "event-row__type", display.label)
      );
      list.append(row);
    }
  }
  column.append(list);
  return column;
}

function createScoreDetails(match) {
  const popover = createElement("div", "score-popover");
  popover.setAttribute("role", "tooltip");

  const header = createElement("div", "score-popover__header");
  header.append(
    createElement("span", "", "比赛事件"),
    createElement(
      "span",
      `score-popover__status ${liveStatusClass(match)}`,
      match.liveStatus || "实时比分"
    )
  );

  const columns = createElement("div", "event-columns");
  columns.append(
    createEventColumn(match.home, match.homeEvents || [], "home"),
    createEventColumn(match.away, match.awayEvents || [], "away")
  );
  popover.append(header, columns);
  return popover;
}

function scoreParts(scoreText) {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec((scoreText || "").trim());
  return match ? { home: match[1], away: match[2] } : null;
}

function fillScore(node, scoreText) {
  const parts = scoreParts(scoreText);
  if (parts) {
    node.append(
      createElement("span", "score__num", parts.home),
      createElement("span", "score__dash", "–"),
      createElement("span", "score__num", parts.away)
    );
  } else {
    node.classList.add("is-upcoming");
    node.append(createElement("span", "score__placeholder", "VS"));
  }
}

function createScore(match) {
  if (
    match.dataType !== "football" ||
    !match.hasLiveData ||
    !/\d+\s*-\s*\d+/.test(match.score)
  ) {
    const score = createElement("span", "score");
    fillScore(score, match.score);
    return score;
  }

  const wrapper = createElement("div", "score-wrap");
  wrapper.classList.add(liveStatusClass(match));
  const button = createElement("button", "score score--interactive");
  button.type = "button";
  fillScore(button, match.score);
  button.title = "查看进球、红牌等比赛事件";
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = !wrapper.classList.contains("is-open");
    document
      .querySelectorAll(".score-wrap.is-open")
      .forEach((element) => {
        element.classList.remove("is-open");
        element
          .querySelector(".score")
          ?.setAttribute("aria-expanded", "false");
      });
    document.querySelectorAll(".match-more.is-open").forEach((element) => {
      element.classList.remove("is-open");
      element
        .querySelector(".match-more__button")
        ?.setAttribute("aria-expanded", "false");
    });
    wrapper.classList.toggle("is-open", shouldOpen);
    button.setAttribute("aria-expanded", String(shouldOpen));
  });
  wrapper.append(button, createScoreDetails(match));
  return wrapper;
}

function displayLinkLabel(match, label, isLiveLink) {
  if (isLiveLink) {
    return "看直播";
  }
  if (label === "集锦") {
    return "赛后集锦";
  }
  if (label === "录像") {
    return "全场回放";
  }
  if (label === "战报" || (label === "文字" && match.liveState === "3")) {
    return "文字战报";
  }
  if (label === "文字") {
    return "文字直播";
  }
  return label;
}

function createMatchCard(match) {
  const card = createElement("article", "match-card");
  card.classList.add(liveStatusClass(match));

  const main = createElement("div", "match-main");
  const meta = createElement("div", "match-meta");
  const metaInfo = createElement("div", "match-meta__info");
  metaInfo.append(
    createElement("time", "match-time", match.time),
    createElement("span", "league", match.league || "足球赛事")
  );
  meta.append(metaInfo);
  if (match.liveStatus) {
    meta.append(
      createElement(
        "span",
        `match-status ${liveStatusClass(match)}`,
        match.liveStatus
      )
    );
  }
  main.append(meta);

  if (match.home || match.away) {
    const teams = createElement("div", "teams");
    teams.append(createTeam(match.home, match.homeBadge, "home"));
    teams.append(createScore(match), createTeam(match.away, match.awayBadge, "away"));
    main.append(teams);
  } else {
    main.append(createElement("div", "event-title", match.league || "足球赛事"));
  }

  if (match.links.length) {
    const links = createElement("div", "match-links");
    const visibleLinks = match.links.slice(0, 2);
    for (const [index, link] of visibleLinks.entries()) {
      const isLiveLink =
        match.liveState === "2" &&
        (index === 0 || /直播|视频|观看/.test(link.label));
      const anchor = createElement(
        "a",
        "match-link",
        displayLinkLabel(match, link.label, isLiveLink)
      );
      anchor.classList.toggle("match-link--primary", isLiveLink);
      if (isLiveLink) {
        anchor.prepend(createPlayIcon("match-link__play"));
      }
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.title = link.label;
      links.append(anchor);
    }

    if (match.links.length > 2) {
      const more = createElement("div", "match-more");
      const moreButton = createElement("button", "match-more__button", "···");
      moreButton.type = "button";
      moreButton.title = "更多直播入口";
      moreButton.setAttribute("aria-label", "更多直播入口");
      moreButton.setAttribute("aria-expanded", "false");
      const menu = createElement("div", "match-more__menu");
      for (const link of match.links.slice(2)) {
        const anchor = createElement("a", "match-more__link", link.label);
        anchor.href = link.url;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.title = link.label;
        menu.append(anchor);
      }
      moreButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const shouldOpen = !more.classList.contains("is-open");
        document
          .querySelectorAll(".match-more.is-open")
          .forEach((element) => {
            element.classList.remove("is-open");
            element
              .querySelector(".match-more__button")
              ?.setAttribute("aria-expanded", "false");
          });
        document.querySelectorAll(".score-wrap.is-open").forEach((element) => {
          element.classList.remove("is-open");
          element
            .querySelector(".score")
            ?.setAttribute("aria-expanded", "false");
        });
        more.classList.toggle("is-open", shouldOpen);
        moreButton.setAttribute("aria-expanded", String(shouldOpen));
      });
      more.append(moreButton, menu);
      links.append(more);
    }
    main.append(links);
  }

  card.append(main);
  return card;
}

function renderCategoryTabs() {
  categoryTabs.replaceChildren();
  for (const category of CATEGORIES) {
    const button = createElement("button", "category-tab");
    button.type = "button";
    button.dataset.category = category.id;
    button.classList.toggle(
      "is-active",
      category.id === state.selectedCategory
    );
    button.setAttribute(
      "aria-pressed",
      String(category.id === state.selectedCategory)
    );
    button.append(createElement("span", "", category.label));
    if (category.id === state.pinnedCategory) {
      button.append(createElement("span", "category-tab__pin"));
      button.title = `${category.label}已固定为默认`;
    }
    button.addEventListener("click", () => selectCategory(category.id));
    categoryTabs.append(button);
  }

  const filterButton = createElement("button", "category-tab category-tab--filter");
  filterButton.type = "button";
  filterButton.setAttribute("aria-haspopup", "true");
  filterButton.setAttribute("aria-expanded", String(!filterPanel.hidden));
  filterButton.classList.toggle("is-active", Boolean(state.activeFilter));
  filterButton.append(
    createFilterIcon(),
    createElement("span", "", state.activeFilter?.label || "筛选")
  );
  filterButton.title = state.activeFilter
    ? `按「${state.activeFilter.label}」筛选中`
    : "按联赛或球队筛选";
  filterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFilterPanel();
  });
  categoryTabs.append(filterButton);
}

function closeFilterPanel() {
  filterPanel.hidden = true;
}

function openFilterPanel() {
  if (!state.filterGroups.length) {
    return;
  }
  filterPanel.hidden = false;
}

function toggleFilterPanel() {
  if (filterPanel.hidden) {
    openFilterPanel();
  } else {
    closeFilterPanel();
  }
}

function selectFilterChip(group, chip) {
  state.selectedCategory = group.categoryId;
  state.activeFilter = { label: chip.label, keywords: chip.keywords };
  updateVisibleMatches();
  renderCategoryTabs();
  renderPinButton();
  renderFilterPanel();
  renderDateTabs();
  renderMatches();
  closeFilterPanel();
}

function clearActiveFilter() {
  state.activeFilter = null;
  updateVisibleMatches();
  renderCategoryTabs();
  renderFilterPanel();
  renderDateTabs();
  renderMatches();
  closeFilterPanel();
}

function renderFilterPanel() {
  const wasHidden = filterPanel.hidden;
  filterPanel.replaceChildren();
  filterPanel.hidden = wasHidden;

  if (!state.filterGroups.length) {
    return;
  }

  const header = createElement("div", "filter-panel__header");
  const resetChip = createElement(
    "button",
    "filter-chip filter-chip--reset",
    "全部赛事"
  );
  resetChip.type = "button";
  resetChip.addEventListener("click", (event) => {
    event.stopPropagation();
    clearActiveFilter();
  });
  header.append(resetChip);
  filterPanel.append(header);

  const body = createElement("div", "filter-panel__body");
  for (const group of state.filterGroups) {
    const section = createElement("div", "filter-panel__group");
    section.append(
      createElement("div", "filter-panel__group-title", group.label)
    );
    const chipsWrap = createElement("div", "filter-panel__chips");
    for (const chip of group.chips) {
      const button = createElement("button", "filter-chip", chip.label);
      button.type = "button";
      button.classList.toggle(
        "is-active",
        state.activeFilter?.label === chip.label
      );
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectFilterChip(group, chip);
      });
      chipsWrap.append(button);
    }
    section.append(chipsWrap);
    body.append(section);
  }
  filterPanel.append(body);
}

function renderPinButton() {
  const category = CATEGORIES.find(
    (item) => item.id === state.selectedCategory
  );
  const isPinned = state.pinnedCategory === state.selectedCategory;
  pinTabButton.classList.toggle("is-pinned", isPinned);
  pinTabButton.setAttribute("aria-pressed", String(isPinned));
  pinTabButton.setAttribute(
    "aria-label",
    isPinned
      ? `取消固定${category?.label || "当前"}分类`
      : `固定${category?.label || "当前"}分类`
  );
  pinTabButton.title = isPinned
    ? `已固定「${category?.label}」，点击取消`
    : `固定「${category?.label}」为默认`;
}

function selectCategory(category) {
  if (!CATEGORIES.some((item) => item.id === category)) {
    return;
  }
  state.selectedCategory = category;
  state.activeFilter = null;
  updateVisibleMatches();
  renderCategoryTabs();
  renderPinButton();
  renderFilterPanel();
  renderDateTabs();
  renderMatches();
  closeFilterPanel();
}

async function togglePinnedCategory() {
  state.pinnedCategory =
    state.pinnedCategory === state.selectedCategory
      ? null
      : state.selectedCategory;
  await writePinnedCategory(state.pinnedCategory);
  renderCategoryTabs();
  renderPinButton();
}

function renderDateTabs() {
  dateTabs.replaceChildren();
  dateTabs.hidden = state.groups.size < 2;

  for (const group of state.groups.values()) {
    const label = dateTabLabel(group);
    const button = createElement("button", "date-tab");
    button.type = "button";
    button.dataset.date = group.date;
    button.classList.toggle("is-active", group.date === state.selectedDate);
    button.setAttribute("aria-pressed", String(group.date === state.selectedDate));
    button.append(
      createElement("span", "date-tab__day", label.day),
      createElement("span", "date-tab__date", label.date)
    );
    button.addEventListener("click", () => {
      state.selectedDate = group.date;
      renderDateTabs();
      renderMatches();
    });
    dateTabs.append(button);
  }
}

function renderMatches({ preserveScroll = false } = {}) {
  const previousScrollTop = content.scrollTop;
  const group = state.groups.get(state.selectedDate);
  content.replaceChildren();

  if (!group?.matches.length) {
    const category = CATEGORIES.find(
      (item) => item.id === state.selectedCategory
    );
    const empty = createElement("div", "empty-state");
    empty.append(
      createElement("div", "empty-state__icon", "⚽"),
      createElement(
        "p",
        "",
        `这一天暂时没有${category?.label || "可显示的"}赛事`
      )
    );
    content.append(empty);
    return;
  }

  const list = createElement("div", "match-list");
  for (const match of group.matches) {
    list.append(createMatchCard(match));
  }
  content.append(list);
  content.scrollTop = preserveScroll ? previousScrollTop : 0;
}

function renderStatus() {
  const latestUpdate = state.scoreFetchedAt || state.fetchedAt;
  if (!latestUpdate) {
    updateStatus.textContent = "未获取到更新时间";
    return;
  }

  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(latestUpdate));
  updateStatus.replaceChildren(
    document.createTextNode(`${time} 更新 · 30秒自动刷新`),
    ...(state.fromCache || state.scoresFromCache
      ? [createElement("span", "cache-badge", "缓存")]
      : [])
  );
}

function renderError(message) {
  dateTabs.hidden = true;
  content.replaceChildren();
  const error = createElement("div", "error-state");
  const retry = createElement("button", "retry-button", "重新加载");
  retry.type = "button";
  retry.addEventListener("click", loadSchedule);
  error.append(
    createElement("div", "error-state__icon", "!"),
    createElement("p", "", `赛事获取失败：${message}`),
    retry
  );
  content.append(error);
  updateStatus.textContent = "连接失败";
}

function chooseDefaultDate() {
  const dates = [...state.groups.keys()];
  const current = chinaDateKey();
  if (state.groups.has(current)) {
    return current;
  }
  return dates.find((date) => date > current) || dates[0] || null;
}

function isPreviewMode() {
  return (
    ["localhost", "127.0.0.1"].includes(location.hostname) &&
    location.search.includes("preview=1")
  );
}

async function requestHomepage() {
  if (isPreviewMode()) {
    return {
      ok: true,
      html: `
        <div class="schedule">
          <div class="vct-box">
            <div class="_header"><span class="_title" title="2026-07-01">7月01日 星期三</span></div>
            <ul>
              <li id="saishi1867461" data-time="2026-07-01 10:00" data-type="football">
                <time>10:00</time><b><span class="_league">世界杯1/16决赛</span>
                <span class="_teams">墨西哥 <img src="https://duihui.duoduocdn.com/zuqiu/zq_moxige_313403.png"><span>2 - 0</span><img src="https://duihui.duoduocdn.com/zuqiu/zq_eguaduoer_848955.png"> 厄瓜多尔</span></b>
                <a href="/zhibo/zuqiu/2026/match1867461v.htm">小红书 咪咕 CCTV5</a>
                <a href="/zhibo/zuqiu/2026/match1867461v.htm">文字</a>
                <a href="https://www.188bifen.com/">比分</a>
                <a href="/zhibo/zuqiu/2026/match1867461v.htm?redirect=animate">动画</a>
              </li>
              <li id="saishi0" data-time="2026-07-01 16:00" data-type="football">
                <time>16:00</time><b><span class="_league">中冠附加赛</span></b>
                <a href="https://news.zhibo8.com/">展开</a>
              </li>
              <li id="saishi2072054" data-time="2026-07-01 20:00" data-type="football">
                <time>20:00</time><b><span class="_league">豪门盛宴</span></b>
                <a href="/zhibo/zuqiu/2026/match2072054v.htm">CCTV5</a>
                <a href="/zhibo/zuqiu/2026/match2072054v.htm">文字</a>
                <a href="https://www.188bifen.com/">比分</a>
              </li>
              <li label="篮球,NBA" id="saishi2063429" data-time="2026-07-01 21:00" data-type="basketball">
                <time>21:00</time><span class="_league">NBA夏季联赛</span>
                <span class="_teams">湖人 <span>-</span> 热火</span>
                <a href="/zhibo/nba/2026/match2063429v.htm">互动直播</a>
              </li>
              <li label="电竞,游戏" id="saishi2063449" data-time="2026-07-01 22:00" data-type="game">
                <time>22:00</time><span class="_league">MSI季中冠军赛</span>
                <span class="_teams">T1 <span>-</span> TL</span>
                <a href="/zhibo/game/2026/match2063449v.htm">互动直播</a>
              </li>
              <li label="综合,网球" id="saishi2075155" data-time="2026-07-01 23:00" data-type="tennis">
                <time>23:00</time><span class="_league">温网女单</span>
                <span class="_teams">穆霍娃 <span>-</span> 张帅</span>
                <a href="/zhibo/other/2026/match2075155v.htm">互动直播</a>
              </li>
            </ul>
          </div>
          <div class="vct-box">
            <div class="_header"><span class="_title" title="2026-07-02">7月02日 星期四</span></div>
            <ul>
              <li id="saishi1867462" data-time="2026-07-02 00:00" data-type="football">
                <time>00:00</time><b><span class="_league">世界杯1/16决赛</span>
                <span class="_teams">英格兰 <span>-</span> 民主刚果</span></b>
                <a href="/zhibo/zuqiu/2026/match1867462v.htm">小红书 咪咕 CCTV5</a>
                <a href="/zhibo/zuqiu/2026/match1867462v.htm">文字</a>
              </li>
            </ul>
          </div>
        </div>`,
      fetchedAt: Date.now(),
      fromCache: false
    };
  }
  return chrome.runtime.sendMessage({ type: "schedule:get" });
}

async function requestLiveScores() {
  if (isPreviewMode()) {
    return {
      ok: true,
      scores: [
        {
          id: "1867461",
          state: "2",
          period_cn: "48′24″+5",
          left: {
            score: "2",
            player_data: [
              { value: "22'", player_name: "基尼奥内斯", code: "1" },
              { value: "31'", player_name: "劳尔·希门尼斯", code: "1" }
            ]
          },
          right: {
            score: "0",
            player_data: [
              { value: "90+5'", player_name: "因卡皮耶", code: "5" }
            ]
          }
        },
        {
          id: "1867462",
          state: "7",
          period_cn: "未开始",
          left: { score: "", player_data: [] },
          right: { score: "", player_data: [] }
        }
      ],
      fetchedAt: Date.now(),
      fromCache: false
    };
  }
  return chrome.runtime.sendMessage({ type: "scores:get" });
}

async function requestAllSchedule() {
  if (isPreviewMode()) {
    return {
      ok: false,
      error: "预览模式使用内置赛程"
    };
  }
  return chrome.runtime.sendMessage({ type: "schedule:all" });
}

async function requestFinishedRecords() {
  if (isPreviewMode()) {
    return {
      ok: true,
      records: [
        {
          date: "2026-07-01",
          date_str: "7月01日 星期三",
          list: [
            {
              saishi_id: "1867459",
              sdate: "2026-07-01",
              stime: "06:00",
              title: "世界杯1/16决赛",
              type: "football",
              label: "世界杯,法国,瑞典,足球",
              league: { name_cn: "世界杯1/16决赛" },
              left_team: {
                name: "法国",
                score: "3",
                logo_url:
                  "https://duihui.duoduocdn.com/zuqiu/zq_faguo_522291.png"
              },
              right_team: {
                name: "瑞典",
                score: "0",
                logo_url:
                  "https://duihui.duoduocdn.com/zuqiu/zq_ruidian_628499.png"
              },
              news_url:
                "/zuqiu/2026-07-01/match1867459date2026vnative.htm",
              url: "/zuqiu/2026-07-01/match1867459date2026vnative.htm"
            }
          ]
        }
      ],
      fetchedAt: Date.now(),
      fromCache: false
    };
  }
  return chrome.runtime.sendMessage({ type: "records:get" });
}

async function loadSchedule() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  refreshButton.disabled = true;
  refreshButton.classList.add("is-loading");

  try {
    const [response, scoreResponse, recordsResponse, allScheduleResponse] =
      await Promise.all([
        requestHomepage(),
        requestLiveScores(),
        requestFinishedRecords(),
        requestAllSchedule()
      ]);
    if (!response?.ok) {
      throw new Error(response?.error || "未知错误");
    }

    const schedule = parseSchedule(response.html);
    if (!schedule.all.length) {
      throw new Error("页面里暂时没有可显示的赛事");
    }
    if (schedule.filterGroups.length) {
      state.filterGroups = schedule.filterGroups;
    }
    const fullyLoadedDates = new Set(
      (allScheduleResponse?.days || []).map((day) => day.date)
    );
    const fullSchedule = allScheduleResponse?.ok
      ? uniqueMatches([
          ...parseScheduleDays(allScheduleResponse.days),
          ...schedule.all.filter(
            (match) => !fullyLoadedDates.has(match.date)
          )
        ]).sort((left, right) =>
          `${left.date} ${left.time}`.localeCompare(
            `${right.date} ${right.time}`
          )
        )
      : schedule.all;
    const importantSchedule = fullSchedule.filter(
      (match) => match.isImportant
    );

    state.allMatches = scoreResponse?.ok
      ? applyLiveScores(fullSchedule, scoreResponse.scores)
      : fullSchedule;
    state.importantMatches = scoreResponse?.ok
      ? applyLiveScores(
          importantSchedule.length ? importantSchedule : schedule.important,
          scoreResponse.scores
        )
      : importantSchedule.length
        ? importantSchedule
        : schedule.important;
    const finished = recordsResponse?.ok
      ? parseFinishedRecords(recordsResponse.records)
      : [];
    state.finishedMatches = scoreResponse?.ok
      ? applyLiveScores(finished, scoreResponse.scores)
      : finished;
    updateVisibleMatches();
    state.fetchedAt = Math.max(
      response.fetchedAt || 0,
      recordsResponse?.fetchedAt || 0,
      allScheduleResponse?.fetchedAt || 0
    );
    state.scoreFetchedAt = scoreResponse?.fetchedAt || null;
    state.fromCache = Boolean(
      response.fromCache ||
        recordsResponse?.fromCache ||
        allScheduleResponse?.fromCache
    );
    state.scoresFromCache = Boolean(scoreResponse?.fromCache);

    renderCategoryTabs();
    renderPinButton();
    renderFilterPanel();
    renderDateTabs();
    renderMatches();
    renderStatus();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  } finally {
    state.loading = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
  }
}

async function refreshLiveScores() {
  if (state.loading || !state.matches.length) {
    return;
  }

  try {
    const response = await requestLiveScores();
    if (!response?.ok) {
      return;
    }

    state.allMatches = applyLiveScores(state.allMatches, response.scores);
    state.importantMatches = applyLiveScores(
      state.importantMatches,
      response.scores
    );
    state.finishedMatches = applyLiveScores(
      state.finishedMatches,
      response.scores
    );
    updateVisibleMatches();
    state.scoreFetchedAt = response.fetchedAt;
    state.scoresFromCache = Boolean(response.fromCache);
    renderDateTabs();
    renderMatches({ preserveScroll: true });
    renderStatus();
  } catch {
    // 自动刷新失败时保留上一次比分，等待下一轮重试。
  }
}

refreshButton.addEventListener("click", loadSchedule);
pinTabButton.addEventListener("click", togglePinnedCategory);
document.addEventListener("click", () => {
  document.querySelectorAll(".score-wrap.is-open").forEach((element) => {
    element.classList.remove("is-open");
    element.querySelector(".score")?.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".match-more.is-open").forEach((element) => {
    element.classList.remove("is-open");
    element
      .querySelector(".match-more__button")
      ?.setAttribute("aria-expanded", "false");
  });
  closeFilterPanel();
});

async function initialize() {
  const pinnedCategory = await readPinnedCategory();
  if (CATEGORIES.some((category) => category.id === pinnedCategory)) {
    state.pinnedCategory = pinnedCategory;
    state.selectedCategory = pinnedCategory;
  }
  renderCategoryTabs();
  renderPinButton();
  await loadSchedule();
}

initialize();
setInterval(refreshLiveScores, 30_000);
