/* ==========================================================================
   BRIEF — script.js
   화면 상태와 뉴스 검색 흐름을 조정하는 메인 컨트롤러
   - API 키/회원가입 불필요, CORS 허용, fetch()로 브라우저에서 직접 호출
   - 클라이언트 필터·중복 제거 후에도 화면에 보이는 카드는 항상 PAGE_SIZE(15) 단위
   ========================================================================== */

(() => {
  "use strict";

  // -------------------------------------------------------------------
  // 상수 / 설정
  // -------------------------------------------------------------------

  const API_ENDPOINT = "https://freenewsapi.ai/v1/search";
  const NEWS_COUNTRY = "KR";
  const PAGE_SIZE = 15;
  const SEARCH_DEBOUNCE_MS = 500;
  const SEARCH_HISTORY_STORAGE_KEY = "brief-search-history";
  const SEARCH_HISTORY_LIMIT = 10;
  const ACTIVE_LANGUAGE_STORAGE_KEY = "brief-active-language";
  const BLOCKED_HOSTS = new Set([
    "einpresswire.com",
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

  /** 필터·중복 제거로 결과가 거의 없을 때 무한 요청을 막기 위한 한 배치 최대 API 호출 수 */
  const MAX_FETCH_ATTEMPTS_PER_BATCH = 10;
  const API_OFFSET_CAP = 9900;

  // -------------------------------------------------------------------
  // DOM 참조
  // -------------------------------------------------------------------

  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
  const searchHistoryPanel = document.getElementById("search-history-panel");
  const searchHistoryList = document.getElementById("search-history-list");
  const resetButton = document.getElementById("reset-button");
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
  const languageEmptyMessages = {
    ko: document.getElementById("korean-news-empty"),
    en: document.getElementById("english-news-empty"),
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

  // -------------------------------------------------------------------
  // 상태
  // -------------------------------------------------------------------

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
  let searchHistory = getSavedSearchHistory();

  function getSavedSearchHistory() {
    try {
      const savedHistory = JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) || "[]");
      return Array.isArray(savedHistory)
        ? savedHistory.filter((query) => typeof query === "string").slice(0, SEARCH_HISTORY_LIMIT)
        : [];
    } catch (error) {
      console.error("검색 기록을 불러오지 못했습니다.", error);
      return [];
    }
  }

  function saveSearchHistory(query) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    searchHistory = [
      trimmedQuery,
      ...searchHistory.filter((savedQuery) => savedQuery !== trimmedQuery),
    ].slice(0, SEARCH_HISTORY_LIMIT);

    try {
      localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory));
    } catch (error) {
      console.error("검색 기록을 저장하지 못했습니다.", error);
    }
  }

  function renderSearchHistory() {
    const filter = searchInput.value.trim().toLocaleLowerCase();
    const matchingQueries = searchHistory.filter((query) =>
      !filter || query.toLocaleLowerCase().includes(filter)
    );
    searchHistoryList.replaceChildren();

    matchingQueries.forEach((query) => {
      const item = document.createElement("li");
      item.className = "search-history-item";

      const queryButton = document.createElement("button");
      queryButton.type = "button";
      queryButton.className = "search-history-query";
      queryButton.textContent = query;
      queryButton.addEventListener("click", () => {
        searchInput.value = query;
        resetButton.hidden = false;
        searchHistoryPanel.hidden = true;
        searchInput.setAttribute("aria-expanded", "false");
        triggerSearch(query);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "search-history-delete";
      deleteButton.setAttribute("aria-label", `검색 기록 삭제: ${query}`);
      const deleteIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      deleteIcon.setAttribute("viewBox", "0 0 24 24");
      deleteIcon.setAttribute("aria-hidden", "true");
      const deleteIconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      deleteIconPath.setAttribute("d", "m6 6 12 12M18 6 6 18");
      deleteIcon.appendChild(deleteIconPath);
      deleteButton.appendChild(deleteIcon);
      deleteButton.addEventListener("click", () => {
        searchHistory = searchHistory.filter((savedQuery) => savedQuery !== query);
        try {
          localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory));
        } catch (error) {
          console.error("검색 기록을 삭제하지 못했습니다.", error);
        }
        renderSearchHistory();
        searchInput.focus();
      });

      item.append(queryButton, deleteButton);
      searchHistoryList.appendChild(item);
    });

    const hasResults = matchingQueries.length > 0;
    searchHistoryPanel.hidden = !searchInput.matches(":focus") || !hasResults;
    searchInput.setAttribute("aria-expanded", String(!searchHistoryPanel.hidden));
  }

  searchHistoryPanel.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  searchHistoryPanel.addEventListener("click", (event) => {
    event.stopPropagation();
  });
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

  function setLanguageEmpty(language, visible) {
    languageEmptyMessages[language].hidden = !visible;
  }

  function setLanguageLoading(language, visible) {
    languageLoadings[language].hidden = !visible;
  }

  // -------------------------------------------------------------------
  // 유틸리티
  // -------------------------------------------------------------------

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

  /**
   * 중복 판별용 키 생성
   * - 같은 언론사(host) + 정규화한 제목 → URL만 다른 동일 기사 차단
   * - URL 자체도 정규화해 보조 키로 사용
   */
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
      // 쿼리·해시 제거, www. 제거, trailing slash 제거
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

  /** 기사 하나를 식별하는 중복 키들 (하나라도 이미 봤으면 중복) */
  function getDedupeKeys(article) {
    const keys = [];
    const host = resolveHost(article);
    const title = normalizeTitle(article.title);
    const urlKey = normalizeUrl(article.url);

    if (urlKey) keys.push(`url:${urlKey}`);
    if (host && title) keys.push(`ht:${host}|${title}`);
    // 제목만으로도 강한 일치가 있으면 (길이가 충분할 때) 차단
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
    const palette = settings.theme === "dark" ? PASTEL_BACKGROUND_COLORS_DARK : PASTEL_BACKGROUND_COLORS_LIGHT;
    if (!publisher) return palette[0];

    const targetMap = sourceBackgroundMap[settings.theme];
    const targetIndexMap = sourceColorIndexMap[settings.theme];
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
    const publisher = typeof article.sitename === "string" ? article.sitename : "";
    return (
      BLOCKED_HOSTS.has(host) ||
      host.endsWith(".einpresswire.com") ||
      /\bein\s*presswire\b/i.test(publisher)
    );
  }

  function isEnglishArticle(article) {
    const content = typeof article.text === "string" && article.text.trim()
      ? article.text
      : typeof article.description === "string"
        ? article.description
        : "";
    if (!content || /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(content)) return false;
    return (content.match(/[A-Za-z]/g) || []).length >= 20;
  }

  /** API 결과에서 중복 기사 제거 */
  function filterAndDedup(results, seenKeys, language) {
    const unique = [];
    for (const article of results) {
      if (isBlockedSource(article)) continue;
      if (
        language === "en" &&
        (typeof article.country !== "string" ||
          (article.country.toUpperCase() === NEWS_COUNTRY && !isEnglishArticle(article)))
      ) {
        continue;
      }
      if (language === "ko" && isEnglishArticle(article)) continue;
      if (isDuplicate(article, seenKeys)) continue;
      markSeen(article, seenKeys);
      unique.push(article);
    }
    return unique;
  }

  // -------------------------------------------------------------------
  // 렌더링
  // -------------------------------------------------------------------

  function getNoImageFallbackBackground() {
    return settings.theme === "dark"
      ? "#45484f"
      : "linear-gradient(145deg, #ecece8 0%, #e2e2de 100%)";
  }

  function applyNoImageCardBackground(thumb, sourceLabel) {
    thumb.style.background = settings.noImagePaletteEnabled
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

  const settings = window.BriefSettings.create({
    onVisualSettingsChange: applyThemeToNoImageCards,
  });
  const articlePreview = window.BriefArticlePreview.create({
    resolvePublisherName,
    formatPublishedAt,
    getDisplayText,
  });

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
    previewButton.addEventListener("click", () => articlePreview.open(article, previewButton, language));
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

  // -------------------------------------------------------------------
  // API 호출
  // -------------------------------------------------------------------

  function buildRequestUrl(query, language, offset) {
    const params = new URLSearchParams();
    const trimmed = query.trim();
    const searchQuery = language === "en"
      ? [trimmed, "Korea"].filter(Boolean).join(" ")
      : trimmed;

    if (searchQuery) {
      params.set("q", searchQuery);
      params.set("sort", trimmed ? "relevance" : "date");
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

  /**
   * 필터·중복 제거를 통과한 기사가 targetCount개가 될 때까지 API 페이지를 가져온다.
   * leftover는 먼저 소진하고, 새로 본 기사는 seenKeys에 기록한다.
   */
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
    const reclassifiedEnglish = [];

    while (collected.length < targetCount && attempts < MAX_FETCH_ATTEMPTS_PER_BATCH) {
      if (offset >= API_OFFSET_CAP) {
        exhausted = true;
        break;
      }

      const page = await requestPage(query, language, offset, signal);
      lastTotal = page.total;
      lastTotalIsLowerBound = page.totalIsLowerBound;

      const pageResults = language === "ko"
        ? page.results.filter((article) => {
          if (!isEnglishArticle(article)) return true;
          reclassifiedEnglish.push(article);
          return false;
        })
        : page.results;
      const filtered = filterAndDedup(pageResults, languageState.seenKeys, language);
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
      reclassifiedEnglish,
    };
  }

  function renderReclassifiedEnglishArticles(articles) {
    const englishState = state.languages.en;
    const uniqueArticles = articles.filter((article) => {
      if (isBlockedSource(article)) return false;
      if (isDuplicate(article, englishState.seenKeys)) return false;
      markSeen(article, englishState.seenKeys);
      return true;
    });

    if (uniqueArticles.length === 0) return;
    renderArticles(uniqueArticles, "en", { append: true });
    englishState.displayedCount += uniqueArticles.length;
  }

  async function fetchNews(query, language, { append = false } = {}) {
    if (activeControllers[language]) activeControllers[language].abort();
    activeControllers[language] = new AbortController();
    const languageState = state.languages[language];
    const { signal } = activeControllers[language];

    const trimmedQuery = query.trim();
    setLanguageLoading(language, true);
    setLanguageEmpty(language, false);

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

      setLanguageError(language, false);
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
      if (batch.reclassifiedEnglish.length > 0) {
        renderReclassifiedEnglishArticles(batch.reclassifiedEnglish);
      }

      setLanguageEmpty(
        language,
        Boolean(trimmedQuery) &&
          languageState.displayedCount === 0 &&
          languageErrors[language].hidden
      );
      updateStatusBar();
      return batch.articles.length > 0;
    } catch (err) {
      if (err.name === "AbortError") return;
      setLanguageEmpty(language, false);
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

  // -------------------------------------------------------------------
  // 이벤트 바인딩
  // -------------------------------------------------------------------

  function triggerSearch(query) {
    clearTimeout(debounceTimer);
    saveSearchHistory(query);
    searchHistoryPanel.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
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
    renderSearchHistory();
    debounceTimer = setTimeout(() => {
      saveSearchHistory(searchInput.value);
      renderSearchHistory();
      loadNews(searchInput.value);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput.addEventListener("focus", renderSearchHistory);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !searchHistoryPanel.hidden) {
      searchHistoryPanel.hidden = true;
      searchInput.setAttribute("aria-expanded", "false");
    } else if (event.key === "ArrowDown" && !searchHistoryPanel.hidden) {
      event.preventDefault();
      searchHistoryList.querySelector(".search-history-query")?.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!searchForm.contains(event.target)) {
      searchHistoryPanel.hidden = true;
      searchInput.setAttribute("aria-expanded", "false");
    }
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

  document.addEventListener("DOMContentLoaded", () => {
    setActiveLanguage(getSavedActiveLanguage());
    settings.initialize();
    loadNews("");
  });
})();
