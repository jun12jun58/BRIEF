(() => {
  "use strict";

  const ACCENT_STORAGE_KEY = "brief-accent-color";
  const THEME_STORAGE_KEY = "brief-theme";
  const NO_IMAGE_PALETTE_STORAGE_KEY = "brief-no-image-palette";
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

  function create({ onVisualSettingsChange }) {
    const settingsButton = document.getElementById("settings-button");
    const settingsPanel = document.getElementById("settings-panel");
    const settingsCloseButton = document.getElementById("settings-close");
    const themeChoiceButtons = Array.from(document.querySelectorAll(".theme-choice"));
    const accentColorButtons = Array.from(document.querySelectorAll(".accent-color-choice"));
    const noImagePaletteToggle = document.getElementById("no-image-palette-toggle");
    let currentTheme = "light";
    let currentAccentColor = "green";
    let noImagePaletteEnabled = true;

    function openSettingsPanel() {
      if (!settingsPanel) return;
      settingsPanel.hidden = false;
      settingsButton.setAttribute("aria-expanded", "true");
      settingsButton.blur();
      document.documentElement.classList.add("settings-open");
      document.body.classList.add("settings-open");
    }

    function closeSettingsPanel() {
      if (!settingsPanel) return;
      settingsPanel.hidden = true;
      settingsButton.setAttribute("aria-expanded", "false");
      settingsButton.blur();
      document.documentElement.classList.remove("settings-open");
      document.body.classList.remove("settings-open");
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
      onVisualSettingsChange();
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

      onVisualSettingsChange();
    }

    settingsButton.addEventListener("click", () => {
      if (settingsPanel.hidden) openSettingsPanel();
      else closeSettingsPanel();
    });
    settingsCloseButton.addEventListener("click", closeSettingsPanel);
    themeChoiceButtons.forEach((button) => {
      button.addEventListener("click", () => setTheme(button.dataset.theme));
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
      setNoImagePaletteEnabled(noImagePaletteToggle.getAttribute("aria-pressed") !== "true");
    });

    return {
      get theme() {
        return currentTheme;
      },
      get noImagePaletteEnabled() {
        return noImagePaletteEnabled;
      },
      initialize() {
        setTheme(getSavedTheme());
        applyAccentColor(getSavedAccentColor());
        setNoImagePaletteEnabled(getSavedNoImagePaletteEnabled());
      },
    };
  }

  window.BriefSettings = { create };
})();
