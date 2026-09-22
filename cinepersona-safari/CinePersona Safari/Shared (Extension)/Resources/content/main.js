/**
 * CinePersona Content Script Main Entry
 * Coordinates platform detection, cleaner, search matching, and UI notification.
 */

(async function () {
  // Find current parser
  const parser = (window.CineParsers || []).find((p) => p.matches());
  if (!parser) return;

  // Ignore useless hidden non-top iframes that have neither video nor title
  const hasVideo = Boolean(parser.getVideo() || document.querySelector("video"));
  const hasTitle = Boolean(parser.getTitle());
  if (window !== window.top && !hasVideo && !hasTitle) {
    return;
  }

  console.log(`[CinePersona] 影格已接入当前平台: ${parser.name} (frame: ${window === window.top ? "top" : "iframe"})`);

  let currentTitle = "";
  let lastFailedTitle = "";
  let lastFailedTime = 0;
  let matchedMovie = null;
  let currentActivity = null;
  let isAuthenticated = false;
  let isResolving = false;
  let isManuallyOverridden = false;
  let hasShownToastForMovieId = null;
  let boundVideo = null;
  let boundVideoSrc = "";
  let pollTimer = null;
  let scrobbler = new window.CineScrobbler();
  let ignoredReason = null; // "TV_SERIES" | "SHORT_CLIP" | "MANUAL_SKIP" | null

  let cachedSettings = { scrobbleEnabled: true, disabledPlatforms: [] };
  let scrobbleSilent = false;

  function applyTimingPreference(value) {
    const normalized = String(value || "0.80");
    scrobbleSilent = normalized === "manual";
    const threshold = Number.parseFloat(normalized);
    scrobbler.threshold = Number.isFinite(threshold) && threshold > 0 && threshold <= 1
      ? threshold
      : 0.8;
  }

  async function loadSettings() {
    try {
      const res = await chrome.storage.local.get(["scrobbleEnabled", "disabledPlatforms"]);
      if (typeof res.scrobbleEnabled === "boolean") cachedSettings.scrobbleEnabled = res.scrobbleEnabled;
      if (Array.isArray(res.disabledPlatforms)) cachedSettings.disabledPlatforms = res.disabledPlatforms;
      const syncSettings = await chrome.storage.sync.get("timingPreference");
      applyTimingPreference(syncSettings.timingPreference);
    } catch (e) {}
  }
  await loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.scrobbleEnabled) cachedSettings.scrobbleEnabled = changes.scrobbleEnabled.newValue !== false;
      if (changes.disabledPlatforms) cachedSettings.disabledPlatforms = changes.disabledPlatforms.newValue || [];
      if (!cachedSettings.scrobbleEnabled || cachedSettings.disabledPlatforms.includes(parser.name)) {
        if (scrobbler) scrobbler.detach();
        if (window.CineUI?.hide) window.CineUI.hide();
      }
    }
    if (area === "sync" && changes.timingPreference) {
      applyTimingPreference(changes.timingPreference.newValue);
    }
  });

  // If this frame has a video but no title (e.g. video inside an iframe), query parent/background for tab movie
  if (hasVideo && !hasTitle) {
    chrome.runtime.sendMessage({ action: "GET_TAB_MOVIE" }, (res) => {
      if (res && res.data && res.data.movie && !matchedMovie) {
        matchedMovie = res.data.movie;
        currentActivity = res.data.activity;
        const video = parser.getVideo() || document.querySelector("video");
        if (video) {
          scrobbler.attach(video, matchedMovie, onScrobbleTriggered);
        }
      }
    });
  }

  // 1. Respond to extension popup queries
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GET_CURRENT_PLAYING") {
      if (!cachedSettings.scrobbleEnabled) {
        sendResponse({
          success: false,
          reason: "SCROBBLE_PAUSED",
          platformName: parser.name
        });
        return true;
      }

      if (cachedSettings.disabledPlatforms.includes(parser.name)) {
        sendResponse({
          success: false,
          reason: "PLATFORM_DISABLED",
          platformName: parser.name
        });
        return true;
      }

      if (ignoredReason === "MANUAL_SKIP") {
        sendResponse({
          success: false,
          reason: "MANUAL_SKIP",
          platformName: parser.name,
          data: matchedMovie ? { movie: matchedMovie } : null
        });
        return true;
      }

      const video = parser.getVideo() || document.querySelector("video");

      // Check if current playback was classified as TV series / short clip
      if (ignoredReason) {
        sendResponse({
          success: false,
          reason: ignoredReason,
          platformName: parser.name
        });
        return true;
      }

      // Crucial: non-top iframes that have no matchedMovie should NOT respond,
      // preventing ad/preview iframes from hijacking GET_CURRENT_PLAYING.
      if (window !== window.top && !matchedMovie) {
        return false;
      }

      // If top frame has no video and no movie, do not respond
      if (!video && !matchedMovie) {
        return false;
      }

      if (video && scrobbler.activeVideo !== video && matchedMovie) {
        scrobbler.attach(video, matchedMovie, onScrobbleTriggered);
      }

      if (!matchedMovie) {
        checkAndBind();
        // If this is the main frame, reply waiting status
        if (window === window.top || video) {
          sendResponse({ success: false, reason: "WAITING_MATCH", hasVideo: Boolean(video) });
          return true;
        }
        return false;
      }

      const progressData = scrobbler.getCurrentProgress();
      sendResponse({
        success: true,
        data: {
          movie: matchedMovie,
          activity: currentActivity,
          progress: progressData.progress,
          currentTime: progressData.currentTime,
          duration: progressData.duration,
          hasScrobbled: scrobbler.hasScrobbled,
          platformName: parser.name
        }
      });
      return true;
    }

    if (message.action === "SKIP_CURRENT_PLAYING") {
      ignoredReason = "MANUAL_SKIP";
      if (scrobbler) scrobbler.detach();
      if (window.CineUI?.hide) window.CineUI.hide();
      console.log("[CinePersona] 本次播放已跳过打卡:", matchedMovie?.title);
      sendResponse({ success: true, movie: matchedMovie });
      return true;
    }

    if (message.action === "UNSKIP_CURRENT_PLAYING") {
      ignoredReason = null;
      if (boundVideo && matchedMovie) {
        scrobbler.attach(boundVideo, matchedMovie, onScrobbleTriggered);
      } else {
        checkAndBind();
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "MARK_SCROBBLED") {
      scrobbler.hasScrobbled = true;
      sendResponse({ success: true });
      return true;
    }

    if (message.action === "OVERRIDE_MOVIE") {
      if (message.payload && message.payload.movie) {
        matchedMovie = message.payload.movie;
        isManuallyOverridden = true;
        if (scrobbler) {
          scrobbler.matchedMovie = matchedMovie;
        }
        chrome.runtime.sendMessage({
          action: "SYNC_TAB_MOVIE",
          payload: { movie: matchedMovie, activity: currentActivity }
        });
        console.log("[CinePersona] 手动纠偏电影为:", matchedMovie.title);
      }
      sendResponse({ success: true });
      return true;
    }
  });

  function onScrobbleTriggered({ movie, progress, duration }) {
    // Safety check: for commercial streaming platforms, only auto-scrobble if the video
    // is a full feature-length stream (> 25 minutes).
    // Free 5-minute previews should never auto-scrobble a movie into user's watched library!
    const streamingPlatforms = ["腾讯视频", "爱奇艺", "优酷视频", "Bilibili"];
    if (streamingPlatforms.includes(parser.name) && duration && duration < 1500) {
      console.log(`[CinePersona] 视频时长仅 ${Math.round(duration / 60)} 分钟 (试看/短片模式)，已阻止自动打卡入库:`, movie.title);
      return;
    }

    console.log(`[CinePersona] 观影进度达标 (${Math.round(progress * 100)}%)，自动打卡记录...`);

    // 1. Send scrobble mark to background
    chrome.runtime.sendMessage({
      action: "LOG_ACTIVITY",
      payload: {
        movieId: movie.id,
        status: "WATCHED"
      }
    });

    if (scrobbleSilent) return;

    // 2. Show in-page toast notification
    window.CineUI.show({
      movie,
      activity: currentActivity,
      isAuthenticated,
      isAutoScrobbled: true,
      onSave: ({ rating, reviewText, isRewatch }) => {
        chrome.runtime.sendMessage({
          action: "LOG_ACTIVITY",
          payload: {
            movieId: movie.id,
            status: "WATCHED",
            rating,
            reviewText,
            isRewatch
          }
        });
      },
      onCorrect: () => {
        const term = prompt(globalThis.CinePersonaI18n?.t("输入正确的电影片名进行检索纠偏：", "Enter the correct film title to search:"), movie.title);
        if (term && term.trim()) {
          window.open(`https://cinepersona.com/search?q=${encodeURIComponent(term.trim())}`, "_blank");
        }
      }
    });
  }

  async function checkAndBind() {
    if (!chrome.runtime?.id) {
      if (pollTimer) clearInterval(pollTimer);
      return;
    }

    if (!cachedSettings.scrobbleEnabled || cachedSettings.disabledPlatforms.includes(parser.name)) {
      if (scrobbler.activeVideo) scrobbler.detach();
      return;
    }

    if (ignoredReason === "MANUAL_SKIP") {
      return;
    }

    // 1. Check if platform parser indicates this is a drama/variety/episode page
    if (typeof parser.isMoviePlayback === "function" && !parser.isMoviePlayback()) {
      if (ignoredReason !== "TV_SERIES") {
        console.log(`[CinePersona] 平台 ${parser.name} 判定当前处于剧集/综艺非电影页面，已跳过打卡`);
        ignoredReason = "TV_SERIES";
        matchedMovie = null;
        scrobbler.detach();
      }
      return;
    }

    const rawTitle = parser.getTitle();
    const video = parser.getVideo() || document.querySelector("video");
    const currentSrc = video ? (video.currentSrc || video.src || "active-video") : "";

    // A page title alone is not enough evidence of film playback. In particular,
    // cloud-drive home/file pages expose titles without an active player, which
    // previously caused unnecessary searches on the main site every few seconds.
    if (!video && !matchedMovie) {
      return;
    }

    // Read current video duration in minutes (if loaded)
    let durationMin = 0;
    if (video && video.duration && !isNaN(video.duration) && video.duration > 0) {
      durationMin = Math.round(video.duration / 60);
    }

    // Video Playback Hard-Lock:
    // If we have already successfully resolved a movie for the current video element,
    // and the video is still playing the same media source without switching,
    // STRICTLY PROHIBIT overwriting it from background file list DOMs!
    if (video && matchedMovie && boundVideo === video && boundVideoSrc === currentSrc) {
      if (scrobbler.activeVideo !== video) {
        scrobbler.attach(video, matchedMovie, onScrobbleTriggered);
      }
      return;
    }

    // If video source switched, unlock manual override to allow detecting the new movie
    if (boundVideo && boundVideoSrc && currentSrc !== boundVideoSrc) {
      isManuallyOverridden = false;
      boundVideo = null;
      boundVideoSrc = "";
      matchedMovie = null;
      currentTitle = "";
    }

    if (isManuallyOverridden) {
      // Keep user's manually corrected movie and ensure scrobbler is attached to current video
      if (video && scrobbler.activeVideo !== video && matchedMovie) {
        scrobbler.attach(video, matchedMovie, onScrobbleTriggered);
      }
      return;
    }

    if (!rawTitle) {
      // For video iframe that has no title in its own frame, fetch tab movie from background/top frame
      if (video && !matchedMovie) {
        chrome.runtime.sendMessage({ action: "GET_TAB_MOVIE" }, (res) => {
          if (res && res.data && res.data.movie && !matchedMovie) {
            matchedMovie = res.data.movie;
            currentActivity = res.data.activity;
            boundVideo = video;
            boundVideoSrc = video.currentSrc || video.src || "active-video";
            scrobbler.attach(video, matchedMovie, onScrobbleTriggered);
          }
        });
      }
      return;
    }

    // In SPA like Alipan / Quark / Baidu, video element can be mounted after title or changed
    if (video && scrobbler.activeVideo !== video && matchedMovie) {
      scrobbler.attach(video, matchedMovie, onScrobbleTriggered);
    }

    if (rawTitle === currentTitle && matchedMovie) {
      return;
    }

    if (rawTitle === lastFailedTitle && Date.now() - lastFailedTime < 10000) {
      return;
    }

    if (isResolving) return;

    currentTitle = rawTitle;
    const cleanResult = window.CineCleaner.clean(rawTitle);

    // 3. Cleaner checks: is this a drama episode or non-movie?
    if (cleanResult.isTV) {
      if (ignoredReason !== "TV_SERIES") {
        console.log(`[CinePersona] 标题特征命中剧集/非电影 (${cleanResult.isTV})，自动跳过:`, rawTitle);
        ignoredReason = "TV_SERIES";
        matchedMovie = null;
        scrobbler.detach();
      }
      return;
    }

    // 4. Reject obvious UGC/commentary/vlog titles
    if (cleanResult.isCommentary) {
      if (ignoredReason !== "TV_SERIES") {
        console.log(`[CinePersona] 标题特征命中解说/博文/UGC，自动跳过:`, rawTitle);
        ignoredReason = "TV_SERIES";
        matchedMovie = null;
        scrobbler.detach();
      }
      return;
    }

    // 5. Cleaned title must be at least 2 characters to avoid single-word false matches like "智人"
    if (!cleanResult.title || cleanResult.title.length < 2) return;

    // 6. Duration pre-filter: for UGC-heavy platforms (Bilibili /video/ path reached this far),
    // demand the video is at least 40 minutes before even attempting a server match.
    // This prevents short tech/finance opinion videos from triggering API calls.
    const STREAMING_PLATFORMS_NEEDING_DURATION = ["哔哩哔哩", "腾讯视频", "爱奇艺", "优酷"];
    const MIN_DURATION_FOR_MATCH = 40; // minutes
    if (STREAMING_PLATFORMS_NEEDING_DURATION.includes(parser.name)) {
      if (durationMin > 0 && durationMin < MIN_DURATION_FOR_MATCH) {
        if (ignoredReason !== "TV_SERIES") {
          console.log(`[CinePersona] 视频时长 ${durationMin} 分钟 < ${MIN_DURATION_FOR_MATCH} 分钟阈值，跳过匹配:`, rawTitle);
          ignoredReason = "TV_SERIES";
          matchedMovie = null;
          scrobbler.detach();
        }
        return;
      }
      // If duration not yet loaded, wait for it to load before resolving
      if (durationMin === 0) {
        console.log(`[CinePersona] 等待视频时长加载后再匹配:`, cleanResult.title);
        return;
      }
    }

    ignoredReason = null;
    console.log("[CinePersona] 识别片名:", cleanResult.title, "时长:", durationMin ? `${durationMin}分` : "待加载", "原始文本:", rawTitle);

    isResolving = true;
    // Request match from background service worker
    try {
      chrome.runtime.sendMessage(
        {
          action: "SEARCH_AND_RESOLVE",
          payload: {
            query: cleanResult.title,
            year: cleanResult.year,
            rawTitle,
            videoDuration: durationMin
          }
        },
        (response) => {
          isResolving = false;
          if (!chrome.runtime?.id) return;
          if (!response || !response.success || !response.movie) {
            lastFailedTitle = rawTitle;
            lastFailedTime = Date.now();
            console.log("[CinePersona] 未在影格影视库中检索到对应条目 (已记录):", cleanResult.title);
            return;
          }

          matchedMovie = response.movie;
          currentActivity = response.activity;
          isAuthenticated = response.isAuthenticated;

          console.log("[CinePersona] 成功匹配电影:", matchedMovie.title, "登录状态:", isAuthenticated);

          // Broadcast to tab via background so video iframes can pick it up
          chrome.runtime.sendMessage({
            action: "SYNC_TAB_MOVIE",
            payload: { movie: matchedMovie, activity: currentActivity }
          });

          // Show immediate in-page recognition toast so user has instant feedback at the start of playback!
          if (hasShownToastForMovieId !== matchedMovie.id && window === window.top) {
            hasShownToastForMovieId = matchedMovie.id;
            window.CineUI.show({
              movie: matchedMovie,
              activity: currentActivity,
              isAuthenticated,
              isAutoScrobbled: false,
              onSave: ({ rating, reviewText, isRewatch }) => {
                chrome.runtime.sendMessage({
                  action: "LOG_ACTIVITY",
                  payload: {
                    movieId: matchedMovie.id,
                    status: "WATCHED",
                    rating,
                    reviewText,
                    isRewatch
                  }
                });
                scrobbler.hasScrobbled = true;
              },
              onCorrect: () => {
                const term = prompt(globalThis.CinePersonaI18n?.t("输入正确的电影片名进行检索纠偏：", "Enter the correct film title to search:"), matchedMovie.title);
                if (term && term.trim()) {
                  window.open(`https://cinepersona.com/search?q=${encodeURIComponent(term.trim())}`, "_blank");
                }
              }
            });
          }

          // Attach scrobbler to video element and record lock
          const activeVideo = parser.getVideo() || document.querySelector("video");
          if (activeVideo) {
            boundVideo = activeVideo;
            boundVideoSrc = activeVideo.currentSrc || activeVideo.src || "active-video";
            scrobbler.attach(activeVideo, matchedMovie, onScrobbleTriggered);
          }
        }
      );
    } catch (e) {
      isResolving = false;
    }
  }

  // Periodic check for SPAs (Single Page Applications like Bilibili / AliyunDrive / Quark / Baidu / 115)
  pollTimer = setInterval(checkAndBind, 2000);
  setTimeout(checkAndBind, 500);
})();
