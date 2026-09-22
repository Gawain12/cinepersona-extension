(function (root) {
  "use strict";

  function getLocale() {
    const languages = [];
    try {
      if (Array.isArray(navigator.languages)) {
        languages.push(...navigator.languages.filter(Boolean));
      }
      if (navigator.language) {
        languages.push(navigator.language);
      }
    } catch (error) {
      // Some extension contexts may not expose navigator language metadata.
    }

    if (languages.length === 0) {
      return "zh";
    }

    return /^zh(?:-|$)/i.test(String(languages[0])) ? "zh" : "en";
  }

  function t(zh, en) {
    return getLocale() === "zh" ? zh : en;
  }

  function apply(rootNode) {
    const scope = rootNode || document;
    scope.querySelectorAll?.("[data-i18n-zh][data-i18n-en]").forEach((element) => {
      element.textContent = t(element.dataset.i18nZh, element.dataset.i18nEn);
    });
    scope.querySelectorAll?.("[data-i18n-html-zh][data-i18n-html-en]").forEach((element) => {
      element.innerHTML = t(element.dataset.i18nHtmlZh, element.dataset.i18nHtmlEn);
    });
    scope.querySelectorAll?.("[data-i18n-title-zh][data-i18n-title-en]").forEach((element) => {
      element.title = t(element.dataset.i18nTitleZh, element.dataset.i18nTitleEn);
    });
    scope.querySelectorAll?.("[data-i18n-placeholder-zh][data-i18n-placeholder-en]").forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholderZh, element.dataset.i18nPlaceholderEn);
    });
    if (scope.documentElement) {
      scope.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";
    }
  }

  root.CinePersonaI18n = { getLocale, t, apply };
})(typeof globalThis !== "undefined" ? globalThis : window);
