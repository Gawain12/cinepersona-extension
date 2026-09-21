document.addEventListener("DOMContentLoaded", async () => {
  const i18n = globalThis.CinePersonaI18n || {};
  const t = (zh, en) => typeof i18n.t === "function" ? i18n.t(zh, en) : zh;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
  const safeHttpUrl = (value) => {
    try {
      const raw = String(value || "");
      const url = new URL(raw, window.location.href);
      if (/^https?:$/i.test(url.protocol)) return url.href;
      if (url.protocol === "data:" && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(raw)) return raw;
      return "";
    } catch (e) {
      return "";
    }
  };
  if (typeof i18n.apply === "function") i18n.apply(document);

  // Navigation elements
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const playingContainer = document.getElementById("playingContainer");

  // Settings elements
  const authStatus = document.getElementById("authStatus");
  const userInfo = document.getElementById("userInfo");
  const mainAction = document.getElementById("mainAction");
  const scrobbleTiming = document.getElementById("scrobbleTiming");
  const togglePlatformsBtn = document.getElementById("togglePlatformsBtn");
  const platformsDetail = document.getElementById("platformsDetail");
  const scrobbleStateBadge = document.getElementById("scrobbleStateBadge");
  const masterScrobbleToggle = document.getElementById("masterScrobbleToggle");

  let currentAuthState = null;
  let currentRenderedMovieId = null;
  let quickSearchTimer = null;
  let quickSearchRequestId = 0;
  let quickSearchHits = [];
  let quickSearchResolvedQuery = "";
  let quickSearchComposing = false;
  const CINEPERSONA_WEB_ORIGIN = "https://cinepersona.com";

  // Master Scrobble Toggle Logic
  let { scrobbleEnabled = true } = await chrome.storage.local.get("scrobbleEnabled");

  function updateScrobbleStateUI(enabled) {
    if (masterScrobbleToggle) masterScrobbleToggle.checked = enabled;
    if (scrobbleStateBadge) {
      scrobbleStateBadge.className = "status-badge " + (enabled ? "active" : "paused");
      scrobbleStateBadge.textContent = enabled ? t("● 监测中", "● Active") : t("⏸ 已暂停", "⏸ Paused");
    }
  }
  updateScrobbleStateUI(scrobbleEnabled);

  if (masterScrobbleToggle) {
    masterScrobbleToggle.addEventListener("change", async (e) => {
      scrobbleEnabled = e.target.checked;
      await chrome.storage.local.set({ scrobbleEnabled });
      updateScrobbleStateUI(scrobbleEnabled);
      queryActiveTabPlaying();
    });
  }

  if (scrobbleStateBadge) {
    scrobbleStateBadge.addEventListener("click", async () => {
      scrobbleEnabled = !scrobbleEnabled;
      await chrome.storage.local.set({ scrobbleEnabled });
      updateScrobbleStateUI(scrobbleEnabled);
      queryActiveTabPlaying();
    });
  }

  // 1. Tab Switching
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(targetTab);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // 2. Load Preferences
  const { timingPreference = "0.80" } = await chrome.storage.sync.get("timingPreference");
  if (scrobbleTiming) {
    scrobbleTiming.value = timingPreference;
    scrobbleTiming.addEventListener("change", (e) => {
      chrome.storage.sync.set({ timingPreference: e.target.value });
    });
  }

  // 3. Platform Interactive Toggles
  let { disabledPlatforms = [] } = await chrome.storage.local.get("disabledPlatforms");
  if (!Array.isArray(disabledPlatforms)) disabledPlatforms = [];

  function updatePlatformTagsUI() {
    if (!platformsDetail) return;
    platformsDetail.querySelectorAll(".platform-item").forEach((el) => {
      const plat = el.getAttribute("data-platform");
      if (!plat) return;
      const isDisabled = disabledPlatforms.includes(plat);
      el.classList.toggle("disabled", isDisabled);
      el.title = isDisabled
        ? t(`点击恢复【${plat}】的观影打卡`, `Click to enable ${plat}`)
        : t(`点击排除【${plat}】的观影打卡`, `Click to exclude ${plat}`);
    });
  }
  updatePlatformTagsUI();

  if (platformsDetail) {
    platformsDetail.addEventListener("click", async (e) => {
      const tag = e.target.closest(".platform-item");
      if (!tag) return;
      const plat = tag.getAttribute("data-platform");
      if (!plat) return;

      if (disabledPlatforms.includes(plat)) {
        disabledPlatforms = disabledPlatforms.filter((p) => p !== plat);
      } else {
        disabledPlatforms.push(plat);
      }
      await chrome.storage.local.set({ disabledPlatforms });
      updatePlatformTagsUI();
      queryActiveTabPlaying();
    });
  }

  if (togglePlatformsBtn && platformsDetail) {
    let isOpen = false;
    togglePlatformsBtn.addEventListener("click", () => {
      isOpen = !isOpen;
      if (isOpen) {
        platformsDetail.classList.add("show");
        togglePlatformsBtn.textContent = t("收起平台列表 ▴", "Hide supported platforms ▴");
      } else {
        platformsDetail.classList.remove("show");
        togglePlatformsBtn.textContent = t("查看全部支持平台 ▾", "Show all supported platforms ▾");
      }
    });
  }

  // 4. Session Auth Rendering
  const { cachedAuth } = await chrome.storage.local.get("cachedAuth");
  if (cachedAuth && cachedAuth.authenticated) {
    renderAuth(cachedAuth);
  }

  try {
    chrome.runtime.sendMessage({ action: "CHECK_AUTH" }, (res) => {
      if (res) {
        chrome.storage.local.set({ cachedAuth: res });
        renderAuth(res);
      }
    });
  } catch (e) {
    if (!cachedAuth) {
      authStatus.textContent = t("离线", "Offline");
      userInfo.textContent = t("未检测到影格账号。在网页看片可暂存，建议先登录开启云端同步。", "No CinePersona account detected. Films can be saved locally while you watch; sign in to enable cloud sync.");
    }
  }

  function bindImageFallbacks(container) {
    if (!container) return;
    container.querySelectorAll("img").forEach((img) => {
      const next = img.nextElementSibling;
      const applyFallback = () => {
        img.style.display = "none";
        if (next && (next.classList.contains("user-avatar-placeholder") || next.classList.contains("douban-avatar") || next.classList.contains("poster-fallback") || next.classList.contains("quick-search-thumb-fallback"))) {
          next.style.display = "flex";
        }
      };

      if (!img.getAttribute("src")) {
        applyFallback();
        return;
      }

      if (img.complete && img.naturalWidth > 0) {
        img.style.display = "";
        if (next && (next.classList.contains("user-avatar-placeholder") || next.classList.contains("douban-avatar") || next.classList.contains("poster-fallback") || next.classList.contains("quick-search-thumb-fallback"))) {
          next.style.display = "none";
        }
      }

      img.addEventListener("error", applyFallback);
      img.addEventListener("load", () => {
        if (img.naturalWidth > 0) {
          img.style.display = "";
          if (next && (next.classList.contains("user-avatar-placeholder") || next.classList.contains("douban-avatar") || next.classList.contains("poster-fallback") || next.classList.contains("quick-search-thumb-fallback"))) {
            next.style.display = "none";
          }
        } else {
          applyFallback();
        }
      });
    });
  }

  function renderAuth(res) {
    currentAuthState = res;
    if (res && res.authenticated) {
      authStatus.textContent = t("已连接", "Connected");
      authStatus.className = "status-badge online";
      const name = res.user?.name || res.user?.email || t("已登录会员", "Signed-in member");
      const baseUrl = res.apiBase || "https://cinepersona.com";
      let avatar = res.user?.image || "";
      if (avatar && !avatar.startsWith("http") && !avatar.startsWith("data:")) {
        avatar = `${baseUrl}/${avatar.replace(/^\/+/, "")}`;
      }
      if (avatar.startsWith("http:")) {
        avatar = avatar.replace(/^http:/, "https:");
      }
      const stats = res.stats;
      const safeName = escapeHtml(name);
      const safeAvatar = escapeHtml(safeHttpUrl(avatar));
      const initial = escapeHtml(name.charAt(0).toUpperCase());
      const avatarHtml = safeAvatar
        ? `<img class="user-avatar-img" referrerpolicy="no-referrer" src="${safeAvatar}" alt="${safeName}" /><div class="user-avatar-placeholder" style="display:none;">${initial}</div>`
        : `<div class="user-avatar-placeholder">${initial}</div>`;

      userInfo.innerHTML = `
        <div class="user-profile-row">
          <a href="https://cinepersona.com/library" target="_blank" title="${t("点击进入我的影格片库", "Open my CinePersona library")}">${avatarHtml}</a>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <a href="https://cinepersona.com/library" target="_blank" class="user-name-link" title="${t("点击前往我的影格片库", "Go to my CinePersona library")}">
                <span>${safeName}</span>
                <span style="font-size: 11px; opacity: 0.7;">↗</span>
              </a>
              ${stats ? `<a href="https://cinepersona.com/library" target="_blank" rel="noopener noreferrer" class="user-stat-badge" title="${t("查看已看与想看片库", "View watched and watchlist")}">🎬 ${escapeHtml(stats.watchedCount || 0)} · 📌 ${escapeHtml(stats.watchlistCount || 0)}</a>` : ""}
            </div>
            <div style="font-size: 11px; margin-top: 4px;">
              <a href="https://cinepersona.com/library" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 500;">
                ${t("打开我的影格片库 ↗", "Open my CinePersona library ↗")}
              </a>
            </div>
          </div>
        </div>
      `;
      bindImageFallbacks(userInfo);
      mainAction.textContent = t("查看我的电影 DNA", "View my movie DNA");
      mainAction.href = "https://cinepersona.com/dna";
    } else {
      authStatus.textContent = t("未登录", "Not signed in");
      authStatus.className = "status-badge offline";
      userInfo.textContent = t("未检测到影格账号。在网页看片可暂存，建议先登录开启云端同步。", "No CinePersona account detected. Films can be saved locally while you watch; sign in to enable cloud sync.");
      mainAction.textContent = t("一键登录 CinePersona", "Sign in to CinePersona");
      mainAction.href = "https://cinepersona.com/login";
    }
  }

  let currentActiveTabId = null;

  function renderLoadingPlaying(text = t("正在识别当前播放影视...", "Identifying the current film...")) {
    // A WAITING_MATCH response means an actual video is present. Keep this state
    // as a stable loading card instead of exposing a search field that could be
    // replaced halfway through typing.
    const loadingCard = playingContainer.querySelector("#quickSearchLoading");
    if (loadingCard) {
      const statusEl = loadingCard.querySelector("#quickSearchStatus");
      if (statusEl) statusEl.textContent = text;
      return;
    }

    invalidateQuickSearch();
    playingContainer.innerHTML = `
      <div class="card empty-playing quick-search-loading" id="quickSearchLoading" aria-live="polite">
        <div class="empty-icon loading-pulse">🎬</div>
        <div id="quickSearchStatus" style="font-weight: 600; color: #f1f5f9;">${text}</div>
        <div style="font-size: 10px; color: #8e9eb5; margin-top: 3px;">${t("正在等待当前视频完成识别…", "Waiting for the current video to be identified…")}</div>
      </div>
    `;
  }

  function invalidateQuickSearch() {
    if (quickSearchTimer) {
      clearTimeout(quickSearchTimer);
      quickSearchTimer = null;
    }
    quickSearchRequestId += 1;
    quickSearchHits = [];
    quickSearchResolvedQuery = "";
  }

  function getQuickSearchPosterUrl(path) {
    if (!path) return "";
    const raw = String(path).trim();
    const url = raw.startsWith("http://") || raw.startsWith("https://")
      ? raw
      : `https://image.tmdb.org/t/p/w185${raw.startsWith("/") ? "" : "/"}${raw}`;
    return safeHttpUrl(url);
  }

  function getQuickSearchTargetUrl(hit) {
    const raw = String(hit?.url || "").trim();
    let target = raw;
    if (raw.startsWith("/")) target = `${CINEPERSONA_WEB_ORIGIN}${raw}`;
    if (!/^https?:\/\//i.test(target) && hit?.id) {
      target = `${CINEPERSONA_WEB_ORIGIN}/movie/${encodeURIComponent(hit.id)}`;
    }
    return safeHttpUrl(target);
  }

  function openQuickSearchHit(hit) {
    const target = getQuickSearchTargetUrl(hit);
    if (target) window.open(target, "_blank");
  }

  function renderQuickSearchResults(state = "idle", hits = []) {
    const resultsEl = playingContainer.querySelector("#quickSearchResults");
    if (!resultsEl) return;

    if (state === "loading") {
      resultsEl.innerHTML = `<div class="quick-search-hint">${t("检索中…", "Searching…")}</div>`;
      return;
    }
    if (state === "error") {
      resultsEl.innerHTML = `<div class="quick-search-hint">${t("检索暂时失败，可打开完整检索。", "Search temporarily failed. Open full search instead.")}</div>`;
      return;
    }
    if (!hits.length) {
      resultsEl.innerHTML = state === "empty"
        ? `<div class="quick-search-hint">${t("未找到电影条目，可打开完整检索。", "No film matches. Open full search for more sources.")}</div>`
        : "";
      return;
    }

    resultsEl.innerHTML = hits.map((hit, index) => {
      const title = escapeHtml(hit.title || hit.titleEn || t("未命名影片", "Untitled film"));
      const metaParts = [
        hit.subtitle || hit.titleOriginal || hit.titleEn || t("电影", "Film"),
        hit.director ? `${t("导演", "Dir.")} ${hit.director}` : ""
      ].filter(Boolean);
      const subtitle = escapeHtml(metaParts.join(" · "));
      const posterUrl = escapeHtml(getQuickSearchPosterUrl(hit.posterPath || hit.posterURL));
      const poster = posterUrl
        ? `<img class="quick-search-thumb" src="${posterUrl}" alt="${title}" /><span class="quick-search-thumb-fallback">🎬</span>`
        : `<span class="quick-search-thumb quick-search-thumb-placeholder">🎬</span>`;
      return `
        <button type="button" class="quick-search-item" data-quick-index="${index}">
          ${poster}
          <span class="quick-search-info">
            <span class="quick-search-title">${title}</span>
            <span class="quick-search-subtitle">${subtitle}</span>
          </span>
          <span class="quick-search-arrow">›</span>
        </button>
      `;
    }).join("");

    bindImageFallbacks(resultsEl);
    resultsEl.querySelectorAll("[data-quick-index]").forEach((item) => {
      item.addEventListener("click", () => {
        const index = Number(item.getAttribute("data-quick-index"));
        const hit = quickSearchHits[index];
        if (hit) openQuickSearchHit(hit);
      });
    });
  }

  function scheduleQuickSearch(query) {
    if (quickSearchTimer) clearTimeout(quickSearchTimer);
    const requestId = ++quickSearchRequestId;
    quickSearchHits = [];
    quickSearchResolvedQuery = "";
    const cleanQuery = String(query || "").trim();

    if ([...cleanQuery].length < 2) {
      renderQuickSearchResults("idle");
      return;
    }

    renderQuickSearchResults("loading");
    quickSearchTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: "QUICK_SEARCH", payload: { query: cleanQuery } }, (res) => {
        if (requestId !== quickSearchRequestId) return;
        quickSearchTimer = null;
        if (chrome.runtime.lastError || !res?.success) {
          renderQuickSearchResults("error");
          return;
        }
        quickSearchHits = Array.isArray(res.hits) ? res.hits : [];
        quickSearchResolvedQuery = cleanQuery;
        renderQuickSearchResults(quickSearchHits.length ? "ready" : "empty", quickSearchHits);
      });
    }, 400);
  }

  // 5. Query Active Tab for Current Playing Movie
  async function queryActiveTabPlaying() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        renderEmptyPlaying(t("未获取到当前标签页", "The current tab could not be read."));
        return;
      }

      const activeTab = tabs[0];
      currentActiveTabId = activeTab.id;
      chrome.tabs.sendMessage(activeTab.id, { action: "GET_CURRENT_PLAYING" }, { frameId: 0 }, (response) => {
        const lastErr = chrome.runtime.lastError;

        if (response && response.reason === "SCROBBLE_PAUSED") {
          renderScrobblePausedCard();
          return;
        }

        if (response && response.reason === "PLATFORM_DISABLED") {
          renderPlatformDisabledCard(response.platformName);
          return;
        }

        if (response && response.reason === "MANUAL_SKIP") {
          renderManualSkippedCard(response.platformName, response.data?.movie);
          return;
        }

        if (response && response.reason === "WAITING_MATCH") {
          renderLoadingPlaying(t("正在识别当前播放影视...", "Identifying the current film..."));
          setTimeout(queryActiveTabPlaying, 1000);
          return;
        }

        if (response && response.reason === "TV_SERIES") {
          renderNonMovieSkipped(t("当前检测到剧集 / 连续剧 / 综艺播放。<br/><span style='font-size: 11px; color: #64748b; margin-top: 6px; display: inline-block;'>影格专注于电影长片品味沉淀，剧集条目已自动隔离，不计入电影打卡。</span>", "A TV series or variety show is playing.<br/><span style='font-size: 11px; color: #64748b; margin-top: 6px; display: inline-block;'>CinePersona focuses on feature films; TV entries are kept out of your movie history.</span>"));
          return;
        }

        if (response && response.reason === "SHORT_CLIP") {
          renderNonMovieSkipped(t("当前视频时长不足 40 分钟（短视频 / MV / 片花）。<br/><span style='font-size: 11px; color: #64748b; margin-top: 6px; display: inline-block;'>与电影长片时长不符，已自动跳过。</span>", "This video is shorter than 40 minutes (short video, MV, or trailer).<br/><span style='font-size: 11px; color: #64748b; margin-top: 6px; display: inline-block;'>It does not match a feature-film runtime and was skipped.</span>"));
          return;
        }

        if (!response || !response.success || !response.data) {
          // If frame 0 didn't have active movie data, check tabMovieMap from background
          chrome.runtime.sendMessage({ action: "GET_TAB_MOVIE", payload: { tabId: activeTab.id } }, (tabRes) => {
            if (tabRes && tabRes.data && tabRes.data.movie) {
              renderPlaying({
                movie: tabRes.data.movie,
                activity: tabRes.data.activity,
                progress: 0,
                currentTime: 0,
                duration: 0,
                hasScrobbled: false,
                platformName: t("当前页面", "Current page")
              });
            } else if (!currentRenderedMovieId) {
              if (lastErr) {
                renderEmptyPlaying(t("当前页面未激活 CinePersona 监听", "CinePersona is not active on this page."));
              } else {
                currentRenderedMovieId = null;
                renderEmptyPlaying(t("当前标签页未播放受支持的影视条目。<br/>在支持的网盘或流媒体播放电影时，将在此实时呈现。", "No supported film is playing in this tab.<br/>Play a film on a supported streaming or cloud-drive site to see it here."));
              }
            }
          });
          return;
        }
        renderPlaying(response.data);
      });
    } catch (err) {
      if (!currentRenderedMovieId) {
        renderEmptyPlaying(t("当前页面未激活 CinePersona 监听", "CinePersona is not active on this page."));
      }
    }
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "00:00";
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(remM).padStart(2, "0")}:${String(remS).padStart(2, "0")}`;
    }
    return `${String(remM).padStart(2, "0")}:${String(remS).padStart(2, "0")}`;
  }

  function renderScrobblePausedCard() {
    invalidateQuickSearch();
    currentRenderedMovieId = null;
    playingContainer.innerHTML = `
      <div class="card empty-playing" style="border-left: 3px solid #f59e0b;">
        <div class="empty-icon" style="font-size: 28px;">⏸</div>
        <div style="font-weight: 600; color: #f1f5f9; margin-top: 6px;">${t("自动观影打卡已暂停", "Auto-scrobbling is paused")}</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px; line-height: 1.5;">${t("当前扩展处于全局暂停打卡状态，页面不会弹出打卡气泡或自动记录足迹。", "The extension is paused globally. In-page toasts and scrobbling are temporarily disabled.")}</div>
        <button class="btn btn-primary" id="resumeScrobbleBtn" style="margin-top: 10px; width: auto; padding: 6px 14px; font-size: 11px;">${t("恢复自动打卡 ▶", "Resume auto-scrobble ▶")}</button>
      </div>
    `;
    const resumeScrobbleBtn = playingContainer.querySelector("#resumeScrobbleBtn");
    if (resumeScrobbleBtn) {
      resumeScrobbleBtn.addEventListener("click", async () => {
        scrobbleEnabled = true;
        await chrome.storage.local.set({ scrobbleEnabled: true });
        updateScrobbleStateUI(true);
        queryActiveTabPlaying();
      });
    }
  }

  function renderPlatformDisabledCard(platformName) {
    invalidateQuickSearch();
    currentRenderedMovieId = null;
    const name = platformName || t("当前平台", "Current platform");
    const safeName = escapeHtml(name);
    playingContainer.innerHTML = `
      <div class="card empty-playing" style="border-left: 3px solid #94a3b8;">
        <div class="empty-icon" style="font-size: 28px;">🚫</div>
        <div style="font-weight: 600; color: #f1f5f9; margin-top: 6px;">${t("该平台打卡监测已排除", "Platform excluded")}</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px; line-height: 1.5;">${t(`您已在偏好设置中将【${safeName}】设为排除，在此播放不会触发打卡。`, `You have excluded [${safeName}] in preferences.`)}</div>
        <button class="btn btn-secondary" id="enableThisPlatformBtn" style="margin-top: 10px; width: auto; padding: 6px 14px; font-size: 11px;">${t(`为【${safeName}】恢复打卡`, `Enable for ${safeName}`)}</button>
      </div>
    `;
    const enableThisPlatformBtn = playingContainer.querySelector("#enableThisPlatformBtn");
    if (enableThisPlatformBtn) {
      enableThisPlatformBtn.addEventListener("click", async () => {
        disabledPlatforms = disabledPlatforms.filter((p) => p !== name);
        await chrome.storage.local.set({ disabledPlatforms });
        updatePlatformTagsUI();
        queryActiveTabPlaying();
      });
    }
  }

  function renderManualSkippedCard(platformName, movie) {
    invalidateQuickSearch();
    currentRenderedMovieId = null;
    const movieTitle = movie ? `《${escapeHtml(movie.title)}》` : t("当前影片", "this film");
    playingContainer.innerHTML = `
      <div class="card empty-playing" style="border-left: 3px solid #94a3b8;">
        <div class="empty-icon" style="font-size: 28px;">🙈</div>
        <div style="font-weight: 600; color: #f1f5f9; margin-top: 6px;">${t("已跳过本次观影打卡", "Skipped for this playback")}</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px; line-height: 1.5;">${t(`本次播放 ${movieTitle} 不会记录到您的影格片库。切换到其他视频后将自动恢复监测。`, `This viewing of ${movieTitle} will not be saved. Monitoring resumes on next video.`)}</div>
        <button class="btn btn-secondary" id="undoSkipBtn" style="margin-top: 10px; width: auto; padding: 6px 14px; font-size: 11px;">${t("撤销跳过 ↺", "Undo skip ↺")}</button>
      </div>
    `;
    const undoSkipBtn = playingContainer.querySelector("#undoSkipBtn");
    if (undoSkipBtn) {
      undoSkipBtn.addEventListener("click", () => {
        if (!currentActiveTabId) return;
        chrome.tabs.sendMessage(currentActiveTabId, { action: "UNSKIP_CURRENT_PLAYING" }, { frameId: 0 }, () => {
          queryActiveTabPlaying();
        });
      });
    }
  }

  function renderNonMovieSkipped(htmlMsg) {
    invalidateQuickSearch();
    currentRenderedMovieId = null;
    playingContainer.innerHTML = `
      <div class="card empty-playing" style="border-left: 3px solid #38bdf8;">
        <div class="empty-icon" style="font-size: 28px;">📺</div>
        <div style="font-weight: 600; color: #f1f5f9; margin-top: 6px;">${t("剧集 / 非电影隔离已生效", "TV and non-film filtering is active")}</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px; line-height: 1.5;">${htmlMsg}</div>
      </div>
    `;
  }

  function renderEmptyPlaying(msg) {
    currentRenderedMovieId = null;

    // Do not replace a user's search field during background polling. Apart from
    // losing focus, replacing the node also discarded text already entered.
    const existingSearchInput = playingContainer.querySelector("#quickSearchInput");
    if (existingSearchInput) {
      const statusEl = playingContainer.querySelector("#quickSearchStatus");
      if (statusEl) statusEl.innerHTML = msg;
      return;
    }

    invalidateQuickSearch();
    playingContainer.innerHTML = `
      <div class="card empty-playing quick-search-empty">
        <div id="quickSearchStatus" class="quick-search-status">${msg}</div>
        <div style="margin-top: 6px; width: 100%; display: flex; gap: 6px;">
          <input type="text" id="quickSearchInput" class="correct-input" placeholder="${t("在影格中搜索电影快速打卡...", "Search film on CinePersona...")}" style="flex: 1; font-size: 11px;" />
          <button id="quickSearchBtn" class="btn btn-secondary" style="width: auto; padding: 6px 12px; font-size: 11px;">${t("搜索", "Go")}</button>
        </div>
        <div id="quickSearchResults" class="quick-search-results" aria-live="polite"></div>
      </div>
    `;
    const quickSearchInput = playingContainer.querySelector("#quickSearchInput");
    const quickSearchBtn = playingContainer.querySelector("#quickSearchBtn");
    const doQuickSearch = () => {
      const q = quickSearchInput?.value?.trim();
      if (!q) return;
      if (quickSearchResolvedQuery === q && quickSearchHits.length === 1) {
        openQuickSearchHit(quickSearchHits[0]);
        return;
      }
      window.open(`https://cinepersona.com/search?q=${encodeURIComponent(q)}`, "_blank");
    };
    if (quickSearchBtn) quickSearchBtn.addEventListener("click", doQuickSearch);
    if (quickSearchInput) {
      quickSearchInput.addEventListener("compositionstart", () => {
        quickSearchComposing = true;
      });
      quickSearchInput.addEventListener("compositionend", () => {
        quickSearchComposing = false;
        scheduleQuickSearch(quickSearchInput.value);
      });
      quickSearchInput.addEventListener("input", () => {
        if (!quickSearchComposing) scheduleQuickSearch(quickSearchInput.value);
      });
      quickSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doQuickSearch();
      });
    }
  }

  function renderPlaying(data) {
    const movie = data.movie;
    const activity = data.activity;
    const progress = Math.min(1, Math.max(0, data.progress || 0));
    const percentStr = `${Math.round(progress * 100)}%`;
    const currentTimeStr = formatTime(data.currentTime);
    const durationStr = formatTime(data.duration);
    const hasScrobbled = Boolean(data.hasScrobbled);
    const isRewatch = Boolean(activity && activity.status === "WATCHED");

    const badgeLabel = hasScrobbled
      ? (isRewatch ? t("已记录重温 ✓", "Rewatch recorded ✓") : t("已打卡入库 ✓", "Saved to library ✓"))
      : t(`观影中 · ${percentStr}`, `Watching · ${percentStr}`);
    const badgeClass = hasScrobbled ? "scrobbled" : "watching";

    // If same movie is already rendered, only perform high-performance partial update
    if (currentRenderedMovieId === movie.id) {
      const badgeEl = playingContainer.querySelector(".movie-badge");
      if (badgeEl) {
        badgeEl.textContent = badgeLabel;
        badgeEl.className = `movie-badge ${badgeClass}`;
      }

      const progressInfoEl = playingContainer.querySelector(".progress-info");
      if (progressInfoEl) {
        progressInfoEl.innerHTML = `<span>${currentTimeStr} / ${durationStr}</span><span>${percentStr}</span>`;
      }

      const progressFillEl = playingContainer.querySelector(".progress-fill");
      if (progressFillEl) {
        progressFillEl.style.width = percentStr;
      }
      return;
    }

    invalidateQuickSearch();
    currentRenderedMovieId = movie.id;
    let currentRating = activity?.rating ? (activity.rating / 2) : 0;
    let reviewText = activity?.reviewText || "";

    const posterFallbackSvg = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="7" y1="4" x2="7" y2="20" />
        <line x1="17" y1="4" x2="17" y2="20" />
        <line x1="3" y1="8" x2="7" y2="8" />
        <line x1="3" y1="12" x2="7" y2="12" />
        <line x1="3" y1="16" x2="7" y2="16" />
        <line x1="17" y1="8" x2="21" y2="8" />
        <line x1="17" y1="12" x2="21" y2="12" />
        <line x1="17" y1="16" x2="21" y2="16" />
      </svg>
    `;

    const safeMovieTitle = escapeHtml(movie.title || t("未命名影片", "Untitled film"));
    const safePosterUrl = escapeHtml(safeHttpUrl(movie.posterURL));
    const safePlatformName = escapeHtml(data.platformName || t("当前页面", "Current page"));
    const safeYear = escapeHtml(movie.year || "");
    const safeReviewText = escapeHtml(reviewText);
    const posterHtml = safePosterUrl
      ? `<img class="poster-img" src="${safePosterUrl}" alt="${safeMovieTitle}" /><div class="poster-fallback" style="display:none;">${posterFallbackSvg}</div>`
      : `<div class="poster-fallback">${posterFallbackSvg}</div>`;

    let ratingsHtml = "";
    if (movie.ratings && movie.ratings.length > 0) {
      ratingsHtml = `
        <div class="movie-ratings-row">
          ${movie.ratings.map((r) => {
            let cls = "cp";
            let label = escapeHtml(r.source);
            if (r.source === "豆瓣") { cls = "douban"; label = "DB"; }
            else if (r.source === "IMDb") { cls = "imdb"; label = "IMDb"; }
            else if (r.source.toLowerCase().includes("letterboxd")) { cls = "lboxd"; label = "LB"; }
            else if (r.source === "影格") { cls = "cp"; label = "CP"; }
            return `<span class="rating-badge ${cls}">${label} ${escapeHtml(r.score)}</span>`;
          }).join("")}
        </div>
      `;
    }

    playingContainer.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>${safePlatformName}</span>
          <span class="movie-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="movie-box">
          <div class="poster-wrap clickable" id="moviePosterWrap" title="${t("点击在影格查看电影详情 ↗", "Open film details in CinePersona ↗")}">${posterHtml}</div>
          <div class="movie-info">
            <div class="movie-title clickable" id="movieTitleWrap" title="${t("点击在影格查看电影详情 ↗", "Open film details in CinePersona ↗")}">${safeMovieTitle}</div>
            <div class="movie-meta">${safeYear || t("电影", "Film")} · ${isRewatch ? t("曾看过的佳作", "Previously watched") : t("初次观影", "First watch")}</div>
            ${ratingsHtml}
            <span class="correct-link" id="toggleCorrectBtn">${t("识别有误？点击纠偏 ✎", "Wrong match? Correct it ✎")}</span>
          </div>
        </div>

        <!-- Correction Box -->
        <div class="correct-box" id="correctBox">
          <div class="correct-input-row">
            <input type="text" class="correct-input" id="correctSearchInput" placeholder="${t("输入正确片名搜索...", "Search the correct film title...")}" value="${safeMovieTitle}" />
            <button class="btn-sm" id="doCorrectSearchBtn">${t("搜索", "Search")}</button>
          </div>
          <div class="correct-results" id="correctResults"></div>
        </div>

        <!-- Progress Bar -->
        <div class="progress-bar-wrap">
          <div class="progress-info">
            <span>${currentTimeStr} / ${durationStr}</span>
            <span>${percentStr}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${percentStr};"></div>
          </div>
        </div>

        <!-- Rating Stars -->
        <div class="stars-row">
          <div class="stars-track" id="popupStars">
            <span class="star-item" data-idx="0">★</span>
            <span class="star-item" data-idx="1">★</span>
            <span class="star-item" data-idx="2">★</span>
            <span class="star-item" data-idx="3">★</span>
            <span class="star-item" data-idx="4">★</span>
          </div>
          <span class="star-text" id="starLabel">${currentRating > 0 ? `${(currentRating * 2).toFixed(currentRating % 1 === 0 ? 0 : 1)} ${t("分", "pts")}` : t("滑动打分", "Slide to rate")}</span>
        </div>

        <!-- Review Textarea -->
        <textarea class="review-textarea" id="popupReviewInput" placeholder="${t("写句简短观后感同步到影格主页...", "Write a short review to sync to your CinePersona profile...")}">${safeReviewText}</textarea>

        <!-- Action Button -->
        <button class="btn btn-primary" id="popupSaveBtn">
          ${hasScrobbled ? t("更新评分与短评", "Update rating and review") : (isRewatch ? t("立即记录重温", "Record this rewatch") : t("标记为已看", "Mark as watched"))}
        </button>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="btn btn-secondary" id="popupSkipFilmBtn" style="flex: 1; padding: 7px 10px; font-size: 11px;" title="${t("本次播放不记录入库，直到切换下一个视频", "Do not scrobble this viewing session")}">
            ${t("🙈 本次不打卡", "🙈 Skip this film")}
          </button>
          <button class="btn btn-secondary" id="popupOpenWebBtn" style="flex: 1; padding: 7px 10px; font-size: 11px;" title="${t("在影格打开完整详情与影评", "View full details & reviews on CinePersona")}">
            ${t("在影格打开 ↗", "Open in CinePersona ↗")}
          </button>
        </div>
      </div>
    `;
    bindImageFallbacks(playingContainer);

    // Click movie poster or title to open CinePersona movie page
    const moviePosterWrap = playingContainer.querySelector("#moviePosterWrap");
    const movieTitleWrap = playingContainer.querySelector("#movieTitleWrap");
    const handleOpenMovie = () => {
      if (movie && movie.id) {
        window.open(`https://cinepersona.com/movie/${encodeURIComponent(movie.id)}`, "_blank");
      }
    };
    if (moviePosterWrap) moviePosterWrap.addEventListener("click", handleOpenMovie);
    if (movieTitleWrap) movieTitleWrap.addEventListener("click", handleOpenMovie);

    const popupSkipFilmBtn = playingContainer.querySelector("#popupSkipFilmBtn");
    if (popupSkipFilmBtn) {
      popupSkipFilmBtn.addEventListener("click", () => {
        if (!currentActiveTabId) return;
        chrome.tabs.sendMessage(currentActiveTabId, { action: "SKIP_CURRENT_PLAYING" }, { frameId: 0 }, () => {
          renderManualSkippedCard(data.platformName || t("当前页面", "Current page"), movie);
        });
      });
    }

    const popupOpenWebBtn = playingContainer.querySelector("#popupOpenWebBtn");
    if (popupOpenWebBtn) {
      popupOpenWebBtn.addEventListener("click", handleOpenMovie);
    }

    // Toggle correction box interaction
    const toggleCorrectBtn = playingContainer.querySelector("#toggleCorrectBtn");
    const correctBox = playingContainer.querySelector("#correctBox");
    const correctSearchInput = playingContainer.querySelector("#correctSearchInput");
    const doCorrectSearchBtn = playingContainer.querySelector("#doCorrectSearchBtn");
    const correctResults = playingContainer.querySelector("#correctResults");

    if (toggleCorrectBtn && correctBox) {
      toggleCorrectBtn.addEventListener("click", () => {
        const isHidden = correctBox.style.display === "none" || !correctBox.style.display;
        correctBox.style.display = isHidden ? "block" : "none";
        if (isHidden && correctSearchInput) {
          correctSearchInput.focus();
        }
      });

      const handleSearch = () => {
        const q = correctSearchInput.value.trim();
        if (!q) return;
        doCorrectSearchBtn.textContent = t("搜索中...", "Searching...");
        chrome.runtime.sendMessage({ action: "SEARCH_HITS", payload: { query: q } }, (res) => {
          doCorrectSearchBtn.textContent = t("搜索", "Search");
          if (!res || !res.hits || res.hits.length === 0) {
            correctResults.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.4);padding:6px;text-align:center;">${t("未找到相关影视条目", "No matching film found")}</div>`;
            return;
          }
          correctResults.innerHTML = res.hits.slice(0, 5).map((h, i) => `
            <div class="correct-item" data-idx="${i}">
              <img class="correct-item-thumb" src="${escapeHtml(safeHttpUrl(h.posterURL))}" />
              <div class="correct-item-info">
                <div class="correct-item-title">${escapeHtml(h.title)}</div>
                <div class="correct-item-sub">${h.year ? escapeHtml(h.year) + ' · ' : ''}${escapeHtml(h.director || t("电影", "Film"))}</div>
              </div>
            </div>
          `).join("");
          bindImageFallbacks(correctResults);

          correctResults.querySelectorAll(".correct-item").forEach((item) => {
            item.addEventListener("click", () => {
              const idx = parseInt(item.getAttribute("data-idx"), 10);
              const selectedMovie = res.hits[idx];
              if (!selectedMovie) return;

              // Fetch ratings for corrected movie
              chrome.runtime.sendMessage({
                action: "GET_MOVIE_RATINGS",
                payload: { movieId: selectedMovie.id }
              }, (ratingRes) => {
                if (ratingRes && ratingRes.ratings) {
                  selectedMovie.ratings = ratingRes.ratings;
                }

                // 1. Tell active tab to override movie
                if (currentActiveTabId) {
                  chrome.tabs.sendMessage(currentActiveTabId, {
                    action: "OVERRIDE_MOVIE",
                    payload: { movie: selectedMovie }
                  });
                }

                // 2. Re-render playing card with selected movie
                currentRenderedMovieId = null;
                renderPlaying({ ...data, movie: selectedMovie });
              });
            });
          });
        });
      };

      doCorrectSearchBtn.addEventListener("click", handleSearch);
      correctSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSearch();
      });
    }

    // Star interaction (Half star & smooth hover motion)
    const starTrack = playingContainer.querySelector("#popupStars");
    const starItems = playingContainer.querySelectorAll(".star-item");
    const starLabel = playingContainer.querySelector("#starLabel");

    const renderPopupStars = (val) => {
      starItems.forEach((star, idx) => {
        const floor = idx + 1;
        star.classList.remove("active", "half");
        if (val >= floor) {
          star.classList.add("active");
        } else if (val >= floor - 0.5) {
          star.classList.add("half");
        }
      });
      if (starLabel) {
        starLabel.textContent = val > 0 ? `${(val * 2).toFixed(val % 1 === 0 ? 0 : 1)} ${t("分", "pts")}` : t("滑动打分", "Slide to rate");
      }
    };

    renderPopupStars(currentRating);

    if (starTrack) {
      starTrack.addEventListener("mousemove", (e) => {
        const star = e.target.closest(".star-item");
        if (!star) return;
        const rect = star.getBoundingClientRect();
        const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);
        const starIdx = parseInt(star.getAttribute("data-idx"), 10);
        const hoverVal = isLeftHalf ? (starIdx + 0.5) : (starIdx + 1.0);
        renderPopupStars(hoverVal);
      });

      starTrack.addEventListener("click", (e) => {
        const star = e.target.closest(".star-item");
        if (!star) return;
        const rect = star.getBoundingClientRect();
        const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);
        const starIdx = parseInt(star.getAttribute("data-idx"), 10);
        currentRating = isLeftHalf ? (starIdx + 0.5) : (starIdx + 1.0);
        renderPopupStars(currentRating);
      });

      starTrack.addEventListener("mouseleave", () => {
        renderPopupStars(currentRating);
      });
    }

    // Save button interaction
    const saveBtn = playingContainer.querySelector("#popupSaveBtn");
    const reviewInput = playingContainer.querySelector("#popupReviewInput");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const comment = reviewInput ? reviewInput.value.trim() : "";
        saveBtn.textContent = t("正在同步...", "Syncing...");
        chrome.runtime.sendMessage(
          {
            action: "LOG_ACTIVITY",
            payload: {
              movieId: movie.id,
              status: "WATCHED",
              rating: currentRating > 0 ? Math.round(currentRating * 2) : null,
              reviewText: comment,
              isRewatch
            }
          },
          (res) => {
            saveBtn.textContent = t("已成功记录！✓", "Saved successfully! ✓");
            if (currentActiveTabId) {
              chrome.tabs.sendMessage(currentActiveTabId, { action: "MARK_SCROBBLED" }, () => {});
            }
            setTimeout(() => {
              saveBtn.textContent = t("更新评分与短评", "Update rating and review");
            }, 1500);
          }
        );
      });
    }
  }

  // 6. Douban Sync Tab Logic
  const doubanPermissionGate = document.getElementById("doubanPermissionGate");
  const doubanFeatureContent = document.getElementById("doubanFeatureContent");
  const enableDoubanBtn = document.getElementById("enableDoubanBtn");
  const doubanPermissionStatus = document.getElementById("doubanPermissionStatus");
  const doubanPermissionStatusText = document.getElementById("doubanPermissionStatusText");
  const doubanToggleCheckbox = document.getElementById("doubanToggleCheckbox");
  const doubanRevokeSection = document.getElementById("doubanRevokeSection");
  const revokeDoubanPermissionsBtn = document.getElementById("revokeDoubanPermissionsBtn");
  const doubanAccountInfo = document.getElementById("doubanAccountInfo");
  const doubanSyncHistory = document.getElementById("doubanSyncHistory");
  const startDoubanSyncBtn = document.getElementById("startDoubanSyncBtn");
  const doubanSyncLog = document.getElementById("doubanSyncLog");
  const cloudSyncConsent = document.getElementById("cloudSyncConsent");
  const openUnmatchedBtn = document.getElementById("openUnmatchedBtn");
  const downloadDoubanCsvBtn = document.getElementById("downloadDoubanCsvBtn");
  const openImportCenterBtn = document.getElementById("openImportCenterBtn");

  let currentDoubanUser = null;
  let syncPollTimer = null;
  let latestCsvData = null;

  const doubanResetAnchorBtn = document.getElementById("doubanResetAnchorBtn");
  const doubanSyncHistoryText = document.getElementById("doubanSyncHistoryText");

  const doubanPermissionOrigins = [
    "https://*.douban.com/*",
    "https://*.doubanio.com/*"
  ];
  const doubanSessionOriginPatterns = [
    "https://*.douban.com/*",
    "https://douban.com/*"
  ];

  async function hasDoubanPermissions() {
    try {
      if (!chrome.permissions) return false;
      if (chrome.permissions.getAll) {
        const granted = await chrome.permissions.getAll();
        const hasCookiePermission = (granted.permissions || []).includes("cookies");
        const hasDoubanOrigin = (granted.origins || []).some((origin) =>
          origin === "<all_urls>" || doubanSessionOriginPatterns.includes(origin)
        );
        return hasCookiePermission && hasDoubanOrigin;
      }
      return await chrome.permissions.contains({
        permissions: ["cookies"],
        origins: ["https://*.douban.com/*"]
      });
    } catch (e) {
      return false;
    }
  }

  async function renderDoubanPermissionState() {
    const hasPerm = await hasDoubanPermissions();
    const { doubanConnectorEnabled = true } = await chrome.storage.local.get(["doubanConnectorEnabled"]);
    const isActive = Boolean(hasPerm && doubanConnectorEnabled);

    if (doubanPermissionGate) doubanPermissionGate.style.display = "block";
    if (doubanFeatureContent) doubanFeatureContent.style.display = isActive ? "block" : "none";

    if (doubanToggleCheckbox) {
      doubanToggleCheckbox.checked = isActive;
      doubanToggleCheckbox.disabled = false;
    }

    if (doubanPermissionStatus) {
      doubanPermissionStatus.classList.toggle("enabled", isActive);
      doubanPermissionStatus.classList.toggle("disabled", !isActive);
    }

    if (doubanRevokeSection) {
      doubanRevokeSection.style.display = hasPerm ? "block" : "none";
    }

    if (doubanPermissionStatusText) {
      if (!hasPerm) {
        doubanPermissionStatusText.textContent = t("豆瓣访问未授权", "Douban access not authorized");
      } else if (!doubanConnectorEnabled) {
        doubanPermissionStatusText.textContent = t("⏸ 已暂时停用（权限仍保留）", "⏸ Paused (permissions kept)");
      } else {
        doubanPermissionStatusText.textContent = t("● 豆瓣连接器运行中", "● Douban connector active");
      }
    }

    if (enableDoubanBtn) {
      if (!hasPerm) {
        enableDoubanBtn.style.display = "inline-block";
        enableDoubanBtn.disabled = false;
        enableDoubanBtn.textContent = t("启用授权", "Grant access");
      } else {
        enableDoubanBtn.style.display = "none";
      }
    }

    if (isActive) {
      loadDoubanSession();
      chrome.runtime.sendMessage({ action: "DOUBAN_GET_SYNC_STATUS" }, (res) => {
        if (res && res.status && res.status.status !== "idle") updateSyncUI(res.status);
      });
    } else {
      if (doubanAccountInfo) {
        doubanAccountInfo.innerHTML = `<div style="font-size: 12px; color: #8e9eb5;">${t("连接器已停用。", "Connector is paused.")}</div>`;
      }
    }
  }

  if (doubanToggleCheckbox) {
    doubanToggleCheckbox.addEventListener("change", async (e) => {
      const willEnable = e.target.checked;
      const hasPerm = await hasDoubanPermissions();

      if (willEnable) {
        if (!hasPerm) {
          doubanToggleCheckbox.checked = false;
          if (enableDoubanBtn) enableDoubanBtn.click();
          return;
        }
        await chrome.storage.local.set({ doubanConnectorEnabled: true });
        await renderDoubanPermissionState();
      } else {
        await chrome.storage.local.set({ doubanConnectorEnabled: false });
        await renderDoubanPermissionState();
      }
    });
  }

  if (revokeDoubanPermissionsBtn) {
    revokeDoubanPermissionsBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await chrome.permissions.remove({
          permissions: ["cookies"],
          origins: doubanPermissionOrigins
        });
      } catch (err) {}
      await chrome.storage.local.set({ doubanConnectorEnabled: false });
      await renderDoubanPermissionState();
    });
  }

  if (enableDoubanBtn) {
    enableDoubanBtn.addEventListener("click", async () => {
      enableDoubanBtn.disabled = true;
      enableDoubanBtn.textContent = t("正在请求权限…", "Requesting access…");
      let granted = false;
      try {
        granted = await chrome.permissions.request({
          permissions: ["cookies"],
          origins: doubanPermissionOrigins
        });
      } catch (e) {
        granted = false;
      }

      if (granted) {
        await chrome.storage.local.set({ doubanConnectorEnabled: true });
        await renderDoubanPermissionState();
      } else {
        enableDoubanBtn.disabled = false;
        enableDoubanBtn.textContent = t("启用授权", "Grant access");
      }
    });
  }

  async function renderDoubanSyncHistory() {
    if (!doubanSyncHistoryText) return;
    const { doubanLastSyncTime } = await chrome.storage.local.get(["doubanLastSyncTime"]);
    let localCount = 0;
    if (currentDoubanUser && currentDoubanUser.uid) {
      const key = `douban_db_${currentDoubanUser.uid}`;
      const stored = await chrome.storage.local.get([key]);
      localCount = stored[key]?.items?.length || 0;
    }
    if (!doubanLastSyncTime) {
      doubanSyncHistoryText.innerHTML = localCount > 0
        ? `${t("本地库", "Local library")}: <span style="color:#60a5fa;font-weight:600;">${localCount}</span> ${t("部 · 上次：暂无记录", "films · Last sync: none yet")}`
        : t("上次同步：暂无记录", "Last sync: none yet");
      return;
    }
    const d = new Date(doubanLastSyncTime.includes("T") ? doubanLastSyncTime : (doubanLastSyncTime.replace(" ", "T") + "+08:00"));
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    doubanSyncHistoryText.innerHTML = `${t("本地库", "Local library")}: <span style="color:#60a5fa;font-weight:600;">${localCount}</span> ${t("部 · 上次", "films · Last sync")}: ${dateStr}`;
  }
  renderDoubanSyncHistory();

  if (doubanResetAnchorBtn) {
    doubanResetAnchorBtn.addEventListener("click", () => {
      if (!currentDoubanUser || !currentDoubanUser.uid) return;
      if (!confirm(t("确定要清空本地豆瓣影视库并重新完整同步吗？", "Clear the local Douban library and perform a full sync again?"))) return;
      chrome.runtime.sendMessage({ action: "DOUBAN_RESET_LOCAL_DB", payload: { uid: currentDoubanUser.uid } }, () => {
        latestCsvData = null;
        renderDoubanSyncHistory();
        if (doubanSyncLog) doubanSyncLog.textContent = t("已重置本地库！点击上方按钮将从头建立完整本地库。", "Local library reset. Click the button above to build it again from the beginning.");
        if (downloadDoubanCsvBtn) downloadDoubanCsvBtn.style.display = "none";
      });
    });
  }

  function updateDoubanStatsSummary(stats) {
    const summary = doubanAccountInfo?.querySelector("#doubanStatsSummary");
    if (!summary) return;
    const values = [
      [t("看过", "Watched"), stats?.watchedCount || 0],
      [t("想看", "Watchlist"), stats?.wishCount || 0],
      [t("影评", "Reviews"), stats?.reviewCount || 0],
      [t("Top10", "Top10"), stats?.top10Count || 0]
    ];
    summary.innerHTML = values.map(([label, value]) =>
      `<span class="douban-stat"><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`
    ).join("");
  }

  function loadDoubanSession() {
    chrome.runtime.sendMessage({ action: "DOUBAN_CHECK_SESSION" }, (res) => {
      if (!res || !res.loggedIn) {
        currentDoubanUser = null;
        const runtimeError = chrome.runtime.lastError;
        const reason = res?.reason || (runtimeError ? "CHECK_FAILED" : "NO_DOUBAN_SESSION");
        const sessionMessage = reason === "SESSION_LOOKUP_FAILED"
          ? t("检测到豆瓣会话，但暂时无法确认当前用户。先打开豆瓣页面并刷新，再点重新检查。", "A Douban session was found, but the current user could not be confirmed. Open and refresh Douban, then check again.")
          : reason === "CHECK_FAILED"
            ? t("豆瓣会话检查失败，请稍后重新检查。", "Douban session check failed. Please try again.")
            : t("当前浏览器配置中没有可用的豆瓣登录状态。请在同一浏览器配置打开豆瓣并刷新。", "No usable Douban sign-in state was found in this browser profile. Open and refresh Douban in the same profile.");
        if (doubanAccountInfo) {
          doubanAccountInfo.innerHTML = `
            <div style="font-size: 12px; color: #8e9eb5; margin-bottom: 6px;">${sessionMessage}</div>
            <a href="https://m.douban.com/mine/" target="_blank" class="toggle-platforms" style="color: #60a5fa;">${t("一键前往豆瓣网页端登录 ↗", "Open Douban to sign in ↗")}</a>
            <a href="#" id="retryDoubanSessionBtn" class="toggle-platforms" style="display: inline-block; margin-top: 6px; color: #60a5fa;">${t("重新检查", "Check again")}</a>
          `;
          doubanAccountInfo.querySelector("#retryDoubanSessionBtn")?.addEventListener("click", (event) => {
            event.preventDefault();
            loadDoubanSession();
          });
        }
        if (startDoubanSyncBtn) {
          startDoubanSyncBtn.disabled = true;
          startDoubanSyncBtn.style.opacity = "0.5";
        }
        return;
      }

      currentDoubanUser = res;
      const userHomeUrl = `https://www.douban.com/people/${encodeURIComponent(res.uid)}/`;
      const safeDoubanName = escapeHtml(res.name || "");
      const safeDoubanUid = escapeHtml(res.uid || "");
      const safeUserHomeUrl = escapeHtml(userHomeUrl);
      let doubanAvatar = safeHttpUrl(res.avatar);
      if (doubanAvatar.startsWith("http:")) {
        doubanAvatar = doubanAvatar.replace(/^http:/, "https:");
      }
      const safeDoubanAvatar = escapeHtml(doubanAvatar);
      const avatarHtml = doubanAvatar
        ? `<img class="douban-avatar" referrerpolicy="no-referrer" src="${safeDoubanAvatar}" alt="${safeDoubanName}" /><div class="douban-avatar" style="display:none;align-items:center;justify-content:center;color:#60a5fa;font-size:14px;background:rgba(59,130,246,0.2);">DB</div>`
        : `<div class="douban-avatar" style="display:flex;align-items:center;justify-content:center;color:#60a5fa;font-size:14px;background:rgba(59,130,246,0.2);">DB</div>`;

      if (doubanAccountInfo) {
        doubanAccountInfo.innerHTML = `
          <div class="douban-user-box">
            <a href="${safeUserHomeUrl}" target="_blank" rel="noopener noreferrer" title="${t("前往豆瓣主页", "Open Douban profile")}">${avatarHtml}</a>
            <div style="flex: 1; overflow: hidden;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                <a href="${safeUserHomeUrl}" target="_blank" rel="noopener noreferrer" class="douban-name douban-link" title="${t("前往豆瓣主页", "Open Douban profile")}">${safeDoubanName}</a>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                <span class="douban-id">${t("豆瓣 ID", "Douban ID")}: <a href="${safeUserHomeUrl}" target="_blank" rel="noopener noreferrer" class="douban-link" title="${t("前往豆瓣主页", "Open Douban profile")}">${safeDoubanUid} ↗</a></span>
                <span style="font-size: 10px; color: #34d399; font-weight: 600;">${t("会话有效 ✓", "Session active ✓")}</span>
              </div>
            </div>
          </div>
          <div id="doubanStatsSummary" class="douban-stats-grid" aria-label="${t("豆瓣数据概览", "Douban data summary")}"></div>
        `;
        bindImageFallbacks(doubanAccountInfo);
        updateDoubanStatsSummary(res);
      }
      if (startDoubanSyncBtn) {
        startDoubanSyncBtn.disabled = false;
        startDoubanSyncBtn.style.opacity = "1";
      }
      renderDoubanSyncHistory();
    });
  }
  function updateSyncUI(status) {
    if (!status) return;
    if (status.status === "syncing") {
      if (startDoubanSyncBtn) {
        startDoubanSyncBtn.disabled = true;
        startDoubanSyncBtn.textContent = t("正在抓取与比对中...", "Fetching and comparing...");
      }
      if (doubanSyncLog) doubanSyncLog.textContent = status.message || t("抓取处理中...", "Fetching...");
      if (openUnmatchedBtn) openUnmatchedBtn.style.display = "none";
      if (!syncPollTimer) {
        syncPollTimer = setInterval(pollDoubanSync, 500);
      }
    } else if (status.status === "success") {
      if (syncPollTimer) clearInterval(syncPollTimer);
      syncPollTimer = null;
      if (startDoubanSyncBtn) {
        startDoubanSyncBtn.disabled = false;
        startDoubanSyncBtn.textContent = t("🔄 再次同步最新数据", "🔄 Sync latest data again");
      }
      if (doubanSyncLog) doubanSyncLog.textContent = status.message || t("同步完成。", "Sync complete.");
      if (status.unmatchedCount > 0 && openUnmatchedBtn) {
        openUnmatchedBtn.textContent = t(`👉 前往影格处理 ${status.unmatchedCount} 部待确认条目 ↗`, `👉 Review ${status.unmatchedCount} unmatched films in CinePersona ↗`);
        openUnmatchedBtn.style.display = "block";
      } else if (openUnmatchedBtn) {
        openUnmatchedBtn.style.display = "none";
      }
      if (status.csvData) {
        latestCsvData = status.csvData;
        if (downloadDoubanCsvBtn) {
          downloadDoubanCsvBtn.style.display = "block";
          downloadDoubanCsvBtn.textContent = t(`📥 导出本地完整 CSV 备份 (${status.totalCount || status.itemCount} 条)`, `📥 Export full local CSV backup (${status.totalCount || status.itemCount} films)`);
        }
        if (openImportCenterBtn) openImportCenterBtn.style.display = "block";
      }
      if (currentDoubanUser) {
        currentDoubanUser.watchedCount = status.watchedCount || 0;
        currentDoubanUser.wishCount = status.wishCount || 0;
        currentDoubanUser.reviewCount = status.reviewCount || 0;
        currentDoubanUser.top10Count = status.top10Count || 0;
        updateDoubanStatsSummary(currentDoubanUser);
      }
      renderDoubanSyncHistory();
    } else if (status.status === "error") {
      if (syncPollTimer) clearInterval(syncPollTimer);
      syncPollTimer = null;
      if (startDoubanSyncBtn) {
        startDoubanSyncBtn.disabled = false;
        startDoubanSyncBtn.textContent = t("🔄 重试同步", "🔄 Retry sync");
      }
      if (doubanSyncLog) doubanSyncLog.textContent = `❌ ${t("同步中断", "Sync interrupted")}: ${status.message || t("未知错误", "Unknown error")}`;
      if (openUnmatchedBtn) openUnmatchedBtn.style.display = "none";
    }
  }

  // Load existing CSV from storage if available
  chrome.storage.local.get("latestDoubanCsv", ({ latestDoubanCsv }) => {
    if (latestDoubanCsv) {
      latestCsvData = latestDoubanCsv;
      if (downloadDoubanCsvBtn) {
        downloadDoubanCsvBtn.style.display = "block";
        downloadDoubanCsvBtn.textContent = t("📥 导出本地完整 CSV 备份", "📥 Export full local CSV backup");
      }
      if (openImportCenterBtn) openImportCenterBtn.style.display = "block";
    }
  });

  function pollDoubanSync() {
    chrome.runtime.sendMessage({ action: "DOUBAN_GET_SYNC_STATUS" }, (res) => {
      if (res && res.status) {
        updateSyncUI(res.status);
      }
    });
  }

  chrome.runtime.sendMessage({ action: "DOUBAN_GET_SYNC_STATUS" }, (res) => {
    if (res && res.status && res.status.status !== "idle") {
      updateSyncUI(res.status);
    }
  });

  if (startDoubanSyncBtn) {
    startDoubanSyncBtn.addEventListener("click", () => {
      if (!currentDoubanUser || !currentDoubanUser.uid) {
        loadDoubanSession();
        return;
      }
      const allowCloudSync = Boolean(cloudSyncConsent?.checked);
      if (allowCloudSync && !confirm(t("本次会把新增标记写入影格云端，继续吗？", "Write the new marks to CinePersona cloud for this sync?"))) {
        return;
      }
      if (cloudSyncConsent) cloudSyncConsent.checked = false;
      startDoubanSyncBtn.disabled = true;
      startDoubanSyncBtn.textContent = t("正在启动抓取...", "Starting fetch...");
      if (doubanSyncLog) {
        doubanSyncLog.textContent = allowCloudSync
          ? t("已确认云端写入授权，正在连接豆瓣比对影视标记...", "Cloud write confirmed. Connecting to Douban to compare film marks...")
          : t("仅更新本地库，正在连接豆瓣比对影视标记...", "Updating only the local library. Connecting to Douban to compare film marks...");
      }
      if (openUnmatchedBtn) openUnmatchedBtn.style.display = "none";

      chrome.runtime.sendMessage(
        {
          action: "DOUBAN_START_SYNC",
          payload: { uid: currentDoubanUser.uid, allowCloudSync }
        },
        (res) => {
          if (res && res.status) {
            updateSyncUI(res.status);
            if (!syncPollTimer) {
              syncPollTimer = setInterval(pollDoubanSync, 500);
            }
          }
        }
      );
    });
  }

  if (downloadDoubanCsvBtn) {
    downloadDoubanCsvBtn.addEventListener("click", () => {
      const triggerDownload = (csv) => {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Douban_Export_${currentDoubanUser?.uid || "backup"}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      };

      if (latestCsvData) {
        triggerDownload(latestCsvData);
      } else if (currentDoubanUser && currentDoubanUser.uid) {
        downloadDoubanCsvBtn.textContent = t("正在生成 CSV...", "Generating CSV...");
        chrome.runtime.sendMessage({ action: "DOUBAN_EXPORT_CSV", payload: { uid: currentDoubanUser.uid } }, (res) => {
          downloadDoubanCsvBtn.textContent = t("📥 导出本地完整 CSV 备份", "📥 Export full local CSV backup");
          if (res && res.csvData && res.count > 0) {
            latestCsvData = res.csvData;
            triggerDownload(res.csvData);
          } else {
            alert(t("本地暂无豆瓣记录，请先点击【同步最新豆瓣数据】", "No local Douban records yet. Click \"Sync latest Douban data\" first."));
          }
        });
      } else {
        alert(t("未检测到豆瓣会话，请先登录豆瓣。", "No Douban session found. Sign in to Douban first."));
      }
    });
  }

  // Initial call & live dynamic polling
  renderDoubanPermissionState();
  queryActiveTabPlaying();
  const pollInterval = setInterval(queryActiveTabPlaying, 1500);
  window.addEventListener("unload", () => {
    clearInterval(pollInterval);
    if (syncPollTimer) clearInterval(syncPollTimer);
  });
});
