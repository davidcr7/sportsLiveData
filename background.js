importScripts("md5.js");

const HOME_URL = "https://www.zhibo8.com/";
const LIVE_SCORES_URL = "https://bifen4pc.qiumibao.com/json/v2/list.htm";
const FINISHED_RECORDS_URL = "https://s.qiumibao.com/json/record";
const ALL_SCHEDULE_URL =
  "https://api.qiumibao.com/application/saishi/index.php";
const HOMEPAGE_CACHE_KEY = "zhibo8FootballHomepageCacheV1";
const SCORES_CACHE_KEY = "zhibo8FootballScoresCacheV1";
const RECORDS_CACHE_KEY = "zhibo8FinishedRecordsCacheV1";
const ALL_SCHEDULE_CACHE_KEY = "zhibo8AllScheduleCacheV1";

async function readCache(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

async function fetchHomepage() {
  try {
    const response = await fetch(HOME_URL, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(`直播吧返回了 ${response.status}`);
    }

    const html = await response.text();
    if (!html.includes("data-type=\"football\"")) {
      throw new Error("页面里没有找到足球赛事数据");
    }

    const payload = {
      html,
      fetchedAt: Date.now()
    };
    await chrome.storage.local.set({ [HOMEPAGE_CACHE_KEY]: payload });

    return {
      ok: true,
      ...payload,
      fromCache: false
    };
  } catch (error) {
    const cached = await readCache(HOMEPAGE_CACHE_KEY);
    if (cached?.html) {
      return {
        ok: true,
        ...cached,
        fromCache: true,
        warning: error instanceof Error ? error.message : String(error)
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchLiveScores() {
  try {
    const response = await fetch(`${LIVE_SCORES_URL}?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`实时比分接口返回了 ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data?.list)) {
      throw new Error("实时比分数据格式异常");
    }

    const payload = {
      scores: data.list,
      fetchedAt: Date.now()
    };
    await chrome.storage.local.set({ [SCORES_CACHE_KEY]: payload });

    return {
      ok: true,
      ...payload,
      fromCache: false
    };
  } catch (error) {
    const cached = await readCache(SCORES_CACHE_KEY);
    if (cached?.scores) {
      return {
        ok: true,
        ...cached,
        fromCache: true,
        warning: error instanceof Error ? error.message : String(error)
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function chinaDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchAllSchedule() {
  try {
    const today = chinaDateKey(new Date());
    const baseTime = new Date(`${today}T00:00:00+08:00`).getTime();
    const dates = Array.from({ length: 3 }, (_, index) =>
      chinaDateKey(new Date(baseTime + index * 24 * 60 * 60 * 1000))
    );
    const results = await Promise.allSettled(
      dates.map(async (date) => {
        const timestamp = Math.floor(Date.now() / 1000);
        const signedParams = `_platform=pc&date=${date}`;
        const signature = md5(
          `${signedParams}&sign=PCf768JFj@(asd)&fh1&time=${timestamp}`
        );
        const params = new URLSearchParams({
          _url: "/getMatchByDate",
          index_v2: "1",
          _platform: "pc",
          date,
          sign: signature,
          time: String(timestamp)
        });
        const response = await fetch(`${ALL_SCHEDULE_URL}?${params}`, {
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept: "application/json"
          }
        });
        if (!response.ok) {
          throw new Error(`全部赛程接口返回了 ${response.status}`);
        }
        const data = await response.json();
        if (data?.status !== "success" || !Array.isArray(data.data?.[date])) {
          throw new Error("全部赛程数据格式异常");
        }
        return {
          date,
          date_format: "",
          list: data.data[date]
        };
      })
    );
    const days = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (!days.length) {
      throw new Error("没有获取到全部赛程");
    }

    const payload = {
      days,
      fetchedAt: Date.now()
    };
    await chrome.storage.local.set({ [ALL_SCHEDULE_CACHE_KEY]: payload });
    return {
      ok: true,
      ...payload,
      fromCache: false
    };
  } catch (error) {
    const cached = await readCache(ALL_SCHEDULE_CACHE_KEY);
    if (cached?.days) {
      return {
        ok: true,
        ...cached,
        fromCache: true,
        warning: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchFinishedRecords() {
  try {
    const today = chinaDateKey(new Date());
    const baseTime = new Date(`${today}T00:00:00+08:00`).getTime();
    const dates = Array.from({ length: 7 }, (_, index) =>
      chinaDateKey(new Date(baseTime - index * 24 * 60 * 60 * 1000))
    );
    const results = await Promise.allSettled(
      dates.map(async (date) => {
        const response = await fetch(`${FINISHED_RECORDS_URL}/${date}.htm`, {
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept: "application/json"
          }
        });
        if (!response.ok) {
          throw new Error(`完赛接口返回了 ${response.status}`);
        }
        return response.json();
      })
    );
    const records = results
      .filter((result) => result.status === "fulfilled" && !result.value?.error)
      .map((result) => result.value);

    if (!records.length) {
      throw new Error("没有获取到完赛记录");
    }

    const payload = {
      records,
      fetchedAt: Date.now()
    };
    await chrome.storage.local.set({ [RECORDS_CACHE_KEY]: payload });

    return {
      ok: true,
      ...payload,
      fromCache: false
    };
  } catch (error) {
    const cached = await readCache(RECORDS_CACHE_KEY);
    if (cached?.records) {
      return {
        ok: true,
        ...cached,
        fromCache: true,
        warning: error instanceof Error ? error.message : String(error)
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "schedule:get") {
    fetchHomepage().then(sendResponse);
    return true;
  }

  if (message?.type === "scores:get") {
    fetchLiveScores().then(sendResponse);
    return true;
  }

  if (message?.type === "records:get") {
    fetchFinishedRecords().then(sendResponse);
    return true;
  }

  if (message?.type === "schedule:all") {
    fetchAllSchedule().then(sendResponse);
    return true;
  }

  return false;
});
