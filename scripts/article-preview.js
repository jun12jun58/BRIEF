(() => {
  "use strict";

  function trimKoreanArticleAtCopyright(text) {
    const lines = text.split(/\r?\n/);
    const copyrightLineIndex = lines.findIndex((line) => /copyright|ⓒ|©/i.test(line));
    return copyrightLineIndex === -1 ? text : lines.slice(0, copyrightLineIndex + 1).join("\n");
  }

  function cleanArticleBody(text, language) {
    const source = language === "ko" ? trimKoreanArticleAtCopyright(text) : text;
    return source
      .replace(/\r\n?/g, "\n")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .split("\n")
      .filter((line) => {
        const trimmedLine = line.trim();
        return trimmedLine.length === 0 || [...trimmedLine].length > 3;
      })
      .join("\n")
      .trim();
  }

  function create({ resolvePublisherName, formatPublishedAt, getDisplayText }) {
    const panel = document.getElementById("article-preview-panel");
    const settingsButton = document.getElementById("settings-button");
    const card = panel.querySelector(".article-preview-card");
    const scrollContainer = panel.querySelector(".article-preview-scroll");
    const content = panel.querySelector(".article-preview-content");
    const closeButton = document.getElementById("article-preview-close");
    const source = document.getElementById("article-preview-source");
    const date = document.getElementById("article-preview-date");
    const title = document.getElementById("article-preview-title");
    const summary = document.getElementById("article-preview-summary");
    const image = document.getElementById("article-preview-image");
    const imageViewer = document.getElementById("article-image-viewer");
    const imageViewerImage = document.getElementById("article-image-viewer-image");
    const imageViewerCloseButton = document.getElementById("article-image-viewer-close");
    const urlWrap = document.getElementById("article-preview-url-wrap");
    const urlText = document.getElementById("article-preview-url");
    const copyButton = document.getElementById("article-preview-copy");
    const articleLink = document.getElementById("article-preview-link");
    let trigger = null;

    function resetScrollPosition() {
      panel.scrollTop = 0;
      card.scrollTop = 0;
      scrollContainer.scrollTop = 0;
    }

    function updateImageLayout() {
      if (image.hidden || !image.naturalWidth || !image.naturalHeight) {
        content.classList.remove("has-stacked-image");
        return;
      }

      const contentStyle = getComputedStyle(content);
      const summaryStyle = getComputedStyle(summary);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("기사 이미지 배치를 계산하기 위한 캔버스를 만들지 못했습니다.");
      }
      context.font = summaryStyle.font;
      const minimumTextWidth = context.measureText("가".repeat(15)).width;
      const availableWidth =
        content.clientWidth -
        parseFloat(contentStyle.paddingLeft) -
        parseFloat(contentStyle.paddingRight);
      const floatedImageWidth = image.naturalWidth * (200 / image.naturalHeight);
      const remainingTextWidth = availableWidth - floatedImageWidth - 16;

      content.classList.toggle("has-stacked-image", remainingTextWidth < minimumTextWidth);
    }

    function updateContentLayout() {
      updateImageLayout();
    }

    function close() {
      if (panel.hidden) return;

      closeImageViewer(false);
      panel.hidden = true;
      resetScrollPosition();
      document.documentElement.classList.remove("article-preview-open");
      document.body.classList.remove("article-preview-open");
      settingsButton.disabled = false;
      if (trigger) trigger.focus();
      trigger = null;
    }

    function openImageViewer() {
      if (image.hidden || !image.src) return;

      imageViewerImage.src = image.currentSrc || image.src;
      imageViewer.hidden = false;
      imageViewerCloseButton.focus({ preventScroll: true });
    }

    function closeImageViewer(restoreFocus = true) {
      if (imageViewer.hidden) return;

      imageViewer.hidden = true;
      imageViewerImage.removeAttribute("src");
      if (restoreFocus && !image.hidden) image.focus({ preventScroll: true });
    }

    function open(article, opener, language) {
      resetScrollPosition();
      source.textContent = resolvePublisherName(article);
      date.textContent = article.published_at ? formatPublishedAt(article.published_at) : "날짜 정보 없음";
      date.dateTime = article.published_at || "";
      title.textContent = getDisplayText(article.title, "제목 없는 기사");
      const articleText = getDisplayText(article.text, "") || getDisplayText(article.description, "");
      const cleanedArticleText = cleanArticleBody(articleText, language);
      const hasArticleContent = Boolean(cleanedArticleText);
      const displayedArticleText = language === "en" && /[A-Za-z]$/.test(cleanedArticleText)
        ? `${cleanedArticleText}...`
        : cleanedArticleText;
      summary.textContent = hasArticleContent
        ? displayedArticleText
        : "본문 내용이 제공되지 않습니다.";

      image.hidden = true;
      image.removeAttribute("src");
      content.classList.remove("has-stacked-image");
      if (article.image && hasArticleContent) {
        image.onload = () => {
          image.hidden = false;
          updateContentLayout();
        };
        image.onerror = () => {
          image.hidden = true;
          image.removeAttribute("src");
          content.classList.remove("has-stacked-image");
          updateContentLayout();
        };
        image.src = article.image;
      }

      if (article.url) {
        articleLink.href = article.url;
        articleLink.hidden = false;
        urlText.textContent = article.url;
        urlText.title = article.url;
        copyButton.dataset.url = article.url;
        copyButton.classList.remove("is-copied");
        copyButton.setAttribute("aria-label", "기사 링크 복사");
        copyButton.title = "기사 링크 복사";
        urlWrap.hidden = false;
      } else {
        articleLink.removeAttribute("href");
        articleLink.hidden = true;
        urlText.textContent = "";
        urlText.removeAttribute("title");
        delete copyButton.dataset.url;
        urlWrap.hidden = true;
      }

      trigger = opener;
      panel.hidden = false;
      settingsButton.disabled = true;
      document.documentElement.classList.add("article-preview-open");
      document.body.classList.add("article-preview-open");
      closeButton.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        resetScrollPosition();
        updateContentLayout();
      });
    }

    closeButton.addEventListener("click", close);
    image.addEventListener("click", openImageViewer);
    image.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      openImageViewer();
    });
    imageViewerCloseButton.addEventListener("click", () => closeImageViewer());
    imageViewer.addEventListener("click", (event) => {
      if (event.target === imageViewer) closeImageViewer();
    });
    window.addEventListener("resize", updateContentLayout);
    copyButton.addEventListener("click", async () => {
      const url = copyButton.dataset.url;
      if (!url) return;

      try {
        await navigator.clipboard.writeText(url);
        copyButton.classList.add("is-copied");
        copyButton.setAttribute("aria-label", "링크 복사됨");
        copyButton.title = "링크 복사됨";
      } catch (error) {
        console.error("기사 링크를 클립보드에 복사하지 못했습니다.", error);
        copyButton.setAttribute("aria-label", "링크 복사 실패");
        copyButton.title = "링크 복사 실패";
      }

      setTimeout(() => {
        copyButton.classList.remove("is-copied");
        copyButton.setAttribute("aria-label", "기사 링크 복사");
        copyButton.title = "기사 링크 복사";
      }, 1600);
    });
    panel.addEventListener("click", (event) => {
      if (event.target === panel) close();
    });
    document.addEventListener("keydown", (event) => {
      if (panel.hidden) return;

      if (!imageViewer.hidden) {
        if (event.key === "Escape") {
          closeImageViewer();
        } else if (event.key === "Tab") {
          event.preventDefault();
          imageViewerCloseButton.focus();
        }
        return;
      }

      if (event.key === "Escape") {
        close();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = [closeButton];
      if (!urlWrap.hidden) focusableElements.push(copyButton);
      if (!articleLink.hidden) focusableElements.push(articleLink);
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

    return { open };
  }

  window.BriefArticlePreview = { create };
})();
