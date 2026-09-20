/**
 * CinePersona Frosted Glass Toast Notification Component
 * Displays matching status, rating stars, rewatch badges, and collapsible review input.
 */

const CineUI = {
  containerId: "cinepersona-extension-toast-container",

  injectStyles() {
    if (document.getElementById("cinepersona-extension-styles")) return;
    const style = document.createElement("style");
    style.id = "cinepersona-extension-styles";
    style.textContent = `
      #cinepersona-extension-toast-container {
        position: fixed !important;
        top: 20px !important;
        right: 24px !important;
        bottom: auto !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif !important;
        pointer-events: none !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .cp-toast {
        pointer-events: auto !important;
        width: 340px !important;
        background: rgba(11, 15, 25, 0.95) !important;
        backdrop-filter: blur(24px) saturate(190%) !important;
        -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
        border: 1px solid rgba(77, 138, 255, 0.24) !important;
        box-shadow: 0 20px 48px -10px rgba(0, 0, 0, 0.7), 0 0 1px 1px rgba(77, 138, 255, 0.15) !important;
        border-radius: 14px !important;
        padding: 14px 16px !important;
        color: #f1f5f9 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        box-sizing: border-box !important;
        transform: translateY(-20px) scale(0.96);
        opacity: 0;
        transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cp-toast.cp-visible {
        transform: translateY(0) scale(1) !important;
        opacity: 1 !important;
      }
      .cp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .cp-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #60a5fa;
        letter-spacing: 0.02em;
      }
      .cp-brand-svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }
      .cp-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 4px;
        font-weight: 600;
        background: rgba(245, 158, 11, 0.18);
        color: #f5b73d;
        border: 1px solid rgba(245, 158, 11, 0.35);
        margin-left: 6px;
      }
      .cp-close {
        cursor: pointer;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        font-size: 16px;
        padding: 2px 6px;
        line-height: 1;
        border-radius: 4px;
        transition: color 0.2s;
      }
      .cp-close:hover {
        color: #fff;
      }
      .cp-body {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .cp-poster-wrapper {
        width: 44px;
        height: 64px;
        border-radius: 6px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        flex-shrink: 0;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cp-poster {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .cp-poster-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.3);
      }
      .cp-info {
        flex: 1;
        overflow: hidden;
      }
      .cp-title {
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cp-meta {
        font-size: 12px;
        color: #8e9eb5;
        margin-top: 3px;
      }
      .cp-stars-row {
        display: flex;
        align-items: center;
        gap: 3px;
        margin-top: 6px;
      }
      .cp-stars {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        cursor: pointer;
      }
      .cp-star {
        font-size: 18px;
        color: rgba(255, 255, 255, 0.2);
        user-select: none;
        line-height: 1;
        width: 18px;
        text-align: center;
        transition: transform 0.1s;
      }
      .cp-star.active {
        color: #f5b73d;
      }
      .cp-star.half {
        background: linear-gradient(90deg, #f5b73d 50%, rgba(255, 255, 255, 0.2) 50%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: inline-block;
      }
      .cp-star-label {
        font-size: 11px;
        color: #8e9eb5;
        margin-left: 6px;
        font-weight: 500;
      }
      /* Review Comment Box */
      .cp-comment-section {
        margin-top: 2px;
      }
      .cp-comment-toggle {
        font-size: 11px;
        color: #60a5fa;
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .cp-comment-toggle:hover {
        text-decoration: underline;
      }
      .cp-textarea {
        display: none;
        width: 100%;
        margin-top: 6px;
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(77, 138, 255, 0.18);
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 12px;
        color: #f4f0e8;
        resize: vertical;
        min-height: 52px;
        font-family: inherit;
        outline: none;
      }
      .cp-textarea:focus {
        border-color: #3b82f6;
      }
      .cp-textarea.show {
        display: block;
      }
      .cp-actions {
        display: flex;
        gap: 8px;
        margin-top: 6px;
      }
      .cp-btn {
        flex: 1;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
      }
      .cp-btn-primary {
        background: #3b82f6;
        color: #ffffff;
      }
      .cp-btn-primary:hover {
        background: #2563eb;
      }
      .cp-btn-ghost {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.85);
      }
      .cp-btn-ghost:hover {
        background: rgba(255, 255, 255, 0.14);
      }
    `;
    document.head.appendChild(style);
  },

  getContainer() {
    this.injectStyles();
    
    // 1. Native Fullscreen Element if in fullscreen mode
    const targetParent = document.fullscreenElement || document.webkitFullscreenElement || document.body || document.documentElement;

    let container = document.getElementById(this.containerId);
    if (!container || container.parentElement !== targetParent) {
      if (container) container.remove();
      container = document.createElement("div");
      container.id = this.containerId;
      targetParent.appendChild(container);
    }
    return container;
  },

  show({ movie, activity, isAuthenticated, onSave, onCorrect, onClose, isAutoScrobbled = false }) {
    const container = this.getContainer();
    container.innerHTML = "";

    const toast = document.createElement("div");
    toast.className = "cp-toast";

    const movieTitle = movie.title || "已识别影片";
    const movieYear = movie.year ? `(${movie.year})` : "";
    const posterUrl = movie.posterURL || "";
    
    // Check if watched before
    const isRewatch = Boolean(activity && activity.status === "WATCHED");
    const initialRating = activity?.rating ? Math.round(activity.rating / 2) : 0;
    const initialReview = activity?.reviewText || "";

    const badgeText = isAutoScrobbled ? (isRewatch ? "重温打卡" : "自动打卡") : "已识别";
    const badgeStyle = isAutoScrobbled
      ? "background: rgba(16, 185, 129, 0.18); color: #34d399; border-color: rgba(16, 185, 129, 0.35);"
      : "background: rgba(59, 130, 246, 0.18); color: #60a5fa; border-color: rgba(59, 130, 246, 0.35);";
    const badgeHtml = `<span class="cp-badge" style="${badgeStyle}">${badgeText}</span>`;
    const metaSub = isAutoScrobbled
      ? (isRewatch ? `此前已看 · 本次记录为重温` : `🎉 观影进度达标 · 已自动记入片库`)
      : `🎬 播放已识别 · 达 80% 自动打卡`;

    // Ratings badges
    const ratings = Array.isArray(movie.ratings) ? movie.ratings : [];
    const ratingsHtml = ratings.length > 0 ? `
      <div class="cp-ratings-row" style="display: flex; gap: 6px; margin: 4px 0 2px 0;">
        ${ratings.map((r) => {
          const sLabel = r.source === "Douban" ? "豆" : (r.source === "Letterboxd" ? "LB" : r.source);
          return `<span style="font-size: 10px; color: #94a3b8; background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.08);">${sLabel} <b style="color: #f1f5f9;">${r.score}</b></span>`;
        }).join("")}
      </div>
    ` : "";

    // Brand icon
    let brandLogoSrc = "";
    try {
      brandLogoSrc = chrome.runtime.getURL("icons/cinepersona-icon.png");
    } catch (e) {}

    const brandIconHtml = brandLogoSrc
      ? `<img src="${brandLogoSrc}" style="width: 20px; height: 20px; border-radius: 4px; object-fit: contain;" alt="CinePersona" />`
      : `<span style="font-size: 16px;">🎬</span>`;

    // Fallback poster film icon
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

    const posterImgHtml = posterUrl
      ? `<img class="cp-poster" referrerpolicy="no-referrer" src="${posterUrl}" alt="${movieTitle}" /><div class="cp-poster-fallback" style="display:none;">${posterFallbackSvg}</div>`
      : `<div class="cp-poster-fallback">${posterFallbackSvg}</div>`;

    toast.innerHTML = `
      <div class="cp-header">
        <div class="cp-brand">
          ${brandIconHtml}
          <span>CinePersona 影格</span>
          ${badgeHtml}
        </div>
        <button class="cp-close" title="关闭">&times;</button>
      </div>
      <div class="cp-body">
        <div class="cp-poster-wrapper">
          ${posterImgHtml}
        </div>
        <div class="cp-info">
          <div class="cp-title" title="${movieTitle}">${movieTitle}</div>
          <div class="cp-meta">${movieYear} · ${metaSub}</div>
          ${ratingsHtml}
          ${isAuthenticated ? `
            <div class="cp-stars-row">
              <div class="cp-stars" id="cpStarContainer">
                <span class="cp-star" data-idx="0">★</span>
                <span class="cp-star" data-idx="1">★</span>
                <span class="cp-star" data-idx="2">★</span>
                <span class="cp-star" data-idx="3">★</span>
                <span class="cp-star" data-idx="4">★</span>
              </div>
              <span class="cp-star-label" id="cpStarLabel">${initialRating > 0 ? `${(initialRating * 2).toFixed(initialRating % 1 === 0 ? 0 : 1)} 分` : "滑动打分"}</span>
            </div>
          ` : `
            <div class="cp-meta" style="color: #60a5fa; margin-top: 4px;">登录后可点亮电影DNA</div>
          `}
        </div>
      </div>

      ${isAuthenticated ? `
        <div class="cp-comment-section">
          <span class="cp-comment-toggle" id="cpToggleComment">
            <span>✍ ${initialReview ? "编辑影评短评" : "写句简评 / 随笔..."}</span>
          </span>
          <textarea class="cp-textarea ${initialReview ? 'show' : ''}" id="cpReviewInput" placeholder="这片怎么样？写几句观后感同步到影格个人主页...">${initialReview}</textarea>
        </div>
      ` : ""}

      <div class="cp-actions">
        ${isAuthenticated ? `
          <button class="cp-btn cp-btn-primary cp-btn-done">
            ${isAutoScrobbled ? (isRewatch ? "记录本次重温 ✓" : "确认已看过 ✓") : "立即打卡已看 ✓"}
          </button>
          <button class="cp-btn cp-btn-ghost cp-btn-correct">纠正</button>
        ` : `
          <a class="cp-btn cp-btn-primary cp-btn-auth" href="https://cinepersona.com/login?next=/movie/${movie.id}" target="_blank">一键登录建档</a>
          <button class="cp-btn cp-btn-ghost cp-btn-correct">搜索纠偏</button>
        `}
      </div>
    `;

    container.appendChild(toast);
    const posterImg = toast.querySelector("img.cp-poster");
    if (posterImg) {
      posterImg.addEventListener("error", () => {
        posterImg.style.display = "none";
        const fallback = toast.querySelector(".cp-poster-fallback");
        if (fallback) fallback.style.display = "flex";
      });
    }
    requestAnimationFrame(() => toast.classList.add("cp-visible"));

    let currentRating = initialRating;
    let autoDismissTimer = null;

    const resetDismissTimer = (seconds = 8) => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      autoDismissTimer = setTimeout(() => {
        if (document.body.contains(toast)) {
          dismiss();
        }
      }, seconds * 1000);
    };

    const closeBtn = toast.querySelector(".cp-close");
    const dismiss = () => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      toast.classList.remove("cp-visible");
      setTimeout(() => toast.remove(), 400);
      if (onClose) onClose();
    };
    closeBtn.addEventListener("click", dismiss);

    // Star rating & comment interactions
    if (isAuthenticated) {
      const starContainer = toast.querySelector("#cpStarContainer");
      const starLabel = toast.querySelector("#cpStarLabel");
      const stars = toast.querySelectorAll(".cp-star");

      const renderStars = (ratingVal) => {
        stars.forEach((star, idx) => {
          const starFloor = idx + 1;
          star.classList.remove("active", "half");
          if (ratingVal >= starFloor) {
            star.classList.add("active");
          } else if (ratingVal >= starFloor - 0.5) {
            star.classList.add("half");
          }
        });
        if (starLabel) {
          starLabel.textContent = ratingVal > 0 ? `${(ratingVal * 2).toFixed(ratingVal % 1 === 0 ? 0 : 1)} 分` : "滑动打分";
        }
      };

      renderStars(currentRating);

      if (starContainer) {
        starContainer.addEventListener("mousemove", (e) => {
          const targetStar = e.target.closest(".cp-star");
          if (!targetStar) return;
          const rect = targetStar.getBoundingClientRect();
          const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);
          const starIdx = parseInt(targetStar.getAttribute("data-idx"), 10);
          const hoverVal = isLeftHalf ? (starIdx + 0.5) : (starIdx + 1.0);
          renderStars(hoverVal);
        });

        starContainer.addEventListener("click", (e) => {
          const targetStar = e.target.closest(".cp-star");
          if (!targetStar) return;
          const rect = targetStar.getBoundingClientRect();
          const isLeftHalf = (e.clientX - rect.left) < (rect.width / 2);
          const starIdx = parseInt(targetStar.getAttribute("data-idx"), 10);
          currentRating = isLeftHalf ? (starIdx + 0.5) : (starIdx + 1.0);
          renderStars(currentRating);
          resetDismissTimer(15);
        });

        starContainer.addEventListener("mouseleave", () => {
          renderStars(currentRating);
        });
      }

      const toggleComment = toast.querySelector("#cpToggleComment");
      const reviewInput = toast.querySelector("#cpReviewInput");
      if (toggleComment && reviewInput) {
        toggleComment.addEventListener("click", () => {
          reviewInput.classList.toggle("show");
          if (reviewInput.classList.contains("show")) {
            reviewInput.focus();
            if (autoDismissTimer) clearTimeout(autoDismissTimer); // Stop auto-closing when typing!
          }
        });
        reviewInput.addEventListener("focus", () => {
          if (autoDismissTimer) clearTimeout(autoDismissTimer);
        });
        reviewInput.addEventListener("blur", () => {
          resetDismissTimer(8);
        });
      }

      const doneBtn = toast.querySelector(".cp-btn-done");
      doneBtn.addEventListener("click", () => {
        const reviewText = reviewInput ? reviewInput.value.trim() : "";
        if (onSave) {
          onSave({
            rating: currentRating > 0 ? currentRating * 2 : null,
            reviewText,
            isRewatch
          });
        }
        doneBtn.textContent = isRewatch ? "已记录重温！" : "已入库！";
        setTimeout(dismiss, 1000);
      });
    }

    // Correct / search button
    const correctBtn = toast.querySelector(".cp-btn-correct");
    if (correctBtn) {
      correctBtn.addEventListener("click", () => {
        if (onCorrect) onCorrect();
      });
    }

    // Start initial dismiss timer (10 seconds)
    resetDismissTimer(10);
  }
};

window.CineUI = CineUI;
