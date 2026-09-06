/* ==========================================================================
   BRIEF — script.js
   Free News API (https://freenewsapi.ai) 연동 로직
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
  /** 필터·중복 제거로 결과가 거의 없을 때 무한 요청을 막기 위한 한 배치 최대 API 호출 수 */
  const MAX_FETCH_ATTEMPTS_PER_BATCH = 10;
  const API_OFFSET_CAP = 9900;

  // -------------------------------------------------------------------
  // DOM 참조
  // -------------------------------------------------------------------

  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
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

  // -------------------------------------------------------------------
  // 유틸리티
  // -------------------------------------------------------------------

  function formatPublishedAt(isoString) {
    if (!isoString) return "날짜 정보 없음";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "날짜 정보 없음";

    try {
      return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    } catch (_err) {
      return date.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul"
      });
    }
  }

  function resolvePublisherName(article) {
    if (article.sitename && article.sitename.trim()) return article.sitename.trim();
    if (article.host) return article.host;
    return "알 수 없는 언론사";
  }

  /**
   * 중복 판별용 키 생성
   * - 같은 언론사(host) + 정규화한 제목 → URL만 다른 동일 기사 차단
   * - URL 자체도 정규화해 보조 키로 사용
   */
  function normalizeTitle(title) {
    if (!title || typeof title !== "string") return "";
    return title
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[“”"']/g, "")
      .replace(/[…·•]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== "string") return "";
    try {
      const u = new URL(url);
      // 쿼리·해시 제거, www. 제거, trailing slash 제거
      let path = u.pathname.replace(/\/+$/, "") || "/";
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return `${host}${path}`;
    } catch (_err) {
      return url.trim().toLowerCase();
    }
  }

  function resolveHost(article) {
    if (article.host && typeof article.host === "string") {
      return article.host.replace(/^www\./, "").toLowerCase().trim();
    }
    if (article.url) {
      try {
        return new URL(article.url).hostname.replace(/^www\./, "").toLowerCase();
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

  /** API 결과에서 중복 기사 제거 */
  function filterAndDedup(results, seenKeys) {
    const unique = [];
    for (const article of results) {
      if (isDuplicate(article, seenKeys)) continue;
      markSeen(article, seenKeys);
      unique.push(article);
    }
    return unique;
  }

  // -------------------------------------------------------------------
  // 렌더링
  // -------------------------------------------------------------------

  function createNewsCard(article) {
    const card = document.createElement("article");
    card.className = "news-card";

    const coverLink = document.createElement("a");
    coverLink.className = "news-card-cover";
    coverLink.href = article.url || "#";
    coverLink.target = "_blank";
    coverLink.rel = "noopener noreferrer";
    coverLink.setAttribute(
      "aria-label",
      `${article.title || "제목 없는 기사"} — 원문 기사 열기`
    );
    card.appendChild(coverLink);

    const thumb = document.createElement("div");
    thumb.className = "news-card-thumb";

    const hasImage = Boolean(article.image);
    if (!hasImage) thumb.classList.add("no-image");

    if (hasImage) {
      const img = document.createElement("img");
      img.src = article.image;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        thumb.classList.add("no-image");
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
    title.textContent = article.title || "제목 없는 기사";
    body.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "news-card-desc";
    desc.textContent =
      article.description && article.description.trim()
        ? article.description.trim()
        : "이 기사에는 요약 설명이 제공되지 않습니다.";
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
      fragment.appendChild(createNewsCard(article));
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

    if (trimmed) {
      params.set("q", trimmed);
      params.set("sort", "relevance");
    } else {
      params.set("sort", "date");
    }

    params.set("country", NEWS_COUNTRY);
    params.set("lang", language);
    params.set("size", String(PAGE_SIZE));
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

    while (collected.length < targetCount && attempts < MAX_FETCH_ATTEMPTS_PER_BATCH) {
      if (offset >= API_OFFSET_CAP) {
        exhausted = true;
        break;
      }

      const page = await requestPage(query, language, offset, signal);
      lastTotal = page.total;
      lastTotalIsLowerBound = page.totalIsLowerBound;

      const filtered = filterAndDedup(page.results, languageState.seenKeys);
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

  // -------------------------------------------------------------------
  // 이벤트 바인딩
  // -------------------------------------------------------------------

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
    });
  });

  document.addEventListener("DOMContentLoaded", () => {
    loadNews("");
  });
})();
