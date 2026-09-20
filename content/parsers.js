/**
 * Platform Parsers for Streaming Sites & Cloud Drives
 * Extracts raw title and finds active video element.
 */

const CineParsers = [
  // 1. Bilibili (B站 电影 / 电视剧 / 纪录片 / 视频)
  {
    id: "bilibili",
    name: "哔哩哔哩",
    matches: () => location.hostname.includes("bilibili.com"),
    getVideo: () => document.querySelector("video.bpx-player-video-wrap video, .bpx-player-container video, video"),
    isMoviePlayback: () => {
      if (location.pathname.includes("/bangumi/play/")) {
        const typeLabel = document.querySelector(".media-type, [class*='media-type']");
        if (typeLabel && !typeLabel.textContent.includes("电影")) {
          return false;
        }
      }
      if (/第\s*\d+\s*[集期话回]|番剧|国创|电视剧/.test(document.title)) {
        return false;
      }
      return true;
    },
    getTitle: () => {
      // For Bangumi / Movies
      const bangumiTitle = document.querySelector(".media-title, .ep-title, [class*='media-title'], [class*='ep-info-title']");
      if (bangumiTitle && bangumiTitle.textContent.trim()) {
        return bangumiTitle.textContent.trim();
      }
      // General video title
      const videoTitle = document.querySelector(".video-title, #viewbox_report h1, [class*='video-info-title']");
      if (videoTitle && videoTitle.textContent.trim()) {
        return videoTitle.textContent.trim();
      }
      return document.title.replace(/_哔哩哔哩_bilibili.*/i, "").trim();
    }
  },

  // 2. Tencent Video (腾讯视频)
  {
    id: "qq",
    name: "腾讯视频",
    matches: () => location.hostname.includes("qq.com"),
    getVideo: () => document.querySelector("video.txp_video, .txp_video_container video, #txp_container video, .player__container video, [class*='player_container'] video, video"),
    isMoviePlayback: () => {
      const docTitle = document.title || "";
      if (/(?:第\s*\d+\s*[集期话回]|\bE\d{1,3}\b|\bEP\d{1,3}\b|更新至\s*\d+\s*集|全\s*\d+\s*集)/i.test(docTitle)) {
        return false;
      }
      if (/^(?:电视剧|网络剧|连续剧|综艺)/.test(docTitle)) {
        return false;
      }
      return true;
    },
    getTitle: () => {
      // 1. Comprehensive selector check for modern Tencent Video SPA DOM
      const selectors = [
        "h1.player__title", "h1.video_title", "h1.title", "h1",
        ".txv_title", ".player__title", ".video__title", ".txp_video_title", ".player_title",
        "[class*='player__title']", "[class*='video-title']", "[class*='title__text']",
        "[data-role='video-title']", "[class*='video_info'] h1"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const pt = el.textContent.trim().replace(/《([^》]+)》/, "$1").trim();
          if (pt && !pt.includes("腾讯视频") && (!window.CineCleaner || !window.CineCleaner.isPlaceholder(pt))) {
            return pt;
          }
        }
      }

      // 2. Extract from document.title (handles 《等风来》 or 等风来_高清视频...)
      const docTitle = document.title || "";
      const bookMatch = docTitle.match(/《([^》]+)》/);
      if (bookMatch && bookMatch[1].trim()) {
        return bookMatch[1].trim();
      }

      // 3. Segment and filter out site taglines and brand names
      const parts = docTitle.split(/[-_—|]/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (
          !part.includes("腾讯视频") &&
          !part.includes("在线观看") &&
          !part.includes("中国领先") &&
          !part.includes("高清视频") &&
          !part.includes("正版") &&
          part !== "电影" &&
          (!window.CineCleaner || !window.CineCleaner.isPlaceholder(part))
        ) {
          return part;
        }
      }

      return "";
    }
  },

  // 3. iQiyi (爱奇艺)
  {
    id: "iqiyi",
    name: "爱奇艺",
    matches: () => location.hostname.includes("iqiyi.com"),
    getVideo: () => document.querySelector("video.iqp-player-videotrack, .iqp-player video, #iqp-player video, [class*='player-videotrack'] video, video"),
    isMoviePlayback: () => {
      const docTitle = document.title || "";
      if (/(?:第\s*\d+\s*[集期话回]|\bE\d{1,3}\b|\bEP\d{1,3}\b|更新至\s*\d+\s*集|全\s*\d+\s*集)/i.test(docTitle)) {
        return false;
      }
      if (/^(?:电视剧|网剧|连续剧|综艺)/.test(docTitle)) {
        return false;
      }
      return true;
    },
    getTitle: () => {
      // 1. Check title inside iQiyi active player container or heading
      const selectors = [
        "h1.player-title", "h1.title-link", "h1[title]", "h1",
        ".iqp-top-title", ".qy-player-title", "[class*='player-title']",
        "[class*='video-title']", "[class*='qy-play-title']", "[class*='title-text']",
        "[data-player-title]"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const pt = (el.getAttribute("title") || el.textContent || "").trim().replace(/《([^》]+)》/, "$1").trim();
          if (pt && !pt.includes("爱奇艺") && (!window.CineCleaner || !window.CineCleaner.isPlaceholder(pt))) {
            return pt;
          }
        }
      }

      // 2. Extract from document.title
      const docTitle = document.title || "";
      const bookMatch = docTitle.match(/《([^》]+)》/);
      if (bookMatch && bookMatch[1].trim()) {
        return bookMatch[1].trim();
      }

      // 3. Robust segmentation fallback
      const parts = docTitle.split(/[-_—|]/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (
          !part.includes("爱奇艺") &&
          !part.includes("在线观看") &&
          !part.includes("电影完整版") &&
          !part.includes("在线视频") &&
          !part.includes("高清") &&
          part !== "电影" &&
          (!window.CineCleaner || !window.CineCleaner.isPlaceholder(part))
        ) {
          return part;
        }
      }

      return "";
    }
  },

  // 4. Youku (优酷)
  {
    id: "youku",
    name: "优酷",
    matches: () => location.hostname.includes("youku.com"),
    getVideo: () => document.querySelector("video.youku-film-player video, video.kui-video-player, #ykPlayer video, .video-layer video, video"),
    isMoviePlayback: () => {
      const docTitle = document.title || "";
      if (/第\s*\d+\s*[集期话回]|电视剧|网剧|连续剧|综艺/.test(docTitle)) {
        return false;
      }
      const meta = document.querySelector("meta[name='irCategory']");
      if (meta && meta.content) {
        const c = meta.content.toLowerCase();
        if (c.includes("teleplay") || c.includes("drama") || c.includes("variety")) {
          return false;
        }
      }
      return true;
    },
    getTitle: () => {
      // 1. Check inside the active film player overlay (e.g. Youku player top-left title)
      const playerTitle = document.querySelector(".kui-dashboard-title, .kui-video-title, #ykPlayer .video-title, .youku-film-player .video-title, .kui-dashboard-top-title");
      if (playerTitle && playerTitle.textContent.trim()) {
        const pt = playerTitle.textContent.trim().replace(/《([^》]+)》/, "$1").trim();
        if (pt && !pt.includes("优酷") && (!window.CineCleaner || !window.CineCleaner.isPlaceholder(pt))) {
          return pt;
        }
      }

      // 2. Extract from document.title
      const docTitle = document.title || "";
      const bookMatch = docTitle.match(/《([^》]+)》/);
      if (bookMatch && bookMatch[1].trim()) {
        return bookMatch[1].trim();
      }

      return docTitle
        .replace(/—在线播放—.*$/i, "")
        .replace(/[-_—|]\s*(?:正片|电影|电视剧|动漫|纪录片|综艺|高清|预告|在线播放|在线观看|优酷).*$/i, "")
        .replace(/[-_—|]\s*优酷.*$/i, "")
        .trim();
    }
  },

  // 5. Aliyun Drive (阿里云盘 / 阿里网盘)
  {
    id: "alipan",
    name: "阿里云盘",
    matches: () => location.hostname.includes("alipan.com") || location.hostname.includes("aliyundrive.com"),
    getVideo: () => document.querySelector("video"),
    getTitle: () => {
      const extRegex = /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|rmvb)(?:[?#&]|$)/i;

      // 1. Check video preview modal title / floating header
      const selectors = [
        "[class*='preview-header'] [class*='title']",
        "[class*='preview-title']",
        "[class*='player-header-title']",
        "[class*='video-preview'] [class*='file-name']",
        "[class*='file-name-wrapper']",
        "[class*='video-player-name']",
        "[class*='player-title']",
        "[class*='video-title']",
        ".ant-modal-title",
        "[data-role='file-title']",
        "[class*='header-left'] [class*='text']",
        "[class*='header--'] [title]"
      ];
      for (const sel of selectors) {
        const elem = document.querySelector(sel);
        if (elem) {
          const t = elem.getAttribute("title") || elem.textContent.trim();
          if (t && t.length > 0 && !t.includes("阿里云盘") && !t.includes("播放列表")) {
            return t;
          }
        }
      }

      // 2. Scan elements excluding file list tables
      const candidates = document.querySelectorAll("span, div, h1, h2, h3, p, [title]");
      for (const el of candidates) {
        if (el.closest("[class*='list'], [class*='table'], [class*='ant-table'], tbody, tr, [class*='grid-item']")) continue;
        if (el.children.length > 2) continue;
        const titleAttr = (el.getAttribute("title") || "").trim();
        if (titleAttr && extRegex.test(titleAttr) && !titleAttr.includes("阿里云盘") && titleAttr.length < 150) {
          return titleAttr;
        }
        const text = (el.textContent || "").trim();
        if (text && extRegex.test(text) && !text.includes("阿里云盘") && text.length < 150 && !text.includes("\n")) {
          return text;
        }
      }

      // 3. Check document title
      const cleanDocTitle = document.title
        .replace(/_阿里云盘.*/i, "")
        .replace(/- 阿里云盘.*/i, "")
        .replace(/阿里云盘.*/i, "")
        .trim();
      if (cleanDocTitle && !cleanDocTitle.includes("我的云盘") && !cleanDocTitle.includes("网盘")) {
        return cleanDocTitle;
      }

      return "";
    }
  },

  // 6. Quark Drive (夸克网盘)
  {
    id: "quark",
    name: "夸克网盘",
    matches: () => location.hostname.includes("quark.cn"),
    getVideo: () => document.querySelector("video.vjs-tech, .video-js video, video"),
    getTitle: () => {
      const extRegex = /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|rmvb)(?:[?#&]|$)/i;

      // 1. Inside active video player container or modal
      const activeVideo = document.querySelector("video");
      if (activeVideo) {
        const playerContainer = activeVideo.closest("[class*='player'], [class*='preview'], [class*='modal'], [class*='dialog'], body");
        if (playerContainer) {
          const inPlayer = playerContainer.querySelectorAll("span, div, h1, h2, h3, p, [title]");
          for (const el of inPlayer) {
            if (el.closest("[class*='list'], [class*='table'], tbody, tr")) continue;
            if (el.children.length > 3) continue;
            const tAttr = (el.getAttribute("title") || "").trim();
            if (tAttr && extRegex.test(tAttr) && !tAttr.includes("夸克网盘") && tAttr.length < 150) {
              return tAttr;
            }
            const txt = (el.textContent || "").trim();
            if (txt && extRegex.test(txt) && !txt.includes("夸克网盘") && txt.length < 150 && !txt.includes("\n")) {
              return txt;
            }
          }
        }
      }

      // 2. Check top playback toolbar (near "播放历史" or player controls)
      try {
        const historyLinks = Array.from(document.querySelectorAll("span, div, a")).filter(
          (el) => el.textContent && el.textContent.trim().includes("播放历史")
        );
        for (const hEl of historyLinks) {
          const parent = hEl.closest("div, header, nav")?.parentElement || hEl.closest("div, header, nav");
          if (parent) {
            const candidates = parent.querySelectorAll("span, div, h1, h2, h3, p, [title]");
            for (const c of candidates) {
              const text = (c.getAttribute("title") || c.textContent || "").trim();
              if (text && extRegex.test(text) && !text.includes("夸克网盘") && text.length < 150 && !text.includes("\n")) {
                return text;
              }
            }
          }
        }
      } catch (e) {}

      // 3. Document title (clean of "夸克网盘")
      const cleanDoc = (document.title || "")
        .replace(/[-_—\s]*夸克网盘.*$/i, "")
        .replace(/^夸克网盘[-_—\s]*/i, "")
        .trim();
      if (cleanDoc && extRegex.test(cleanDoc)) {
        return cleanDoc;
      }

      // 4. Any visible element containing video extension, STRICTLY EXCLUDING file list rows/tables
      const elements = document.querySelectorAll("span, div, h1, h2, h3, p, [title]");
      for (const el of elements) {
        if (el.closest("[class*='file-list'], [class*='table'], [class*='ant-table'], tbody, tr, [class*='grid-item'], [class*='tree']")) {
          continue;
        }
        if (el.children.length > 3) continue;

        const titleAttr = (el.getAttribute("title") || "").trim();
        if (titleAttr && extRegex.test(titleAttr) && !titleAttr.includes("夸克网盘") && titleAttr.length < 150) {
          return titleAttr;
        }

        const text = (el.textContent || "").trim();
        if (text && extRegex.test(text) && !text.includes("夸克网盘") && text.length < 150 && !text.includes("\n")) {
          return text;
        }
      }

      // 5. URL parameters (path, fileName, title)
      try {
        const match = location.href.match(/[?&#](?:path|fileName|file_name|title|name)=([^&]+)/i);
        if (match && match[1]) {
          const decoded = decodeURIComponent(match[1]);
          const parts = decoded.split("/");
          const fileName = parts[parts.length - 1];
          if (fileName && fileName.trim().length > 1 && !fileName.includes("undefined")) {
            return fileName.trim();
          }
        }
      } catch (e) {}

      if (
        cleanDoc &&
        cleanDoc.length > 1 &&
        !cleanDoc.includes("我的夸克") &&
        !cleanDoc.includes("全部文件") &&
        !cleanDoc.includes("文件列表") &&
        !cleanDoc.includes("我的网盘")
      ) {
        return cleanDoc;
      }

      return "";
    }
  },

  // 7. Baidu Netdisk (百度网盘)
  {
    id: "baidu",
    name: "百度网盘",
    matches: () => location.hostname.includes("pan.baidu.com"),
    getVideo: () => document.querySelector("video"),
    getTitle: () => {
      // 1. Check URL path / filename parameter (very common in pan.baidu.com/play/video)
      try {
        const match = location.href.match(/[?&#](?:path|filename)=([^&]+)/i);
        if (match && match[1]) {
          const decoded = decodeURIComponent(match[1]);
          const parts = decoded.split("/");
          const fileName = parts[parts.length - 1];
          if (fileName && fileName.trim().length > 1 && !fileName.includes("undefined")) {
            return fileName.trim();
          }
        }
      } catch (e) {}

      // 2. Check DOM selectors
      const selectors = [
        ".video-title",
        "[class*='video-title']",
        "[class*='file-name']",
        "[class*='video-name']",
        ".vp-title",
        "[class*='vp-title']",
        "[title*='.mp4']",
        "[title*='.mkv']"
      ];
      for (const sel of selectors) {
        const elem = document.querySelector(sel);
        if (elem) {
          const t = elem.getAttribute("title") || elem.textContent.trim();
          if (t && !t.includes("百度网盘")) return t;
        }
      }

      const cleanDoc = document.title.replace(/_百度网盘.*/i, "").replace(/百度网盘.*/i, "").trim();
      if (cleanDoc && !cleanDoc.includes("我的网盘")) return cleanDoc;
      return "";
    }
  },

  // 8. 115 Drive (115网盘 / 115生活 / 115播放器 / 115vod)
  {
    id: "115",
    name: "115网盘",
    matches: () =>
      location.hostname.includes("115.com") ||
      location.hostname.includes("115vod.com") ||
      location.hostname.includes("anxia.com"),
    getVideo: () => document.querySelector("video#js_video_obj, .video-js video, video.vjs-tech, [class*='player'] video, video"),
    getTitle: () => {
      const extRegex = /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|rmvb)(?:[?#&]|$)/i;

      // 1. Check URL parameters (e.g. ?ct=play&pickcode=...&file_name=... or #file_name=...)
      try {
        const match = location.href.match(/[?&#](?:file_name|filename|title|name|file_title)=([^&]+)/i);
        if (match && match[1]) {
          const decoded = decodeURIComponent(match[1]);
          const parts = decoded.split("/");
          const fn = parts[parts.length - 1];
          if (fn && fn.trim().length > 1 && !fn.includes("undefined")) {
            return fn.trim();
          }
        }
      } catch (e) {}

      // 2. Check active video container / modal dialog header
      const activeVideo = document.querySelector("video");
      if (activeVideo) {
        const container = activeVideo.closest(".dialog-box, .modal-box, [class*='player'], [class*='dialog'], [class*='preview'], body");
        if (container) {
          const modalTitle = container.querySelector(
            ".dialog-title, .modal-title, #js_video_title, .vp-video-title, [node-type='title'], [class*='dialog-header'] [class*='title'], [class*='player-header'] [class*='title']"
          );
          if (modalTitle) {
            const t = (modalTitle.getAttribute("title") || modalTitle.textContent || "").trim();
            if (t && !t.includes("115网盘") && !t.includes("115生活") && t.length < 150) {
              return t;
            }
          }
        }
      }

      // 3. Check active player title elements in document
      const activeSelectors = [
        "#js_video_title",
        ".vp-video-title",
        "[node-type='title']",
        ".dialog-title",
        "[class*='dialog-header'] [class*='title']",
        "[class*='player-header'] [class*='title']",
        "[class*='video-top-bar'] [class*='title']",
        "[class*='video-name']",
        "[class*='file-name']",
        "[class*='player-title']",
        "[class*='header-title']",
        "[class*='play-name']",
        ".title"
      ];
      for (const sel of activeSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const t = (el.getAttribute("title") || el.textContent || "").trim();
          if (t && !t.includes("115网盘") && !t.includes("115生活") && t.length < 150) {
            return t;
          }
        }
      }

      // 4. Candidate elements excluding file list tables
      const candidates = document.querySelectorAll("span, div, h1, h2, h3, p, [title]");
      for (const el of candidates) {
        if (el.closest("[class*='list'], [class*='table'], tbody, tr, [class*='grid-item'], [class*='file-browser']")) continue;
        if (el.children.length > 2) continue;
        const titleAttr = (el.getAttribute("title") || "").trim();
        if (titleAttr && extRegex.test(titleAttr) && !titleAttr.includes("115网盘") && titleAttr.length < 150) {
          return titleAttr;
        }
        const text = (el.textContent || "").trim();
        if (text && extRegex.test(text) && !text.includes("115网盘") && text.length < 150 && !text.includes("\n")) {
          return text;
        }
      }

      // 5. Document title (e.g. "xxx.mp4 - 115网盘" / "xxx.mp4 - 115生活" / "xxx.mp4 - 115播放器")
      const cleanDoc = (document.title || "")
        .replace(/[-_—\s]*(?:115网盘|115生活|115播放器|115云|115vod).*$/i, "")
        .replace(/^(?:115网盘|115生活|115播放器|115云)[-_—\s]*/i, "")
        .trim();
      if (
        cleanDoc &&
        !cleanDoc.includes("我的网盘") &&
        !cleanDoc.includes("我的文件") &&
        !cleanDoc.includes("文件列表") &&
        !cleanDoc.includes("全部文件")
      ) {
        return cleanDoc;
      }

      return "";
    }
  },

  // 9. Netflix (网飞)
  {
    id: "netflix",
    name: "Netflix",
    matches: () => location.hostname.includes("netflix.com"),
    getVideo: () => document.querySelector("video"),
    getTitle: () => {
      const titleElem = document.querySelector(".video-title h4, [data-uia='video-title'], .ellipsize-text, h4.ellipsize-text");
      if (titleElem && titleElem.textContent.trim()) {
        return titleElem.textContent.trim();
      }
      const cleanDoc = (document.title || "").replace(/[-_|\s]*Netflix.*$/i, "").trim();
      if (cleanDoc && !cleanDoc.toLowerCase().includes("home") && !cleanDoc.toLowerCase().includes("browse")) {
        return cleanDoc;
      }
      return "";
    }
  },

  // 10. YouTube
  {
    id: "youtube",
    name: "YouTube",
    matches: () => location.hostname.includes("youtube.com"),
    getVideo: () => document.querySelector("video.html5-main-video, video"),
    getTitle: () => {
      const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1, .ytp-title-link");
      if (titleEl && titleEl.textContent.trim()) {
        return titleEl.textContent.trim();
      }
      return (document.title || "").replace(/[-_|\s]*YouTube.*$/i, "").trim();
    }
  },

  // 11. Amazon Prime Video
  {
    id: "primevideo",
    name: "Prime Video",
    matches: () =>
      location.hostname.includes("primevideo.com") ||
      (location.hostname.includes("amazon.") && (location.pathname.includes("video") || location.pathname.includes("gp/video"))),
    getVideo: () => document.querySelector(".webPlayerElement video, video"),
    getTitle: () => {
      const selectors = [
        ".atvwebplayersdk-title-text",
        "[data-automation-id='title']",
        "h1[data-automation-id='title']",
        ".dv-node-title",
        ".xrayQuickViewTitle"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return (document.title || "").replace(/[-_|\s]*(?:Prime Video|Amazon).*$/i, "").trim();
    }
  },

  // 12. Disney+
  {
    id: "disneyplus",
    name: "Disney+",
    matches: () => location.hostname.includes("disneyplus.com"),
    getVideo: () => document.querySelector("video"),
    getTitle: () => {
      const selectors = [
        ".title-field",
        "[data-testid='player-title']",
        ".video-title",
        "h1.title"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return (document.title || "").replace(/[-_|\s]*Disney\+.*$/i, "").trim();
    }
  },

  // 13. Max (HBO Max)
  {
    id: "max",
    name: "Max",
    matches: () => location.hostname.includes("max.com") || location.hostname.includes("hbomax.com"),
    getVideo: () => document.querySelector("video"),
    getTitle: () => {
      const selectors = [
        "[data-testid='player-title']",
        ".player-metadata-title",
        "h2[data-testid='player-title']"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return (document.title || "").replace(/[-_|\s]*(?:Max|HBO Max).*$/i, "").trim();
    }
  },

  // 14. Apple TV+
  {
    id: "appletv",
    name: "Apple TV+",
    matches: () => location.hostname.includes("tv.apple.com"),
    getVideo: () => document.querySelector("video"),
    getTitle: () => {
      const selectors = [
        ".product-header__title",
        ".video-player__title",
        "[data-testid='video-title']"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return (document.title || "").replace(/[-_|\s]*Apple TV\+.*$/i, "").trim();
    }
  }
];

window.CineParsers = CineParsers;
