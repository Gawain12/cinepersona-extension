/**
 * CinePersona Title & Year Cleaner
 * Cleans messy cloud drive filenames and streaming titles into clean movie search terms.
 */

const CineCleaner = {
  YEAR_REGEX: /(?:19|20)\d{2}/,

  STREAMING_SUFFIXES: [
    /[-_—\s|]+(?:apple[\s.-]?tv\+?|netflix|disney\+?|prime[\s.-]?video|hbo[\s.-]?max|hbo|hulu|paramount\+?|peacock).*$/i,
    /[-_—\s]+(?:电影|电视剧|番剧|纪录片|高清|独家|正片|完整版|在线观看|在线播放|哔哩哔哩|bilibili|腾讯视频|爱奇艺|优酷|芒果TV).*$/i,
    /_电影完整版_高清在线观看.*$/i,
    /_电影_高清\d+P?在线观看.*$/i,
    /_高清视频在线观看.*$/i,
    /_电影在线观看.*$/i,
    /_电影.*$/i,
    /_腾讯视频.*$/i,
    /_爱奇艺.*$/i,
    /—在线播放—.*优酷/i,
    /_优酷.*$/i,
    /_哔哩哔哩_bilibili.*$/i,
    /_芒果TV.*$/i,
  ],

  // Common commentary keywords
  COMMENTARY_PATTERNS: [
    /一口气看完/i,
    /一口气刷完/i,
    /几分钟看完/i,
    /几分钟带你看/i,
    /【电影解说】/i,
    /电影解说/i,
    /影视解说/i,
    /深度解析/i,
    /幕后花絮/i,
    /混剪/i,
    /吐槽/i,
    /盘点/i,
    /说电影/i,
    /讲电影/i,
    /神作推荐/i
  ],

  // TV series, dramas, varieties, and non-movie clips to isolate
  TV_PATTERNS: [
    /第\s*\d+\s*[集期话回]/i,
    /\bEP?\s*\d+\b/i,
    /\bE\d{1,3}\b/i,
    /\bS\d{1,2}E\d{1,3}\b/i,
    /更新至\s*\d+\s*集/i,
    /全\s*\d+\s*集/i,
    /纯音乐[，,]\s*请欣赏/i,
    /MV\s*[:：]/i,
    /现场版/i,
    /电视剧/i,
    /网剧/i,
    /连续剧/i,
    /短剧/i,
    /微短剧/i,
    /综艺/i,
    /脱口秀/i,
    /动漫/i,
    /少儿/i
  ],

  PLACEHOLDER_TITLES: new Set([
    "play video",
    "video",
    "player",
    "untitled",
    "视频",
    "视频列表",
    "我的视频",
    "全部视频",
    "播放列表",
    "播放视频",
    "我的网盘",
    "我的文件",
    "夸克网盘",
    "阿里云盘",
    "百度网盘",
    "115网盘",
    "全部文件",
    "正片以外",
    "正片",
    "花絮与周边",
    "精彩片段",
    "尖叫之夜",
    "星光盛典",
    "星光大赏",
    "微博之夜",
    "腾讯视频",
    "爱奇艺",
    "优酷",
    "优酷视频",
    "哔哩哔哩",
    "bilibili",
    "芒果tv",
    "netflix",
    "youtube",
    "prime video",
    "disney+",
    "apple tv",
    "apple tv+",
    "中国领先的在线视频媒体平台",
    "海量正版高清视频在线观看",
    "在线视频网站",
    "海量高清视频在线观看",
    "精彩视频在线观看"
  ]),

  // Common UI control labels to reject
  CONTROL_WORDS: new Set([
    "播放", "暂停", "全屏", "退出全屏", "倍速", "清晰度", "原画", "高清", "超清", "标清",
    "弹幕", "音量", "静音", "下一集", "上一集", "选集", "设置", "下载", "分享", "转存",
    "收藏", "字幕", "滤镜", "色彩", "画质", "杜比", "全景声", "play", "pause", "fullscreen",
    "video", "play video"
  ]),

  NOISE_PATTERNS: [
    /\b(?:4k|2160p|1080p|720p|480p|uhd|fhd|hd|sd|remux|bluray|blu-ray|bdrip|web-dl|webrip|hdtv|dvdrip)\b/gi,
    /\b(?:x264|x265|h264|h265|hevc|avc|10bit|8bit|hdr10\+?|hdr|dolby[\s.-]?vision|dovi|dv)\b/gi,
    /\b(?:dts(?:-hd)?|truehd|atmos|ac3|eac3|ddp5\.1|aac(?:\d\.\d)?|flac|mp3|lossless)\b/gi,
    /\b(?:国粤双语|中英双字|中文字幕|双语字幕|简繁字幕|官方中字|国语中字|国语配音|粤语配音|未删减版|加长版|导剪版|imax(?:-enhanced)?|criterion|extended|director'?s\.?cut|unrated)\b/gi,
    /\b(?:60fps|120fps|hq|hds|mp4ba|ygdy8|dy2018)\b/gi,
    /\b(?:apple[\s.-]?tv\+?|netflix|disney\+?|prime[\s.-]?video|hbo[\s.-]?max|hbo|hulu|paramount\+?|peacock)\b/gi,
  ],

  FILE_EXTENSIONS: /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|iso)$/i,

  isLikelyCommentary(raw) {
    if (!raw) return false;
    for (const pattern of this.COMMENTARY_PATTERNS) {
      if (pattern.test(raw)) return true;
    }
    return false;
  },

  isTVOrNonMovie(raw) {
    if (!raw) return false;
    for (const pattern of this.TV_PATTERNS) {
      if (pattern.test(raw)) return true;
    }
    return false;
  },

  isPlaceholder(raw) {
    if (!raw) return true;
    const lower = raw.trim().toLowerCase();
    if (this.PLACEHOLDER_TITLES.has(lower)) return true;
    if (this.CONTROL_WORDS.has(lower)) return true;
    if (/^play[\s_-]*video$/i.test(lower)) return true;
    return false;
  },

  clean(raw) {
    if (!raw || typeof raw !== "string") {
      return { title: "", year: null, isCommentary: false, isTV: false, raw: "" };
    }

    let cleaned = raw.trim();

    if (this.isPlaceholder(cleaned)) {
      return { title: "", year: null, isCommentary: false, isTV: false, raw };
    }

    const isCommentary = this.isLikelyCommentary(cleaned);
    const isTV = this.isTVOrNonMovie(cleaned);

    // If path contains slash, take last segment
    if (cleaned.includes("/")) {
      const segments = cleaned.split("/").filter((s) => s.trim().length > 0);
      if (segments.length > 0) cleaned = segments[segments.length - 1];
    }

    // 1. Strip file extension
    cleaned = cleaned.replace(this.FILE_EXTENSIONS, "");

    // 2. Strip streaming suffixes
    for (const suffix of this.STREAMING_SUFFIXES) {
      cleaned = cleaned.replace(suffix, "");
    }

    // 3. Strip website/ad/release-group brackets anywhere at the beginning or middle:
    // e.g. [阳光电影www.ygdy8.com] or 【关注微信公众号xxx】 or [BT天堂]
    cleaned = cleaned.replace(/^\[(?:[^\]]*(?:www|\.com|\.net|\.org|电影|首发|微信|公众号|分享|压制|天堂|影视|发布|BT|4k|HD)[^\]]*)\]\s*/i, "");
    cleaned = cleaned.replace(/^【(?:[^】]*(?:www|\.com|\.net|\.org|电影|首发|微信|公众号|分享|压制|天堂|影视|发布|BT|4k|HD)[^】]*)】\s*/i, "");
    // Also remove generic leading bracket tags if followed by movie title
    cleaned = cleaned.replace(/^[\[【][^\]】]{2,25}[\]】]\s*/g, "");

    if (this.isPlaceholder(cleaned)) {
      return { title: "", year: null, isCommentary: false, raw };
    }

    // 4. Extract year
    let detectedYear = null;
    const yearMatch = cleaned.match(this.YEAR_REGEX);
    if (yearMatch) {
      const parsedYear = parseInt(yearMatch[0], 10);
      if (parsedYear >= 1895 && parsedYear <= new Date().getFullYear() + 2) {
        detectedYear = parsedYear;
      }
    }

    // 5. Strip noise tags
    for (const pattern of this.NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, " ");
    }

    // Strip bracketed noise like 【4K60帧】, (1080p), [OurBits], and book marks 《》
    cleaned = cleaned.replace(/\[[^\]]*\]/g, " ");
    cleaned = cleaned.replace(/【[^】]*】/g, " ");
    cleaned = cleaned.replace(/（[^）]*）/g, " ");
    cleaned = cleaned.replace(/\([^\)]*\)/g, " ");
    cleaned = cleaned.replace(/[《》]/g, " ");

    // 6. Normalize separators
    cleaned = cleaned.replace(/[._\-–—|/]+/g, " ");

    // 7. If year exists, check if title is before or after year
    if (detectedYear) {
      const yearStr = String(detectedYear);
      const yearIdx = cleaned.indexOf(yearStr);
      if (yearIdx > 0) {
        const beforeYear = cleaned.substring(0, yearIdx).trim();
        const afterYear = cleaned.substring(yearIdx + yearStr.length).trim();

        // If beforeYear has Chinese, prefer beforeYear
        if (/[\u4e00-\u9fa5]/.test(beforeYear)) {
          cleaned = beforeYear;
        } else if (/[\u4e00-\u9fa5]/.test(afterYear)) {
          // e.g. Flipped.2010.怦然心动 -> afterYear has the Chinese title!
          cleaned = afterYear;
        } else if (beforeYear.length > 1) {
          cleaned = beforeYear;
        }
      }
    }

    // 8. If title has Chinese characters, isolate the Chinese title and discard accompanying English words
    if (/[\u4e00-\u9fa5]/.test(cleaned)) {
      const chinesePreferred = cleaned.replace(/[a-zA-Z]+/g, " ").replace(/\s+/g, " ").trim();
      if (chinesePreferred && /[\u4e00-\u9fa5]/.test(chinesePreferred) && chinesePreferred.length >= 2) {
        cleaned = chinesePreferred;
      }
    } else {
      // For foreign titles, if contains AKA / A.K.A., take the primary title before AKA
      // e.g. "El Sol Del Membrillo AKA Dream Of Light" -> "El Sol Del Membrillo"
      const akaMatch = cleaned.match(/\s+(?:aka|a\.k\.a\.)\s+/i);
      if (akaMatch && akaMatch.index > 0) {
        cleaned = cleaned.substring(0, akaMatch.index).trim();
      }
    }

    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return {
      title: cleaned,
      year: detectedYear,
      isCommentary,
      isTV,
      raw
    };
  }
};

if (typeof window !== "undefined") {
  window.CineCleaner = CineCleaner;
}
if (typeof module !== "undefined") {
  module.exports = CineCleaner;
}
