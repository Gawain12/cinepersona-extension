document.addEventListener("DOMContentLoaded", async () => {
  const i18n = globalThis.CinePersonaI18n || {};
  const t = (zh, en) => typeof i18n.t === "function" ? i18n.t(zh, en) : zh;
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

  let currentAuthState = null;
  let currentRenderedMovieId = null;

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

  // 3. Toggle Platforms
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
        if (next && (next.classList.contains("user-avatar-placeholder") || next.classList.contains("douban-avatar") || next.classList.contains("poster-fallback"))) {
          next.style.display = "flex";
        }
      };

      if (!img.getAttribute("src")) {
        applyFallback();
        return;
      }

      if (img.complete && img.naturalWidth > 0) {
        img.style.display = "";
        if (next && (next.classList.contains("user-avatar-placeholder") || next.classList.contains("douban-avatar") || next.classList.contains("poster-fallback"))) {
          next.style.display = "none";
        }
      }

      img.addEventListener("error", applyFallback);
      img.addEventListener("load", () => {
        if (img.naturalWidth > 0) {
          img.style.display = "";
          if (next && (next.classList.contains("user-avatar-placeholder") || next.classList.contains("douban-avatar") || next.classList.contains("poster-fallback"))) {
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
      const avatarHtml = avatar
        ? `<img class="user-avatar-img" referrerpolicy="no-referrer" src="${avatar}" alt="${name}" /><div class="user-avatar-placeholder" style="display:none;">${name.charAt(0).toUpperCase()}</div>`
        : `<div class="user-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;

      userInfo.innerHTML = `
        <div class="user-profile-row">
          <a href="https://cinepersona.com/library" target="_blank" title="${t("点击进入我的影格片库", "Open my CinePersona library")}">${avatarHtml}</a>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <a href="https://cinepersona.com/library" target="_blank" class="user-name-link" title="${t("点击前往我的影格片库", "Go to my CinePersona library")}">
                <span>${name}</span>
                <span style="font-size: 11px; opacity: 0.7;">↗</span>
              </a>
              ${stats ? `<a href="https://cinepersona.com/library" target="_blank" class="user-stat-badge" title="${t("查看已看与想看片库", "View watched and watchlist")}">🎬 ${stats.watchedCount || 0} · 📌 ${stats.watchlistCount || 0}</a>` : ""}
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
    playingContainer.innerHTML = `
      <div class="card empty-playing">
        <div class="empty-icon loading-pulse">🎬</div>
        <div style="font-weight: 600; color: #f1f5f9; margin-top: 6px;">${text}</div>
        <div style="font-size: 11px; color: #8e9eb5; margin-top: 4px;">${t("已接入播放器，正在比对影视元数据与外部评分...", "Player connected. Comparing film metadata and external ratings...")}</div>
      </div>
    `;
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

  function renderNonMovieSkipped(htmlMsg) {
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
    playingContainer.innerHTML = `
      <div class="card empty-playing">
        <div class="empty-icon">🎬</div>
        <div>${msg}</div>
      </div>
    `;
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

    const posterHtml = movie.posterURL
      ? `<img class="poster-img" src="${movie.posterURL}" alt="${movie.title}" /><div class="poster-fallback" style="display:none;">${posterFallbackSvg}</div>`
      : `<div class="poster-fallback">${posterFallbackSvg}</div>`;

    let ratingsHtml = "";
    if (movie.ratings && movie.ratings.length > 0) {
      ratingsHtml = `
        <div class="movie-ratings-row">
          ${movie.ratings.map((r) => {
            let cls = "cp";
            let label = r.source;
            if (r.source === "豆瓣") { cls = "douban"; label = "DB"; }
            else if (r.source === "IMDb") { cls = "imdb"; label = "IMDb"; }
            else if (r.source.toLowerCase().includes("letterboxd")) { cls = "lboxd"; label = "LB"; }
            else if (r.source === "影格") { cls = "cp"; label = "CP"; }
            return `<span class="rating-badge ${cls}">${label} ${r.score}</span>`;
          }).join("")}
        </div>
      `;
    }

    playingContainer.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>${data.platformName || t("当前页面", "Current page")}</span>
          <span class="movie-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="movie-box">
          <div class="poster-wrap clickable" id="moviePosterWrap" title="${t("点击在影格查看电影详情 ↗", "Open film details in CinePersona ↗")}">${posterHtml}</div>
          <div class="movie-info">
            <div class="movie-title clickable" id="movieTitleWrap" title="${t("点击在影格查看电影详情 ↗", "Open film details in CinePersona ↗")}">${movie.title}</div>
            <div class="movie-meta">${movie.year ? movie.year : t("电影", "Film")} · ${isRewatch ? t("曾看过的佳作", "Previously watched") : t("初次观影", "First watch")}</div>
            ${ratingsHtml}
            <span class="correct-link" id="toggleCorrectBtn">${t("识别有误？点击纠偏 ✎", "Wrong match? Correct it ✎")}</span>
          </div>
        </div>

        <!-- Correction Box -->
        <div class="correct-box" id="correctBox">
          <div class="correct-input-row">
            <input type="text" class="correct-input" id="correctSearchInput" placeholder="${t("输入正确片名搜索...", "Search the correct film title...")}" value="${movie.title || ''}" />
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
        <textarea class="review-textarea" id="popupReviewInput" placeholder="${t("写句简短观后感同步到影格主页...", "Write a short review to sync to your CinePersona profile...")}">${reviewText}</textarea>

        <!-- Action Button -->
        <button class="btn btn-primary" id="popupSaveBtn">
          ${hasScrobbled ? t("更新评分与短评", "Update rating and review") : (isRewatch ? t("立即记录重温", "Record this rewatch") : t("标记为已看", "Mark as watched"))}
        </button>
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
              <img class="correct-item-thumb" src="${h.posterURL || ''}" />
              <div class="correct-item-info">
                <div class="correct-item-title">${h.title}</div>
                <div class="correct-item-sub">${h.year ? h.year + ' · ' : ''}${h.director || t("电影", "Film")}</div>
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

  function loadDoubanSession() {
    chrome.runtime.sendMessage({ action: "DOUBAN_CHECK_SESSION" }, (res) => {
      if (!res || !res.loggedIn) {
        if (doubanAccountInfo) {
          doubanAccountInfo.innerHTML = `
            <div style="font-size: 12px; color: #8e9eb5; margin-bottom: 6px;">${t("未检测到浏览器中的豆瓣登录 Cookie。", "No Douban sign-in cookie was found in this browser.")}</div>
            <a href="https://m.douban.com/mine/" target="_blank" class="toggle-platforms" style="color: #60a5fa;">${t("一键前往豆瓣网页端登录 ↗", "Open Douban to sign in ↗")}</a>
          `;
        }
        if (startDoubanSyncBtn) {
          startDoubanSyncBtn.disabled = true;
          startDoubanSyncBtn.style.opacity = "0.5";
        }
        return;
      }

      currentDoubanUser = res;
      const userHomeUrl = `https://www.douban.com/people/${encodeURIComponent(res.uid)}/`;
      let doubanAvatar = res.avatar || "";
      if (doubanAvatar.startsWith("http:")) {
        doubanAvatar = doubanAvatar.replace(/^http:/, "https:");
      }
      const avatarHtml = doubanAvatar
        ? `<img class="douban-avatar" referrerpolicy="no-referrer" src="${doubanAvatar}" alt="${res.name}" /><div class="douban-avatar" style="display:none;align-items:center;justify-content:center;color:#60a5fa;font-size:14px;background:rgba(59,130,246,0.2);">DB</div>`
        : `<div class="douban-avatar" style="display:flex;align-items:center;justify-content:center;color:#60a5fa;font-size:14px;background:rgba(59,130,246,0.2);">DB</div>`;

      const statsBadge = `<span class="douban-stat-badge" title="${t("豆瓣标记统计", "Douban mark statistics")}">🎬 ${res.watchedCount || 0} ${t("看过", "watched")} · 📌 ${res.wishCount || 0} ${t("想看", "to watch")}</span>`;

      if (doubanAccountInfo) {
        doubanAccountInfo.innerHTML = `
          <div class="douban-user-box">
            <a href="${userHomeUrl}" target="_blank" title="${t("前往豆瓣主页", "Open Douban profile")}">${avatarHtml}</a>
            <div style="flex: 1; overflow: hidden;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                <a href="${userHomeUrl}" target="_blank" class="douban-name douban-link" title="${t("前往豆瓣主页", "Open Douban profile")}">${res.name}</a>
                ${statsBadge}
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                <span class="douban-id">${t("豆瓣 ID", "Douban ID")}: <a href="${userHomeUrl}" target="_blank" class="douban-link" title="${t("前往豆瓣主页", "Open Douban profile")}">${res.uid} ↗</a></span>
                <span style="font-size: 10px; color: #34d399; font-weight: 600;">${t("会话有效 ✓", "Session active ✓")}</span>
              </div>
            </div>
          </div>
        `;
        bindImageFallbacks(doubanAccountInfo);
      }
      if (startDoubanSyncBtn) {
        startDoubanSyncBtn.disabled = false;
        startDoubanSyncBtn.style.opacity = "1";
      }
      renderDoubanSyncHistory();
    });
  }
  loadDoubanSession();

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
      if (doubanSyncLog) doubanSyncLog.innerHTML = `<span style="color: #34d399;">${status.message}</span>`;
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
      renderDoubanSyncHistory();
    } else if (status.status === "error") {
      if (syncPollTimer) clearInterval(syncPollTimer);
      syncPollTimer = null;
      if (startDoubanSyncBtn) {
        startDoubanSyncBtn.disabled = false;
        startDoubanSyncBtn.textContent = t("🔄 重试同步", "🔄 Retry sync");
      }
      if (doubanSyncLog) doubanSyncLog.innerHTML = `<span style="color: #ef4444;">❌ ${t("同步中断", "Sync interrupted")}: ${status.message}</span>`;
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
      if (allowCloudSync && !confirm(t("本次将把新增电影的片名、评分、短评和标记时间提交到你的影格片库。确认继续吗？", "This will send new film titles, ratings, reviews, and timestamps to your CinePersona library. Continue?"))) {
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
  queryActiveTabPlaying();
  const pollInterval = setInterval(queryActiveTabPlaying, 1500);
  window.addEventListener("unload", () => {
    clearInterval(pollInterval);
    if (syncPollTimer) clearInterval(syncPollTimer);
  });
});
