/**
 * CinePersona Background Service Worker
 * Handles CORS network requests, authentication session check, search resolution, and activity logging.
 */

const DEFAULT_API_BASE = "https://cinepersona.com";

// In-memory cache for mapping (cleanTitle+year -> movie)
const searchCache = new Map();

// Tab-level active movie map for cross-frame coordination (tabId -> { movie, activity, timestamp })
const tabMovieMap = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMovieMap.delete(tabId);
});

// Ensure declarativeNetRequest rules for Douban Referer are active
if (chrome.declarativeNetRequest) {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1001, 1002, 1003],
    addRules: [
      {
        id: 1001,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Referer", operation: "set", value: "https://m.douban.com/" }
          ]
        },
        condition: {
          urlFilter: "||m.douban.com",
          resourceTypes: ["xmlhttprequest", "other", "sub_frame", "main_frame"]
        }
      },
      {
        id: 1002,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Referer", operation: "set", value: "https://www.douban.com/" }
          ]
        },
        condition: {
          urlFilter: "||doubanio.com",
          resourceTypes: ["image", "xmlhttprequest", "other"]
        }
      },
      {
        id: 1003,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Referer", operation: "set", value: "https://www.douban.com/" }
          ]
        },
        condition: {
          urlFilter: "||movie.douban.com",
          resourceTypes: ["xmlhttprequest", "other"]
        }
      }
    ]
  }).catch(() => {});
}

// Douban Sync State & Functions
let doubanSyncState = {
  status: "idle",
  mode: "incremental",
  message: "",
  itemCount: 0,
  lastSyncTime: null,
  csvData: null,
  error: null
};

