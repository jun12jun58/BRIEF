(() => {
  "use strict";
   
  const API_ENDPOINT = "https://freenewsapi.ai/v1/search";
  const NEWS_COUNTRY = "KR";
  const PAGE_SIZE = 15;
  const SEARCH_DEBOUNCE_MS = 500;
  const ACCENT_STORAGE_KEY = "brief-accent-color";
  const THEME_STORAGE_KEY = "brief-theme";
  const NO_IMAGE_PALETTE_STORAGE_KEY = "brief-no-image-palette";
  const ACTIVE_LANGUAGE_STORAGE_KEY = "brief-active-language";
  const ACCENT_COLORS = {
    green: {
      light: ["#0d8a56", "#0a6e44", "#e8f6ef", "#c5e8d6"],
      dark: ["#8ee1af", "#b9f2d1", "#132d22", "#244a36"],
    },
    yellow: {
      light: ["#ce8621", "#da882a", "#fefce8", "#f7bb6d"],
      dark: ["#fdb447", "#fed38a", "#714711", "#b87528"],
    },
    blue: {
      light: ["#2563eb", "#1d4ed8", "#eff6ff", "#bfdbfe"],
      dark: ["#93c5fd", "#bfdbfe", "#172554", "#1e3a8a"],
    },
    red: {
      light: ["#dc2626", "#b91c1c", "#fef2f2", "#fecaca"],
      dark: ["#fca5a5", "#fecaca", "#450a0a", "#7f1d1d"],
    },
    black: {
      light: ["#262626", "#000000", "#f5f5f5", "#d4d4d4"],
      dark: ["#e5e5e5", "#fafafa", "#262626", "#525252"],
    },
    pink: {
      light: ["#db2777", "#be185d", "#fdf2f8", "#fbcfe8"],
      dark: ["#f9a8d4", "#fbcfe8", "#500724", "#831843"],
    },
  };
  const BLOCKED_HOSTS = new Set([
    "newspim.com",
  ]);

  const PASTEL_BACKGROUND_COLORS_LIGHT = [
    "#F7E9D8",
    "#DDEAE2",
    "#E8DDF6",
    "#DCEBFA",
    "#FBE5EA",
    "#FBEEDC",
    "#DCEDEB",
    "#EFDCEC",
    "#E8F2CE",
    "#FCEFD7",
    "#D6EAF2",
    "#F7DCCB",
  ];

  const PASTEL_BACKGROUND_COLORS_DARK = [
    "#7798a5",
    "#ab6e83",
    "#879d6b",
    "#a4765c",
    "#a45e78",
    "#ac8e6d",
    "#5c8785",
    "#745c69",
    "#709c70",
    "#50718e",
    "#9f6d4d",
    "#a48076",
  ];

  const sourceBackgroundMap = {
    light: new Map(),
    dark: new Map(),
  };

  const sourceColorIndexMap = {
    light: new Map(),
    dark: new Map(),
  };

  let currentTheme = "light";
  let currentAccentColor = "green";
   
  const MAX_FETCH_ATTEMPTS_PER_BATCH = 10;
  const API_OFFSET_CAP = 9900;

  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
  const resetButton = document.getElementById("reset-button");
  const settingsButton = document.getElementById("settings-button");
  const settingsPanel = document.getElementById("settings-panel");
  const settingsCloseButton = document.getElementById("settings-close");
  const articlePreviewPanel = document.getElementById("article-preview-panel");
  const articlePreviewCloseButton = document.getElementById("article-preview-close");
  const articlePreviewSource = document.getElementById("article-preview-source");
  const articlePreviewDate = document.getElementById("article-preview-date");
  const articlePreviewTitle = document.getElementById("article-preview-title");
  const articlePreviewSummary = document.getElementById("article-preview-summary");
  const articlePreviewImage = document.getElementById("article-preview-image");
  const articlePreviewUrlWrap = document.getElementById("article-preview-url-wrap");
  const articlePreviewUrl = document.getElementById("article-preview-url");
  const articlePreviewCopyButton = document.getElementById("article-preview-copy");
  const articlePreviewLink = document.getElementById("article-preview-link");
  const themeChoiceButtons = Array.from(document.querySelectorAll(".theme-choice"));
  const accentColorButtons = Array.from(document.querySelectorAll(".accent-color-choice"));
  const noImagePaletteToggle = document.getElementById("no-image-palette-toggle");
  const languageSwitchButtons = document.querySelectorAll(".language-switch-button");
  const languageSections = {
    ko: document.getElementById("korean-news-section"),
    en: document.getElementById("english-news-section"),
  };

  const statusBar = document.getElementById("status-bar");
  const newsGrids = {
    ko: document.getElementById("korean-news-grid"),
    en: document.getElementById("english-news-grid"),
  };

  const languageLoadings = {
    ko: document.getElementById("korean-news-loading"),
    en: document.getElementById("english-news-loading"),
  };
  const languageErrors = {
    ko: document.getElementById("korean-news-error"),
    en: document.getElementById("english-news-error"),
  };
  const stateEmpty = document.getElementById("state-empty");
  const emptyMessageEl = document.getElementById("empty-message");

  const loadMoreButtons = {
    ko: document.getElementById("korean-load-more-button"),
    en: document.getElementById("english-load-more-button"),
  };

  const retryButtons = {
    ko: languageErrors.ko.querySelector(".retry-button"),
    en: languageErrors.en.querySelector(".retry-button"),
  };

  let noImagePaletteEnabled = true;

  const state = {
    query: "",
    isLoading: false,
    languages: {
      ko: { apiOffset: 0, total: 0, totalIsLowerBound: false, displayedCount: 0, isLoadingMore: false, hasMore: false, leftover: [], seenKeys: new Set() },
      en: { apiOffset: 0, total: 0, totalIsLowerBound: false, displayedCount: 0, isLoadingMore: false, hasMore: false, leftover: [], seenKeys: new Set() },
    },
  };

  const activeControllers = { ko: null, en: null };
  let debounceTimer = null;
  let articlePreviewTrigger = null;

  function setActiveLanguage(language) {
    Object.entries(languageSections).forEach(([key, section]) => {
      section.hidden = key !== language;
    });

    languageSwitchButtons.forEach((button) => {
      const isActive = button.dataset.language === language;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function setLanguageError(language, visible) {
    languageErrors[language].hidden = !visible;
  }

  function setLanguageLoading(language, visible) {
    languageLoadings[language].hidden = !visible;
  }

  function decodeHtmlEntities(value) {
    if (typeof value !== "string") return "";

    let decoded = value;
    let previous;

    while (decoded !== previous) {
      previous = decoded;
      const textarea = document.createElement("textarea");
      textarea.innerHTML = decoded;
      decoded = textarea.value;
    }

    return decoded;
  }

  function getDisplayText(value, fallback) {
    const decoded = decodeHtmlEntities(value ?? "").trim();
    return decoded || fallback;
  }

  function formatPublishedAt(isoString) {
    if (!isoString) return "날짜 정보 없음";
    const parts = isoString.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
    );
    if (!parts) return "날짜 정보 없음";

    return `${parts[1]}. ${parts[2]}. ${parts[3]}. ${parts[4]}:${parts[5]}`;
  }

  function resolvePublisherName(article) {
    if (article.sitename && article.sitename.trim()) return getDisplayText(article.sitename, "알 수 없는 언론사");
    if (article.host) return getDisplayText(article.host, "알 수 없는 언론사");
    return "알 수 없는 언론사";
  }

  function normalizeTitle(title) {
    if (!title || typeof title !== "string") return "";
    return decodeHtmlEntities(title)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[“”"']/g, "")
      .replace(/[…·•]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeNewsHost(hostname) {
    const host = hostname.replace(/^www\./, "").toLowerCase().trim();
    return host === "m.seoul.co.kr" ? "seoul.co.kr" : host;
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== "string") return "";
    try {
      const u = new URL(url);
      let path = u.pathname.replace(/\/+$/, "") || "/";
      const host = normalizeNewsHost(u.hostname);
      return `${host}${path}`;
    } catch (_err) {
      return url.trim().toLowerCase();
    }
  }

  function getSavedActiveLanguage() {
    try {
      const savedLanguage = localStorage.getItem(ACTIVE_LANGUAGE_STORAGE_KEY);
      return savedLanguage === "en" ? "en" : "ko";
    } catch (error) {
      console.error("뉴스 언어 설정을 불러오지 못했습니다.", error);
      return "ko";
    }
  }

  function resolveHost(article) {
    if (article.host && typeof article.host === "string") {
      return normalizeNewsHost(article.host);
    }
    if (article.url) {
      try {
        return normalizeNewsHost(new URL(article.url).hostname);
      } catch (_err) {
        /* ignore */
      }
    }
    return "";
  }
   
  function getDedupeKeys(article) {
    const keys = [];
    const host = resolveHost(article);
    const title = normalizeTitle(article.title);
    const urlKey = normalizeUrl(article.url);

    if (urlKey) keys.push(`url:${urlKey}`);
    if (host && title) keys.push(`ht:${host}|${title}`);
    if (title.length >= 20) keys.push(`t:${title}`);

    return keys;
  }

  function isDuplicate(article, seenKeys) {
    const keys = getDedupeKeys(article);
    return keys.some((k) => seenKeys.has(k));
  }

  function markSeen(article, seenKeys) {
    getDedupeKeys(article).forEach((k) => seenKeys.add(k));
  }

  function getSourceBackgroundColor(sourceName) {
    const publisher = String(sourceName || "").trim().toLowerCase();
    const palette = currentTheme === "dark" ? PASTEL_BACKGROUND_COLORS_DARK : PASTEL_BACKGROUND_COLORS_LIGHT;
    if (!publisher) return palette[0];

    const targetMap = sourceBackgroundMap[currentTheme];
    const targetIndexMap = sourceColorIndexMap[currentTheme];
    if (!targetMap.has(publisher)) {
      const index = targetIndexMap.size % palette.length;
      const chosen = palette[index];
      targetMap.set(publisher, chosen);
      targetIndexMap.set(publisher, index);
    }

    return targetMap.get(publisher);
  }

  function setHidden(el, hidden) {
    if (el) el.hidden = hidden;
  }

  function hideAllStates() {
    setHidden(stateEmpty, true);
    Object.keys(languageErrors).forEach((language) => {
      setLanguageError(language, false);
      setLanguageLoading(language, false);
    });
  }

  function isBlockedSource(article) {
    const host = resolveHost(article);
    return host && BLOCKED_HOSTS.has(host);
  }

  function filterAndDedup(results, seenKeys, language) {
    const unique = [];
    for (const article of results) {
      if (isBlockedSource(article)) continue;
      if (
        language === "en" &&
        (typeof article.country !== "string" ||
          article.country.toUpperCase() === NEWS_COUNTRY)
      ) {
        continue;
      }
      if (isDuplicate(article, seenKeys)) continue;
      markSeen(article, seenKeys);
      unique.push(article);
    }
    return unique;
  }

  function getNoImageFallbackBackground() {
    return currentTheme === "dark"
      ? "#45484f"
      : "linear-gradient(145deg, #ecece8 0%, #e2e2de 100%)";
  }

  function applyNoImageCardBackground(thumb, sourceLabel) {
    thumb.style.background = noImagePaletteEnabled
      ? getSourceBackgroundColor(sourceLabel)
      : getNoImageFallbackBackground();
  }

  function applyThemeToNoImageCards() {
    Object.values(newsGrids).forEach((grid) => {
      grid.querySelectorAll(".news-card-thumb.no-image").forEach((thumb) => {
        const sourceLabel = thumb.querySelector(".no-image-source")?.textContent?.trim();
        if (!sourceLabel) return;
        applyNoImageCardBackground(thumb, sourceLabel);
      });
    });
  }

  function createNewsCard(article, language) {
    const card = document.createElement("article");
    card.className = "news-card";

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "news-card-cover";
    previewButton.setAttribute(
      "aria-label",
      `${getDisplayText(article.title, "제목 없는 기사")} — 기사 요약 보기`
    );
    previewButton.addEventListener("click", () => openArticlePreview(article, previewButton, language));
    card.appendChild(previewButton);

    const thumb = document.createElement("div");
    thumb.className = "news-card-thumb";

    const hasImage = Boolean(article.image);
    if (!hasImage) {
      thumb.classList.add("no-image");
      const publisher = resolvePublisherName(article);
      applyNoImageCardBackground(thumb, publisher);

      const noImageSource = document.createElement("div");
      noImageSource.className = "no-image-source";
      noImageSource.textContent = publisher;
      noImageSource.setAttribute("aria-label", publisher);
      thumb.appendChild(noImageSource);
    }

    if (hasImage) {
      const img = document.createElement("img");
      img.src = article.image;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        thumb.classList.add("no-image");
        const publisher = resolvePublisherName(article);
        applyNoImageCardBackground(thumb, publisher);

        const noImageSource = document.createElement("div");
        noImageSource.className = "no-image-source";
        noImageSource.textContent = publisher;
        noImageSource.setAttribute("aria-label", publisher);
        thumb.appendChild(noImageSource);

        img.remove();
      });
      thumb.appendChild(img);
    }

    const placeholder = document.createElement("div");
    placeholder.className = "placeholder-icon";
    placeholder.innerHTML =
      '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M4 4h16v16H4V4z" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M4 16l4.5-5 3.5 3.5L16 10l4 4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/>' +
      "</svg>";
    thumb.appendChild(placeholder);

    card.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "news-card-body";

    const source = document.createElement("span");
    source.className = "news-card-source";
    source.textContent = resolvePublisherName(article);
    body.appendChild(source);

    const title = document.createElement("h2");
    title.className = "news-card-title";
    title.textContent = getDisplayText(article.title, "제목 없는 기사");
    body.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "news-card-desc";
    desc.textContent = getDisplayText(
      article.description,
      "이 기사에는 요약 설명이 제공되지 않습니다."
    );
    body.appendChild(desc);

    const footer = document.createElement("div");
    footer.className = "news-card-footer";

    const hostEl = document.createElement("span");
    hostEl.className = "news-card-host";
    hostEl.textContent = article.host ? article.host : "출처 미상";
    footer.appendChild(hostEl);

    const dateEl = document.createElement("time");
    dateEl.className = "news-card-date";
    if (article.published_at) dateEl.dateTime = article.published_at;
    dateEl.textContent = formatPublishedAt(article.published_at);
    footer.appendChild(dateEl);

    body.appendChild(footer);

    const linkHint = document.createElement("span");
    linkHint.className = "news-card-link-hint";
    linkHint.textContent = "원문 보기";
    body.appendChild(linkHint);

    card.appendChild(body);

    return card;
  }

  function renderArticles(articles, language, { append }) {
    const newsGrid = newsGrids[language];
    if (!append) newsGrid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    articles.forEach((article) => {
      fragment.appendChild(createNewsCard(article, language));
    });
    newsGrid.appendChild(fragment);
  }

  function updateStatusBar() {
    if (state.query) {
      statusBar.textContent = `'${state.query}' 검색 결과`;
    } else {
      statusBar.textContent = "최신 뉴스";
    }
  }

  function updateLoadMoreButton(language) {
    const languageState = state.languages[language];
    const loadMoreButton = loadMoreButtons[language];
    const show = languageState.hasMore && !state.isLoading && !languageState.isLoadingMore;
    setHidden(loadMoreButton, !show);
    loadMoreButton.disabled = false;
    loadMoreButton.textContent = "더 많은 뉴스 보기";
  }

  // API 호출

  function buildRequestUrl(query, language, offset) {
    const params = new URLSearchParams();
    const trimmed = query.trim();
    const searchQuery =
      language === "en"
        ? [trimmed, "Korea"].filter(Boolean).join(" ")
        : trimmed;

    if (searchQuery) {
      params.set("q", searchQuery);
      params.set("sort", "relevance");
    } else {
      params.set("sort", "date");
    }

    if (language === "ko") params.set("country", NEWS_COUNTRY);
    params.set("lang", language);
    params.set("size", String(PAGE_SIZE));
    params.set("full_text", "true");
    if (offset > 0) params.set("offset", String(offset));

    return `${API_ENDPOINT}?${params.toString()}`;
  }

  async function requestPage(query, language, offset, signal) {
    const response = await fetch(buildRequestUrl(query, language, offset), {
      method: "GET",
      signal,
    });

    if (!response.ok) {
      let detailMessage = `요청이 실패했습니다. (상태 코드: ${response.status})`;
      try {
        const errorBody = await response.json();
        if (errorBody && typeof errorBody.detail === "string") {
          detailMessage = errorBody.detail;
        } else if (errorBody && Array.isArray(errorBody.detail)) {
          detailMessage = errorBody.detail
            .map((d) => d.msg || JSON.stringify(d))
            .join(" / ");
        }
      } catch (_parseErr) {
        /* 기본 메시지 사용 */
      }

      if (response.status === 429) {
        detailMessage = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
      } else if (response.status >= 500) {
        detailMessage = "뉴스 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
      }

      const err = new Error(detailMessage);
      err.status = response.status;
      throw err;
    }

    let data;
    try {
      data = await response.json();
    } catch (_jsonErr) {
      throw new Error("서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    const results = Array.isArray(data.results) ? data.results : [];
    return {
      results,
      total: typeof data.total === "number" ? data.total : results.length,
      totalIsLowerBound: Boolean(data.total_is_lower_bound),
    };
  }

  async function collectFilteredArticles(query, language, startOffset, targetCount, signal) {
    const languageState = state.languages[language];
    const collected = [...languageState.leftover];
    // leftover는 이미 seenKeys에 등록된 상태이므로 그대로 사용
    languageState.leftover = [];

    let offset = startOffset;
    let attempts = 0;
    let lastTotal = languageState.total;
    let lastTotalIsLowerBound = languageState.totalIsLowerBound;
    let exhausted = false;

    while (collected.length < targetCount && attempts < MAX_FETCH_ATTEMPTS_PER_BATCH) {
      if (offset >= API_OFFSET_CAP) {
        exhausted = true;
        break;
      }

      const page = await requestPage(query, language, offset, signal);
      lastTotal = page.total;
      lastTotalIsLowerBound = page.totalIsLowerBound;

      const filtered = filterAndDedup(page.results, languageState.seenKeys, language);
      collected.push(...filtered);

      offset += page.results.length;
      attempts += 1;

      if (page.results.length === 0 || page.results.length < PAGE_SIZE || offset >= page.total) {
        exhausted = true;
        break;
      }
    }

    const articles = collected.slice(0, targetCount);
    const leftover = collected.slice(targetCount);

    return {
      articles,
      leftover,
      nextOffset: offset,
      total: lastTotal,
      totalIsLowerBound: lastTotalIsLowerBound,
      exhausted,
    };
  }

  async function fetchNews(query, language, { append = false } = {}) {
    if (activeControllers[language]) activeControllers[language].abort();
    activeControllers[language] = new AbortController();
    const languageState = state.languages[language];
    const { signal } = activeControllers[language];

    const trimmedQuery = query.trim();
    setLanguageLoading(language, true);

    if (!append) {
      state.query = trimmedQuery;
      languageState.apiOffset = 0;
      languageState.displayedCount = 0;
      languageState.hasMore = false;
      languageState.leftover = [];
      languageState.seenKeys = new Set();
      languageState.isLoadingMore = false;
      newsGrids[language].innerHTML = "";
    } else {
      if (languageState.isLoadingMore || state.isLoading) return;
      if (!languageState.hasMore && languageState.leftover.length === 0) return;
      languageState.isLoadingMore = true;
      loadMoreButtons[language].disabled = true;
      loadMoreButtons[language].textContent = "불러오는 중…";
    }

    try {
      const batch = await collectFilteredArticles(
        trimmedQuery,
        language,
        languageState.apiOffset,
        PAGE_SIZE,
        signal
      );

      if (signal.aborted) return;

      languageState.apiOffset = batch.nextOffset;
      languageState.total = batch.total;
      languageState.totalIsLowerBound = batch.totalIsLowerBound;
      languageState.leftover = batch.leftover;

      const apiHasMore =
        !batch.exhausted &&
        languageState.apiOffset < API_OFFSET_CAP &&
        languageState.apiOffset < languageState.total;
      languageState.hasMore = apiHasMore || languageState.leftover.length > 0;

      if (batch.articles.length === 0 && languageState.leftover.length === 0) {
        languageState.hasMore = false;
      }

      if (batch.articles.length > 0) {
        renderArticles(batch.articles, language, { append });
        languageState.displayedCount += batch.articles.length;
      }

      updateStatusBar();
      return batch.articles.length > 0;
    } catch (err) {
      if (err.name === "AbortError") return;
      setLanguageError(language, true);
      if (append) {
        loadMoreButtons[language].textContent = "다시 시도";
      }
      return false;
    } finally {
      setLanguageLoading(language, false);
      languageState.isLoadingMore = false;
      updateLoadMoreButton(language);
    }
  }

  async function loadNews(query) {
    state.isLoading = true;
    hideAllStates();
    Object.values(newsGrids).forEach((grid) => {
      grid.innerHTML = "";
    });
    Object.values(loadMoreButtons).forEach((button) => setHidden(button, true));

    const results = await Promise.all([
      fetchNews(query, "ko"),
      fetchNews(query, "en"),
    ]);

    state.isLoading = false;
    updateLoadMoreButton("ko");
    updateLoadMoreButton("en");
    updateStatusBar();
  }
   
  function triggerSearch(query) {
    clearTimeout(debounceTimer);
    resetButton.hidden = query.trim().length === 0;
    loadNews(query);
  }

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    triggerSearch(searchInput.value);
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    resetButton.hidden = searchInput.value.trim().length === 0;
    debounceTimer = setTimeout(() => {
      loadNews(searchInput.value);
    }, SEARCH_DEBOUNCE_MS);
  });

  resetButton.addEventListener("click", () => {
    searchInput.value = "";
    resetButton.hidden = true;
    triggerSearch("");
  });

  Object.values(retryButtons).forEach((button) => {
    button.addEventListener("click", () => {
      loadNews(state.query);
    });
  });

  Object.entries(loadMoreButtons).forEach(([language, button]) => {
    button.addEventListener("click", () => {
      fetchNews(state.query, language, { append: true });
    });
  });

  languageSwitchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveLanguage(button.dataset.language);
      try {
        localStorage.setItem(ACTIVE_LANGUAGE_STORAGE_KEY, button.dataset.language);
      } catch (error) {
        console.error("뉴스 언어 설정을 저장하지 못했습니다.", error);
      }
    });
  });

  function trimKoreanArticleAtCopyright(text) {
    const lines = text.split(/\r?\n/);
    const copyrightLineIndex = lines.findIndex((line) => /copyright|ⓒ|©/i.test(line));
    return copyrightLineIndex === -1 ? text : lines.slice(0, copyrightLineIndex + 1).join("\n");
  }

  function cleanArticleBody(text, language) {
    const source = language === "ko" ? trimKoreanArticleAtCopyright(text) : text;
    const normalized = source
      .replace(/\r\n?/g, "\n")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return normalized;
  }

  function openArticlePreview(article, trigger, language) {
    articlePreviewSource.textContent = resolvePublisherName(article);
    articlePreviewDate.textContent = article.published_at ? formatPublishedAt(article.published_at) : "날짜 정보 없음";
    articlePreviewDate.dateTime = article.published_at || "";
    articlePreviewTitle.textContent = getDisplayText(article.title, "제목 없는 기사");
    const articleText = getDisplayText(article.text, "") || getDisplayText(article.description, "");
    const cleanedArticleText = cleanArticleBody(articleText, language);
    const hasArticleContent = Boolean(cleanedArticleText);
    articlePreviewSummary.textContent = hasArticleContent
      ? cleanedArticleText
      : "이 기사에는 요약 설명이 제공되지 않습니다.";

    articlePreviewImage.hidden = true;
    articlePreviewImage.removeAttribute("src");
    if (article.image && hasArticleContent) {
      articlePreviewImage.onload = () => {
        articlePreviewImage.hidden = false;
      };
      articlePreviewImage.onerror = () => {
        articlePreviewImage.hidden = true;
        articlePreviewImage.removeAttribute("src");
      };
      articlePreviewImage.src = article.image;
    }

    if (article.url) {
      articlePreviewLink.href = article.url;
      articlePreviewLink.hidden = false;
      articlePreviewUrl.textContent = article.url;
      articlePreviewUrl.title = article.url;
      articlePreviewCopyButton.dataset.url = article.url;
      articlePreviewCopyButton.classList.remove("is-copied");
      articlePreviewCopyButton.setAttribute("aria-label", "기사 링크 복사");
      articlePreviewCopyButton.title = "기사 링크 복사";
      articlePreviewUrlWrap.hidden = false;
    } else {
      articlePreviewLink.removeAttribute("href");
      articlePreviewLink.hidden = true;
      articlePreviewUrl.textContent = "";
      articlePreviewUrl.removeAttribute("title");
      delete articlePreviewCopyButton.dataset.url;
      articlePreviewUrlWrap.hidden = true;
    }

    articlePreviewTrigger = trigger;
    articlePreviewPanel.hidden = false;
    document.documentElement.classList.add("article-preview-open");
    document.body.classList.add("article-preview-open");
    articlePreviewCloseButton.focus();
  }

  function closeArticlePreview() {
    if (articlePreviewPanel.hidden) return;

    articlePreviewPanel.hidden = true;
    document.documentElement.classList.remove("article-preview-open");
    document.body.classList.remove("article-preview-open");
    if (articlePreviewTrigger) articlePreviewTrigger.focus();
    articlePreviewTrigger = null;
  }

  articlePreviewCloseButton.addEventListener("click", closeArticlePreview);
  articlePreviewCopyButton.addEventListener("click", async () => {
    const url = articlePreviewCopyButton.dataset.url;
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      articlePreviewCopyButton.classList.add("is-copied");
      articlePreviewCopyButton.setAttribute("aria-label", "링크 복사됨");
      articlePreviewCopyButton.title = "링크 복사됨";
    } catch (error) {
      console.error("기사 링크를 클립보드에 복사하지 못했습니다.", error);
      articlePreviewCopyButton.setAttribute("aria-label", "링크 복사 실패");
      articlePreviewCopyButton.title = "링크 복사 실패";
    }

    setTimeout(() => {
      articlePreviewCopyButton.classList.remove("is-copied");
      articlePreviewCopyButton.setAttribute("aria-label", "기사 링크 복사");
      articlePreviewCopyButton.title = "기사 링크 복사";
    }, 1600);
  });
  articlePreviewPanel.addEventListener("click", (event) => {
    if (event.target === articlePreviewPanel) closeArticlePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (articlePreviewPanel.hidden) return;

    if (event.key === "Escape") {
      closeArticlePreview();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = [articlePreviewCloseButton];
    if (!articlePreviewLink.hidden) focusableElements.push(articlePreviewLink);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  });

  function openSettingsPanel() {
    if (settingsPanel) {
      settingsPanel.hidden = false;
      settingsButton.setAttribute("aria-expanded", "true");
      settingsButton.blur();
      document.documentElement.classList.add("settings-open");
      document.body.classList.add("settings-open");
    }
  }

  function closeSettingsPanel() {
    if (settingsPanel) {
      settingsPanel.hidden = true;
      settingsButton.setAttribute("aria-expanded", "false");
      settingsButton.blur();
      document.documentElement.classList.remove("settings-open");
      document.body.classList.remove("settings-open");
    }
  }

  function applyAccentColor(accentColor) {
    currentAccentColor = Object.prototype.hasOwnProperty.call(ACCENT_COLORS, accentColor)
      ? accentColor
      : "green";
    const [accent, accentDark, accentSoft, accentMid] =
      ACCENT_COLORS[currentAccentColor][currentTheme];

    document.body.dataset.accent = currentAccentColor;
    document.body.style.setProperty("--color-accent", accent);
    document.body.style.setProperty("--color-accent-dark", accentDark);
    document.body.style.setProperty("--color-accent-soft", accentSoft);
    document.body.style.setProperty("--color-accent-mid", accentMid);
    document.body.style.setProperty("--color-focus", accent);

    accentColorButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.accent === currentAccentColor));
    });
  }

  function getSavedAccentColor() {
    try {
      const savedAccentColor = localStorage.getItem(ACCENT_STORAGE_KEY);
      return Object.prototype.hasOwnProperty.call(ACCENT_COLORS, savedAccentColor)
        ? savedAccentColor
        : "green";
    } catch (error) {
      console.error("강조색 설정을 불러오지 못했습니다.", error);
      return "green";
    }
  }

  function getSavedTheme() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      return savedTheme === "dark" ? "dark" : "light";
    } catch (error) {
      console.error("모드 설정을 불러오지 못했습니다.", error);
      return "light";
    }
  }

  function getSavedNoImagePaletteEnabled() {
    try {
      const savedSetting = localStorage.getItem(NO_IMAGE_PALETTE_STORAGE_KEY);
      return savedSetting === "false" ? false : true;
    } catch (error) {
      console.error("이미지 없는 뉴스 배경색 설정을 불러오지 못했습니다.", error);
      return true;
    }
  }

  function setTheme(theme) {
    currentTheme = theme === "dark" ? "dark" : "light";
    document.body.dataset.theme = currentTheme;
    applyAccentColor(currentAccentColor);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    } catch (error) {
      console.error("모드 설정을 저장하지 못했습니다.", error);
    }

    themeChoiceButtons.forEach((button) => {
      const isActive = button.dataset.theme === currentTheme;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    themeChoiceButtons[0].closest(".theme-switcher").setAttribute("data-active-theme", currentTheme);
    applyThemeToNoImageCards();
  }

  function setNoImagePaletteEnabled(enabled) {
    noImagePaletteEnabled = Boolean(enabled);
    const usePalette = noImagePaletteEnabled;
    noImagePaletteToggle.classList.toggle("is-on", usePalette);
    noImagePaletteToggle.classList.toggle("is-off", !usePalette);
    noImagePaletteToggle.setAttribute("aria-pressed", String(usePalette));
    noImagePaletteToggle.querySelector(".toggle-text").textContent = usePalette ? "ON" : "OFF";
    try {
      localStorage.setItem(NO_IMAGE_PALETTE_STORAGE_KEY, String(usePalette));
    } catch (error) {
      console.error("이미지 없는 뉴스 배경색 설정을 저장하지 못했습니다.", error);
    }

    applyThemeToNoImageCards();
  }

  settingsButton.addEventListener("click", () => {
    if (settingsPanel.hidden) {
      openSettingsPanel();
    } else {
      closeSettingsPanel();
    }
  });

  settingsCloseButton.addEventListener("click", closeSettingsPanel);

  themeChoiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(button.dataset.theme);
    });
  });

  accentColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyAccentColor(button.dataset.accent);
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, currentAccentColor);
      } catch (error) {
        console.error("강조색 설정을 저장하지 못했습니다.", error);
      }
    });
  });

  noImagePaletteToggle.addEventListener("click", () => {
    const enabled = noImagePaletteToggle.getAttribute("aria-pressed") !== "true";
    setNoImagePaletteEnabled(enabled);
  });

  document.addEventListener("DOMContentLoaded", () => {
    setActiveLanguage(getSavedActiveLanguage());
    setTheme(getSavedTheme());
    applyAccentColor(getSavedAccentColor());
    setNoImagePaletteEnabled(getSavedNoImagePaletteEnabled());
    loadNews("");
  });
})();
