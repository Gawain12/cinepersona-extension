/**
 * CinePersona Scrobbler Engine
 * Monitors HTML5 Video progress and triggers auto-recording at the configured threshold.
 */

class CineScrobbler {
  constructor() {
    this.threshold = 0.8; // Default: 80% mark; content/main.js applies the user's setting.
    this.hasScrobbled = false;
    this.activeVideo = null;
    this.matchedMovie = null;
    this._boundListener = null;
  }

  attach(videoElement, movieInfo, onScrobble) {
    if (movieInfo) this.matchedMovie = movieInfo;
    if (onScrobble) this.onScrobble = onScrobble;
    if (!videoElement) return;

    if (this.activeVideo !== videoElement) {
      if (this.activeVideo && this._boundListener) {
        this.activeVideo.removeEventListener("timeupdate", this._boundListener);
        this.activeVideo.removeEventListener("seeked", this._boundListener);
        this.activeVideo.removeEventListener("playing", this._boundListener);
        this.activeVideo.removeEventListener("durationchange", this._boundListener);
      }
      this.activeVideo = videoElement;
      this._boundListener = this.handleProgressUpdate.bind(this);
      this.activeVideo.addEventListener("timeupdate", this._boundListener);
      this.activeVideo.addEventListener("seeked", this._boundListener);
      this.activeVideo.addEventListener("playing", this._boundListener);
      this.activeVideo.addEventListener("durationchange", this._boundListener);
    }

    this.hasScrobbled = false;
    // Check progress immediately
    setTimeout(() => this.handleProgressUpdate(), 200);
  }

  handleProgressUpdate() {
    if (!this.activeVideo || this.hasScrobbled) return;

    const currentTime = this.activeVideo.currentTime || 0;
    const duration = this.activeVideo.duration || 0;

    if (!duration || duration < 10 || !isFinite(duration)) {
      return;
    }

    const progress = currentTime / duration;

    // Check the configured threshold.
    if (progress >= this.threshold) {
      this.hasScrobbled = true;
      if (this.onScrobble) {
        this.onScrobble({
          movie: this.matchedMovie,
          progress,
          currentTime,
          duration
        });
      }
    }
  }

  getCurrentProgress() {
    if (!this.activeVideo) return { currentTime: 0, duration: 0, progress: 0 };
    const currentTime = this.activeVideo.currentTime || 0;
    const duration = this.activeVideo.duration || 0;
    const validDuration = isFinite(duration) ? duration : 0;
    const progress = validDuration > 0 ? Math.min(1, Math.max(0, currentTime / validDuration)) : 0;
    return { currentTime, duration: validDuration, progress };
  }

  detach() {
    if (this.activeVideo && this._boundListener) {
      this.activeVideo.removeEventListener("timeupdate", this._boundListener);
      this.activeVideo.removeEventListener("seeked", this._boundListener);
      this.activeVideo.removeEventListener("playing", this._boundListener);
      this.activeVideo.removeEventListener("durationchange", this._boundListener);
    }
    this.activeVideo = null;
    this.matchedMovie = null;
    this.hasScrobbled = false;
    this._boundListener = null;
  }

  reset() {
    this.hasScrobbled = false;
  }
}

window.CineScrobbler = CineScrobbler;