async function checkDoubanSession() {
  try {
    // 1. Search cookies across .douban.com or douban.com
    const cookies = await chrome.cookies.getAll({ domain: "douban.com" });
    let dbcl2Cookie = cookies.find((c) => c.name === "dbcl2");
    if (!dbcl2Cookie) {
      const allCookies = await chrome.cookies.getAll({ name: "dbcl2" });
      dbcl2Cookie = allCookies.find((c) => (c.domain || "").includes("douban.com"));
    }

    if (!dbcl2Cookie || !dbcl2Cookie.value) {
      return { loggedIn: false };
    }

    const val = dbcl2Cookie.value.replace(/"/g, "");
    const parts = val.split(":");
    const uidFromCookie = parts[0];
    if (!uidFromCookie) return { loggedIn: false };

    let userName = "";
    let userAvatar = "";

    // 2. Query Rexxar API for the specific user ID with mobile headers & credentials
    try {
      const uRes = await fetch(`https://m.douban.com/rexxar/api/v2/user/${uidFromCookie}`, {
        headers: {
          "Referer": "https://m.douban.com/",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
        },
        credentials: "include"
      });
      if (uRes.ok) {
        const udata = await uRes.json();
        if (udata.name && udata.name !== uidFromCookie) {
          userName = udata.name;
        }
        if (udata.avatar || udata.loc?.avatar) {
          userAvatar = udata.avatar || udata.loc?.avatar;
        }
      }
    } catch (e) {}

    // 3. Fallback: Query Rexxar ~me if name still missing
    if (!userName) {
      try {
        const meRes = await fetch("https://m.douban.com/rexxar/api/v2/user/~me", {
          headers: {
            "Referer": "https://m.douban.com/mine/",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
          },
          credentials: "include"
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.name) userName = meData.name;
          if (meData.avatar) userAvatar = meData.avatar;
        }
      } catch (e) {}
    }

    // 4. Infallible fallback: Query desktop profile page to parse real nickname & avatar
    if (!userName) {
      try {
        const docRes = await fetch(`https://www.douban.com/people/${uidFromCookie}/`, {
          credentials: "include"
        });
        if (docRes.ok) {
          const html = await docRes.text();
          const titleMatch = html.match(/<title>\s*(?:([^\n<]+)的个人主页|([^\n<]+))\s*<\/title>/i);
          if (titleMatch && (titleMatch[1] || titleMatch[2])) {
            userName = (titleMatch[1] || titleMatch[2]).replace(/的个人主页.*/, "").trim();
          }
          const avatarMatch = html.match(/class="userface"\s+src="([^"]+)"/i) || html.match(/class="avatar"[^>]*src="([^"]+)"/i);
          if (avatarMatch && avatarMatch[1]) {
            userAvatar = avatarMatch[1];
          }
        }
      } catch (e) {}
    }

    // Convert Douban avatar to Data URL using Referer header to bypass Douban 418 Teapot anti-hotlinking
    if (userAvatar && userAvatar.startsWith("http")) {
      try {
        const imgRes = await fetch(userAvatar, {
          headers: { "Referer": "https://www.douban.com/" }
        });
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          const base64 = btoa(binary);
          const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
          userAvatar = `data:${mimeType};base64,${base64}`;
        }
      } catch (e) {}
    }

    // 5. Query local database stats
    const localDbKey = `douban_db_${uidFromCookie}`;
    const stored = await chrome.storage.local.get([localDbKey]);
    const localDb = stored[localDbKey] || { items: [], watchedCount: 0, wishCount: 0 };
    let watchedCount = localDb.watchedCount || 0;
    let wishCount = localDb.wishCount || 0;

    // If localDb is empty, query Douban Rexxar user interests count
    if (watchedCount === 0 && wishCount === 0) {
      try {
        const [doneRes, markRes] = await Promise.all([
          fetch(`https://m.douban.com/rexxar/api/v2/user/${uidFromCookie}/interests?type=movie&count=1&status=done`, { credentials: "include" }),
          fetch(`https://m.douban.com/rexxar/api/v2/user/${uidFromCookie}/interests?type=movie&count=1&status=mark`, { credentials: "include" })
        ]);
        if (doneRes.ok) {
          const d = await doneRes.json();
          if (typeof d.total === "number") watchedCount = d.total;
        }
        if (markRes.ok) {
          const m = await markRes.json();
          if (typeof m.total === "number") wishCount = m.total;
        }
      } catch (e) {}
    }

    return {
      loggedIn: true,
      uid: uidFromCookie,
      name: userName || `豆瓣ID: ${uidFromCookie}`,
      avatar: userAvatar,
      doubanId: uidFromCookie,
      watchedCount,
      wishCount,
      localDbCount: localDb.items?.length || 0
    };
  } catch (err) {
    return { loggedIn: false, error: err.message };
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (t) => '"' + String(t || "").replace(/"/g, '""').replace(/\n/g, " ") + '"';

async function getLocalDoubanDb(uid) {
  const key = `douban_db_${uid}`;
  const res = await chrome.storage.local.get([key]);
  return res[key] || { items: [], lastSyncTime: null, watchedCount: 0, wishCount: 0 };
}

async function saveLocalDoubanDb(uid, db) {
  const key = `douban_db_${uid}`;
  await chrome.storage.local.set({ [key]: db });
}

function generateCsvFromItems(items) {
  const cols = ["Category","Douban ID","Type","Title","Year","Directors","Actors","Genres","Region","Douban Rating","Douban Votes","Your Rating","Your Comment","Date Rated"];
  const csvRows = [cols.join(",")];
  items.forEach((o) => {
    csvRows.push([
      esc(o.cat), esc(o.id), esc(o.type), esc(o.title), esc(o.year),
      esc(o.dir), esc(o.act), esc(o.gen), esc(o.reg), esc(o.db_r),
      esc(o.db_v), esc(o.u_r), esc(o.u_c), esc(o.date)
    ].join(","));
  });
  return "\uFEFF" + csvRows.join("\n");
}

async function executeDoubanSmartSync(uid, apiBase = DEFAULT_API_BASE, allowCloudSync = false) {
  if (doubanSyncState.status === "syncing") return doubanSyncState;

  doubanSyncState = {
    status: "syncing",
    cloudSyncRequested: Boolean(allowCloudSync),
    cloudSyncStatus: allowCloudSync ? "pending" : "not_requested",
    message: "正在准备本地数据库与同步...",
    itemCount: 0,
    totalCount: 0,
    watchedCount: 0,
    wishCount: 0,
    csvData: null,
    error: null
  };

  try {
    const auth = await checkAuth(apiBase);
    const localDb = await getLocalDoubanDb(uid);

    // Build map of existing items: key = `${item.cat}_${item.id}`
    const itemMap = new Map();
    (localDb.items || []).forEach((it) => {
      itemMap.set(`${it.cat}_${it.id}`, it);
    });
    const existingKeySet = new Set(itemMap.keys());
    const isFirstTime = existingKeySet.size === 0;

    doubanSyncState.message = isFirstTime
      ? "首次同步：正在全量建立本地豆瓣影视库..."
      : `已加载本地库 (${existingKeySet.size} 部)，正在检查豆瓣最新标记...`;

    let newItems = [];

    // Helper: fetch batch using Rexxar with DNR Referer, or fallback to desktop
    const fetchCategoryInterests = async (status, label, display) => {
      let st = 0;
      let empty = 0;
      let consecutiveExisting = 0;
      let shouldStop = false;
      const isDone = status === "done";
      const action = isDone ? "collect" : "wish";

      while (!shouldStop) {
        doubanSyncState.message = `📥 正在比对【${display}】... 已发现 ${newItems.length} 部新标记 (本地库累计 ${itemMap.size} 部)`;
        doubanSyncState.itemCount = newItems.length;

        let batch = [];
        try {
          // 1. Try Rexxar API
          const url = `https://m.douban.com/rexxar/api/v2/user/${uid}/interests?type=movie&count=50&status=${status}&start=${st}`;
          const res = await fetch(url, {
            headers: {
              "Referer": "https://m.douban.com/",
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
            },
            credentials: "include"
          });
          if (res.ok) {
            const d = await res.json();
            if (d.interests && d.interests.length > 0) {
              batch = d.interests.map((i) => {
                const sub = i.subject || {};
                return {
                  cat: label,
                  id: String(sub.id || ""),
                  type: sub.type === "tv" ? "TV" : (sub.type === "movie" ? "Movie" : sub.type),
                  title: sub.title || "",
                  year: sub.year || "",
                  dir: (sub.directors || []).map((x) => x.name).join("/"),
                  act: (sub.actors || []).map((x) => x.name).join("/"),
                  gen: (sub.genres || []).join("/"),
                  reg: (sub.card_subtitle || "").split(" / ")[1] || "",
                  db_r: sub.rating?.value || "",
                  db_v: sub.rating?.count || "",
                  u_r: i.rating?.value ? String(Number(i.rating.value) * 2) : "",
                  u_c: i.comment || "",
                  date: i.create_time || i.updated_time || ""
                };
              });
            }
          }
        } catch (e) {}

        // 2. Fallback to Desktop HTML if Rexxar failed or returned empty on st=0
        if (batch.length === 0 && st === 0) {
          try {
            const deskUrl = `https://movie.douban.com/people/${uid}/${action}?start=0&sort=time&rating=all&filter=all&mode=grid`;
            const deskRes = await fetch(deskUrl, { credentials: "include" });
            if (deskRes.ok) {
              const html = await deskRes.text();
              const blocks = html.split(/<div class="item comment-item"/).slice(1);
              batch = blocks.map((block) => {
                const idMatch = block.match(/href="https:\/\/movie\.douban\.com\/subject\/(\d+)\//);
                const titleMatch = block.match(/class="title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
                const dateMatch = block.match(/class="date">([^<]+)<\/span>/);
                const ratingMatch = block.match(/class="rating(\d)-t"/);
                const commentMatch = block.match(/class="comment">([\s\S]*?)<\/p>|class="comment">([\s\S]*?)<\/span>|class="comment">([\s\S]*?)<\/li>/);
                const introMatch = block.match(/class="intro">([\s\S]*?)<\/li>/);
                const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
                const cleanTitle = rawTitle.split(/[\/_]/)[0].trim();
                const yearMatch = introMatch ? introMatch[1].match(/(?:19|20)\d{2}/) : null;
                const userRating = ratingMatch ? String(parseInt(ratingMatch[1], 10) * 2) : "";

                return {
                  cat: label,
                  id: idMatch ? idMatch[1] : "",
                  type: "Movie",
                  title: cleanTitle,
                  year: yearMatch ? yearMatch[0] : "",
                  dir: "",
                  act: "",
                  gen: "",
                  reg: "",
                  db_r: "",
                  db_v: "",
                  u_r: userRating,
                  u_c: commentMatch ? (commentMatch[1] || commentMatch[2] || commentMatch[3] || "").replace(/<[^>]+>/g, "").trim() : "",
                  date: dateMatch ? dateMatch[1].trim() : ""
                };
              });
            }
          } catch (e) {}
        }

        if (batch.length === 0) {
          if (++empty >= 2) break;
        } else {
          empty = 0;
          for (const item of batch) {
            const key = `${item.cat}_${item.id}`;
            if (!existingKeySet.has(key)) {
              // Brand new item!
              newItems.push(item);
              itemMap.set(key, item);
              existingKeySet.add(key);
              consecutiveExisting = 0;
            } else {
              // Already exists in local database
              consecutiveExisting++;
              // Update rating or comment if edited
              const old = itemMap.get(key);
              if (old && (old.u_r !== item.u_r || old.u_c !== item.u_c)) {
                itemMap.set(key, { ...old, ...item });
              }
              // If not first time, stop once we see 10 consecutive existing items
              if (!isFirstTime && consecutiveExisting >= 10) {
                shouldStop = true;
                break;
              }
            }
          }
        }

        st += 50;
        await wait(300);
      }
    };

    await fetchCategoryInterests("done", "Done", "看过");
    await fetchCategoryInterests("mark", "Mark", "想看");

    // Rebuild sorted array
    const allSortedItems = Array.from(itemMap.values()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const watchedCount = allSortedItems.filter((x) => x.cat === "Done").length;
    const wishCount = allSortedItems.filter((x) => x.cat === "Mark").length;

    localDb.items = allSortedItems;
    localDb.watchedCount = watchedCount;
    localDb.wishCount = wishCount;
    localDb.lastSyncTime = new Date().toISOString();
    await saveLocalDoubanDb(uid, localDb);

    // Generate full CSV for the entire local database
    const fullCsvData = generateCsvFromItems(allSortedItems);
    await chrome.storage.local.set({
      latestDoubanCsv: fullCsvData,
      doubanLastSyncTime: localDb.lastSyncTime
    });

    // Push new items to CinePersona only after the user explicitly opted in for this sync.
    let cloudSyncStatus = "not_requested";
    let cloudSyncError = null;
    if (newItems.length > 0 && allowCloudSync && auth.authenticated) {
      cloudSyncStatus = "syncing";
      doubanSyncState.message = `正在将新增的 ${newItems.length} 部标记写入影格片库...`;
      try {
        const importPayload = {
          source: "DOUBAN",
          filename: `douban-sync-${uid}-${new Date().toISOString().slice(0, 10)}.json`,
          doubanUserId: String(uid),
          strict: false,
          consentAccepted: true,
          itemCount: newItems.length,
          items: newItems.map((item) => {
            let isoDate = undefined;
            if (item.date) {
              try {
                isoDate = item.date.includes("T") ? item.date : `${item.date}T00:00:00+08:00`;
              } catch (e) {}
            }
            return {
              sourceId: String(item.id),
              sourceUrl: `https://movie.douban.com/subject/${item.id}/`,
              title: item.title,
              releaseYear: item.year ? parseInt(item.year, 10) : undefined,
              rating: item.u_r ? Number(item.u_r) : undefined,
              watchedAt: isoDate,
              ratedAt: isoDate,
              comment: item.u_c || "",
              mediaType: item.type === "TV" ? "tv" : "movie",
              statusHint: item.cat === "Mark" ? "PLAN_TO_WATCH" : "WATCHED"
            };
          })
        };

        const importRes = await fetch(`${apiBase}/v1/import/jobs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importPayload)
        });
        if (!importRes.ok) {
          const errorBody = await importRes.json().catch(() => ({}));
          throw new Error(errorBody.error?.message || `影格导入接口返回 ${importRes.status}`);
        }
        cloudSyncStatus = "completed";
      } catch (e) {
        cloudSyncStatus = "failed";
        cloudSyncError = e.message;
        console.warn("[CinePersona] 提交写入影格异常:", e);
      }
    } else if (newItems.length > 0 && allowCloudSync && !auth.authenticated) {
      cloudSyncStatus = "unavailable";
    }

    let successMsg = "";
    if (newItems.length > 0) {
      if (cloudSyncStatus === "completed") {
        successMsg = `同步完成！发现 ${newItems.length} 部新标记并已写入影格，本地库共积累 ${allSortedItems.length} 部。`;
      } else if (cloudSyncStatus === "failed") {
        successMsg = `本地同步完成，新增 ${newItems.length} 部；影格云端写入失败：${cloudSyncError || "请稍后重试"}。`;
      } else if (cloudSyncStatus === "unavailable") {
        successMsg = `本地同步完成，新增 ${newItems.length} 部；当前未登录影格，未写入云端。`;
      } else if (auth.authenticated) {
        successMsg = `本地同步完成，新增 ${newItems.length} 部；本次未授权写入影格云端。`;
      } else {
        successMsg = `更新完成！本地库新增 ${newItems.length} 部，共积累 ${allSortedItems.length} 部（未登录影格，未写入云端）。`;
      }
    } else {
      successMsg = `本地影视库已与豆瓣对齐（暂无新标记），本地库共 ${allSortedItems.length} 部；本次未向影格云端提交记录。`;
    }

    doubanSyncState = {
      status: "success",
      cloudSyncRequested: Boolean(allowCloudSync),
      cloudSyncStatus,
      cloudSyncError,
      message: successMsg,
      itemCount: newItems.length,
      totalCount: allSortedItems.length,
      watchedCount,
      wishCount,
      lastSyncTime: localDb.lastSyncTime,
      csvData: fullCsvData,
      error: null
    };
    return doubanSyncState;
  } catch (err) {
    doubanSyncState = {
      status: "error",
      cloudSyncRequested: Boolean(allowCloudSync),
      cloudSyncStatus: "error",
      message: err.message,
      itemCount: 0,
      totalCount: 0,
      watchedCount: 0,
      wishCount: 0,
      csvData: null,
      error: err.message
    };
    return doubanSyncState;
  }
}

/**
 * Check if the user is authenticated with CinePersona and fetch library stats
 */
async function checkAuth(apiBase = DEFAULT_API_BASE) {
  try {
    const res = await fetch(`${apiBase}/v1/auth/session`, {
      credentials: "include",
      cache: "no-store"
    });
    if (!res.ok) return { authenticated: false, user: null, stats: null };
    const json = await res.json();
    const authenticated = Boolean(json.data?.authenticated);
    let user = json.data?.user || null;

    let stats = null;
    if (authenticated) {
      try {
        const [accRes, libRes, watchRes] = await Promise.all([
          fetch(`${apiBase}/v1/settings/account`, { credentials: "include" }),
          fetch(`${apiBase}/v1/me/library?limit=1`, { credentials: "include" }),
          fetch(`${apiBase}/v1/me/watchlist?limit=1`, { credentials: "include" })
        ]);
        if (accRes && accRes.ok) {
          const accJson = await accRes.json();
          if (accJson.data?.user) {
            user = { ...user, ...accJson.data.user };
          }
        }
        const libData = libRes.ok ? await libRes.json() : null;
        const watchData = watchRes.ok ? await watchRes.json() : null;
        stats = {
          watchedCount: libData?.data?.paging?.total ?? 0,
          watchlistCount: watchData?.data?.paging?.total ?? 0
        };
      } catch (e) {}
    }

    if (user && user.image) {
      if (!user.image.startsWith("http") && !user.image.startsWith("data:")) {
        user.image = `${apiBase}/${user.image.replace(/^\/+/, "")}`;
      }
      if (user.image.startsWith("http:")) {
        user.image = user.image.replace(/^http:/, "https:");
      }
    }

    return {
      authenticated,
      user,
      stats,
      apiBase
    };
  } catch (err) {
    console.log("[CinePersona SW] Check auth error:", err);
    return { authenticated: false, user: null, stats: null, apiBase };
  }
}

/**
 * Fetch external ratings (Douban, IMDb, Letterboxd, CinePersona) for a movie
 */
async function getMovieDetailRatings(movieId, apiBase = DEFAULT_API_BASE) {
  try {
    const [detailRes, lboxdRes] = await Promise.allSettled([
      fetch(`${apiBase}/v1/movies/${encodeURIComponent(movieId)}?locale=zh`, {
        credentials: "include"
      }),
      fetch(`${apiBase}/v1/movies/${encodeURIComponent(movieId)}/letterboxd`, {
        credentials: "include"
      })
    ]);

    const ratings = [];

    // 1. Douban, IMDb, CinePersona
    if (detailRes.status === "fulfilled" && detailRes.value.ok) {
      const json = await detailRes.value.json();
      const data = json.data || {};
      if (data.doubanRating && data.doubanRating > 0) {
        ratings.push({ source: "豆瓣", score: data.doubanRating.toFixed(1) });
      }
      if (data.imdbRating && data.imdbRating > 0) {
        ratings.push({ source: "IMDb", score: data.imdbRating.toFixed(1) });
      }
      if (data.ratingScore && data.ratingScore > 0) {
        ratings.push({ source: "影格", score: data.ratingScore.toFixed(1) });
      }
    }

    // 2. Letterboxd
    if (lboxdRes.status === "fulfilled" && lboxdRes.value.ok) {
      const lboxdJson = await lboxdRes.value.json();
      const lboxdRating = lboxdJson.data?.rating;
      if (lboxdRating) {
        const num = parseFloat(lboxdRating);
        if (!isNaN(num) && num > 0) {
          ratings.push({ source: "Letterboxd", score: num.toFixed(1) });
        }
      }
    }

    return ratings;
  } catch (e) {
    return [];
  }
}

/**
 * Perform single search request
 */
async function executeSearch(query, apiBase) {
  try {
    const res = await fetch(`${apiBase}/v1/search?q=${encodeURIComponent(query)}&locale=zh`, {
      credentials: "include"
    });
    if (!res.ok) return [];
    const json = await res.json();
    const hits = json.data?.hits || [];
    return hits.filter((h) => (h.type || "").toLowerCase() === "movie");
  } catch (e) {
    return [];
  }
}

/**
 * Search and resolve movie by title and optional year, with fallback strategies
 */
async function searchAndResolve({ query, year, videoDuration }, apiBase = DEFAULT_API_BASE) {
  if (!query || typeof query !== "string") return null;
  const cleanQ = query.trim();
  if (cleanQ.length === 0) return null;

  const cacheKey = `${cleanQ}_${year || ""}_${videoDuration || ""}`;
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  try {
    // 1. First attempt: exact query
    let movieHits = await executeSearch(cleanQ, apiBase);

    // 2. Second attempt: if no hits and query has Chinese alongside other characters, try pure Chinese part
    if (movieHits.length === 0 && /[\u4e00-\u9fa5]/.test(cleanQ)) {
      const chineseOnly = cleanQ.match(/[\u4e00-\u9fa5]{2,}/g);
      if (chineseOnly && chineseOnly[0] && chineseOnly[0] !== cleanQ) {
        movieHits = await executeSearch(chineseOnly[0], apiBase);
      }
    }

    // 3. Third attempt: Fallback to remote TMDB search and auto-import into CinePersona
    if (movieHits.length === 0) {
      try {
        const remoteRes = await fetch(`${apiBase}/v1/search/remote/tmdb?q=${encodeURIComponent(cleanQ)}`, {
          credentials: "include"
        });
        if (remoteRes.ok) {
          const remoteJson = await remoteRes.json();
          const remoteHits = remoteJson.data?.hits || [];
          const movieHit = remoteHits.find((h) => (h.type || "").toLowerCase() === "movie") || remoteHits[0];
          const rawId = movieHit?.id || movieHit?.tmdbId;
          const numericId = typeof rawId === "number" ? rawId : parseInt(rawId, 10);
          if (numericId && !isNaN(numericId)) {
            const impRes = await fetch(`${apiBase}/v1/search/remote/tmdb/import`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tmdbId: numericId, mediaType: "movie" })
            });
            if (impRes.ok) {
              const impJson = await impRes.json();
              if (impJson.data?.movie) {
                const impMovie = impJson.data.movie;
                const poster = impMovie.posterPath
                  ? (impMovie.posterPath.startsWith("http") ? impMovie.posterPath : `https://image.tmdb.org/t/p/w300${impMovie.posterPath}`)
                  : null;
                const ratings = await getMovieDetailRatings(impMovie.id, apiBase);
                const resolved = {
                  ...impMovie,
                  posterURL: poster,
                  year: impMovie.releaseDate ? new Date(impMovie.releaseDate).getFullYear() : null,
                  ratings
                };
                searchCache.set(cacheKey, resolved);
                return resolved;
              }
            }
          }
        }
      } catch (err) {
        console.log("[CinePersona SW] Remote TMDB fallback failed:", err);
      }
    }

    if (movieHits.length === 0) return null;

    // Score and rank candidates by title match, popularity (votes), and year
    const scoredCandidates = [];

    for (const hit of movieHits) {
      let score = 0;
      const hitTitle = (hit.title || "").trim().toLowerCase();
      const queryLower = cleanQ.toLowerCase();

      // Title exact or containment match
      if (hitTitle === queryLower) {
        score += 1000;
      } else if (hitTitle.includes(queryLower) || queryLower.includes(hitTitle)) {
        score += 400;
      }

      // Votes / Popularity score: crucial to distinguish major feature films from 0-vote obscure shorts
      const votes = typeof hit.votes === "number" ? hit.votes : 0;
      if (votes > 100000) score += 600;
      else if (votes > 10000) score += 400;
      else if (votes > 1000) score += 200;
      else if (votes > 100) score += 80;

      // Year match bonus
      let hitYear = null;
      if (hit.subtitle) {
        const ym = hit.subtitle.match(/(?:19|20)\d{2}/);
        if (ym) hitYear = parseInt(ym[0], 10);
      }
      if (!hitYear && hit.releaseDate) {
        hitYear = new Date(hit.releaseDate).getFullYear();
      }

      if (year && hitYear === year) {
        score += 250;
      }

      scoredCandidates.push({ hit, score, hitYear });
    }

    scoredCandidates.sort((a, b) => b.score - a.score);

    // Soft runtime comparison: if video duration is known and substantial (>= 40 mins),
    // softly evaluate runtime match among top candidates to prioritize the true film.
    // Never discard candidates; prioritize by score.
    let bestHit = scoredCandidates[0].hit;

    if (scoredCandidates.length > 1 && videoDuration && videoDuration >= 40) {
      for (const item of scoredCandidates.slice(0, 3)) {
        try {
          const detailRes = await fetch(`${apiBase}/v1/movies/${encodeURIComponent(item.hit.id)}?locale=zh`, {
            credentials: "include"
          });
          if (detailRes.ok) {
            const detailJson = await detailRes.json();
            const movieData = detailJson.data?.movie;
            const runtime = movieData?.runtime || item.hit.runtime || 0;
            if (runtime > 0) {
              const diff = Math.abs(runtime - videoDuration);
              if (diff <= 25) {
                item.score += 400; // Strong bonus for runtime match
              } else if (diff > 50) {
                item.score -= 200; // Penalty for large discrepancy
              }
            }
          }
        } catch (e) {}
      }
      scoredCandidates.sort((a, b) => b.score - a.score);
      bestHit = scoredCandidates[0].hit;
    }

    const poster = bestHit.posterPath
      ? (bestHit.posterPath.startsWith("http") ? bestHit.posterPath : `https://image.tmdb.org/t/p/w300${bestHit.posterPath}`)
      : null;
    let parsedYear = null;
    if (bestHit.subtitle) {
      const ym = bestHit.subtitle.match(/(?:19|20)\d{2}/);
      if (ym) parsedYear = parseInt(ym[0], 10);
    }
    if (!parsedYear && bestHit.releaseDate) {
      parsedYear = new Date(bestHit.releaseDate).getFullYear();
    }

    const ratings = await getMovieDetailRatings(bestHit.id, apiBase);
    const resolved = {
      ...bestHit,
      posterURL: poster,
      year: parsedYear,
      ratings
    };

    searchCache.set(cacheKey, resolved);
    return resolved;
  } catch (err) {
    console.log("[CinePersona SW] Search resolve error:", err);
    return null;
  }
}

/**
 * Get current viewer activity for a movie
 */
async function getActivity({ movieId }, apiBase = DEFAULT_API_BASE) {
  try {
    const res = await fetch(`${apiBase}/v1/movies/${encodeURIComponent(movieId)}/viewer-activity`, {
      credentials: "include"
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.activity || null;
  } catch (err) {
    return null;
  }
}

/**
 * Mark movie as watched / log rewatch / rate / review on CinePersona
 */
async function logActivity({ movieId, status = "WATCHED", rating, reviewText, isRewatch = false }, apiBase = DEFAULT_API_BASE) {
  try {
    const body = {
      status,
      watchedAt: new Date().toISOString()
    };
    if (rating !== undefined && rating !== null) {
      body.rating = rating;
    }
    if (reviewText && reviewText.trim()) {
      body.reviewText = reviewText.trim();
    }
    if (isRewatch) {
      body.isRewatch = true;
    }

    const res = await fetch(`${apiBase}/v1/movies/${encodeURIComponent(movieId)}/viewer-activity`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (err) {
    console.log("[CinePersona SW] Log activity error:", err);
    return false;
  }
}

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { apiBase = DEFAULT_API_BASE } = await chrome.storage.sync.get("apiBase");

      if (message.action === "CHECK_AUTH") {
        const auth = await checkAuth(apiBase);
        sendResponse(auth);
        return;
      }

      if (message.action === "SEARCH_AND_RESOLVE") {
        const payload = message.payload || {};
        const auth = await checkAuth(apiBase);
        const movie = await searchAndResolve(payload, apiBase);
        let activity = null;
        if (movie && auth.authenticated) {
          activity = await getActivity({ movieId: movie.id }, apiBase);
        }
        sendResponse({
          success: Boolean(movie),
          movie,
          activity,
          isAuthenticated: auth.authenticated
        });
        return;
      }

      if (message.action === "SYNC_TAB_MOVIE") {
        const tabId = sender.tab?.id || message.payload?.tabId;
        if (tabId && message.payload?.movie) {
          tabMovieMap.set(tabId, {
            movie: message.payload.movie,
            activity: message.payload.activity,
            timestamp: Date.now()
          });
        }
        sendResponse({ success: true });
        return;
      }

      if (message.action === "GET_TAB_MOVIE") {
        const tabId = sender.tab?.id || message.payload?.tabId;
        const data = tabId ? tabMovieMap.get(tabId) : null;
        sendResponse({ success: Boolean(data), data });
        return;
      }

      if (message.action === "GET_ACTIVITY") {
        const activity = await getActivity(message.payload || {}, apiBase);
        sendResponse({ activity });
        return;
      }

      if (message.action === "SEARCH_HITS") {
        const query = message.payload?.query || "";
        const hits = await executeSearch(query, apiBase);
        const resolvedHits = hits.map((h) => {
          const poster = h.posterPath
            ? (h.posterPath.startsWith("http") ? h.posterPath : `https://image.tmdb.org/t/p/w300${h.posterPath}`)
            : null;
          let year = null;
          if (h.subtitle) {
            const ym = h.subtitle.match(/(?:19|20)\d{2}/);
            if (ym) year = parseInt(ym[0], 10);
          }
          if (!year && h.releaseDate) {
            year = new Date(h.releaseDate).getFullYear();
          }
          return { ...h, posterURL: poster, year };
        });
        sendResponse({ success: true, hits: resolvedHits });
        return;
      }

      if (message.action === "GET_MOVIE_RATINGS") {
        const movieId = message.payload?.movieId;
        const ratings = movieId ? await getMovieDetailRatings(movieId, apiBase) : [];
        sendResponse({ success: true, ratings });
        return;
      }

      if (message.action === "LOG_ACTIVITY" || message.action === "MARK_WATCHED" || message.action === "RATE_MOVIE") {
        const success = await logActivity(message.payload || {}, apiBase);
        sendResponse({ success });
        return;
      }

      if (message.action === "DOUBAN_CHECK_SESSION") {
        const session = await checkDoubanSession();
        sendResponse(session);
        return;
      }

      if (message.action === "DOUBAN_START_SYNC") {
        const { uid, allowCloudSync = false } = message.payload || {};
        executeDoubanSmartSync(uid, apiBase, Boolean(allowCloudSync));
        sendResponse({ success: true, status: doubanSyncState });
        return;
      }

      if (message.action === "DOUBAN_GET_SYNC_STATUS") {
        sendResponse({ success: true, status: doubanSyncState });
        return;
      }

      if (message.action === "DOUBAN_EXPORT_CSV") {
        const uid = message.payload?.uid;
        if (!uid) {
          sendResponse({ success: false, error: "Missing uid" });
          return;
        }
        const localDb = await getLocalDoubanDb(uid);
        const csvData = generateCsvFromItems(localDb.items || []);
        await chrome.storage.local.set({ latestDoubanCsv: csvData });
        sendResponse({ success: true, csvData, count: localDb.items?.length || 0 });
        return;
      }

      if (message.action === "DOUBAN_RESET_LOCAL_DB" || message.action === "DOUBAN_RESET_SYNC_ANCHOR") {
        const uid = message.payload?.uid;
        if (uid) {
          await chrome.storage.local.remove([`douban_db_${uid}`, "latestDoubanCsv", "doubanLastSyncTime", "doubanLastSyncCount", "doubanLastMatchedCount", "doubanLastUnmatchedCount"]);
        }
        doubanSyncState = {
          status: "idle",
          mode: "incremental",
          message: "已重置本地库，点击上方按钮即可重新完整抓取。",
          itemCount: 0,
          totalCount: 0,
          watchedCount: 0,
          wishCount: 0,
          csvData: null,
          error: null
        };
        sendResponse({ success: true, status: doubanSyncState });
        return;
      }

      sendResponse({ error: "Unknown action" });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();

  return true;
});
