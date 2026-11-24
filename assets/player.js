(() => {
  "use strict";

  const CONFIG_URL = "https://player-central-config.pages.dev/config.json";
  const DEFAULT_SITE_TITLE = "My Video Player";
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
  const ALLOWED_VIDEO_HOSTS = new Set(["cdn.videy.co", "cdn2.videy.co"]);

  const params = new URLSearchParams(window.location.search);
  const rawVideoId = (params.get("mov") || "").trim().replace(/\.mp4$/i, "");

  const requestedVideoId = VIDEO_ID_PATTERN.test(rawVideoId) ? rawVideoId : "";

  const preview = document.getElementById("previewVideo");
  const playButton = document.getElementById("playButton");
  const title = document.getElementById("videoTitle");
  const previewMessage = document.getElementById("previewMessage");
  const popupMessage = document.getElementById("popupMessage");
  const lpAdTop = document.getElementById("lpAdTop");
  const lpAdBottom = document.getElementById("lpAdBottom");
  const previewPage = document.getElementById("previewPage");

  let activeConfig = null;
  let activeVideo = null;
  let activeVideoUrl = null;
  let activePageName = DEFAULT_SITE_TITLE;
  let configError = null;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isAllowedVideoUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }

    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" &&
        ALLOWED_VIDEO_HOSTS.has(url.hostname.toLowerCase()) &&
        /\.mp4$/i.test(url.pathname)
      );
    } catch (_) {
      return false;
    }
  }

  function isUsableScriptUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }

    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" &&
        !url.hostname.toLowerCase().endsWith(".invalid")
      );
    } catch (_) {
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Script/URL boleh ditempel dalam bentuk asli atau hasil Base64.
  function looksLikeBase64(value) {
    const compact = value.replace(/\s+/g, "");
    return (
      compact.length >= 16 &&
      /^[A-Za-z0-9+/=_-]+$/.test(compact) &&
      !/^https?:\/\//i.test(value.trim())
    );
  }

  function decodeBase64Text(value) {
    const compact = value
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
    const binary = atob(padded);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  }

  function decodeAdScript(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "";
    if (/<script[\s>]/i.test(raw)) return raw;
    try {
      if (!looksLikeBase64(raw)) return raw;
      const decoded = decodeBase64Text(raw);
      return /<script[\s>]/i.test(decoded) ? decoded.trim() : raw;
    } catch (_) {
      return raw;
    }
  }

  function decodeAdUrl(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    try {
      if (!looksLikeBase64(raw)) return raw;
      const decoded = decodeBase64Text(raw).trim();
      return /^https?:\/\//i.test(decoded) ? decoded : raw;
    } catch (_) {
      return raw;
    }
  }

  function getSiteTitle(config) {
    const configuredTitle = config.site?.title;

    if (typeof configuredTitle === "string" && configuredTitle.trim()) {
      return configuredTitle.trim();
    }

    return DEFAULT_SITE_TITLE;
  }

  function getPageName(config, video) {
    const pageId = typeof video.pageId === "string" ? video.pageId.trim() : "";

    // Selama video belum dikaitkan dengan halaman,
    // gunakan nama situs sebagai fallback sementara.
    if (!pageId) {
      return getSiteTitle(config);
    }

    if (!Array.isArray(config.pages)) {
      throw new Error("Daftar halaman tidak tersedia di konfigurasi pusat.");
    }

    const page = config.pages.find((item) => {
      return (
        isPlainObject(item) &&
        item.id === pageId &&
        item.enabled === true &&
        typeof item.name === "string" &&
        item.name.trim()
      );
    });

    if (!page) {
      throw new Error(
        "Halaman yang terhubung dengan video tidak ditemukan atau sedang OFF.",
      );
    }

    return page.name.trim();
  }

  function getVideoFromConfig(config) {
    if (!isPlainObject(config) || !Array.isArray(config.videos)) {
      throw new Error("Format konfigurasi video tidak valid.");
    }

    const configuredDefault =
      typeof config.site?.defaultVideoId === "string"
        ? config.site.defaultVideoId.trim()
        : "";

    const videoId = requestedVideoId || configuredDefault;

    if (!VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error("Video ID tidak valid atau belum tersedia.");
    }

    const video = config.videos.find((item) => {
      return (
        isPlainObject(item) && item.id === videoId && item.enabled === true
      );
    });

    if (!video) {
      throw new Error("Video tidak ditemukan atau sedang dinonaktifkan.");
    }

    if (!isAllowedVideoUrl(video.url)) {
      throw new Error("URL video tidak valid atau bukan CDN Videy.");
    }

    const pageName = getPageName(config, video);

    return {
      id: videoId,
      url: video.url,
      pageName,
    };
  }

  async function loadConfig() {
    const response = await fetch(CONFIG_URL, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Konfigurasi pusat gagal dimuat (HTTP ${response.status}).`,
      );
    }

    const config = await response.json();

    if (!isPlainObject(config)) {
      throw new Error("Konfigurasi pusat tidak valid.");
    }

    return config;
  }

  function showPreviewError(message) {
    preview.style.opacity = "0";
    previewMessage.textContent = message;
    previewMessage.hidden = false;
  }

  function initializePreview() {
    if (!activeVideo || !activeVideoUrl) {
      showPreviewError("Video belum tersedia.");
      playButton.disabled = true;
      playButton.setAttribute("aria-disabled", "true");
      return;
    }

    document.title = `${activePageName} - ${activeVideo.id}`;

    title.textContent = `Video ID: ${activeVideo.id}`;

    preview.src = activeVideoUrl;

    playButton.disabled = false;
    playButton.removeAttribute("aria-disabled");

    preview.addEventListener(
      "loadedmetadata",
      () => {
        const seekTo = Number.isFinite(preview.duration)
          ? Math.min(0.1, Math.max(0, preview.duration - 0.01))
          : 0.1;

        try {
          preview.currentTime = seekTo;
        } catch (_) {
          // Thumbnail preview bersifat opsional.
        }
      },
      { once: true },
    );

    preview.addEventListener(
      "error",
      () => {
        showPreviewError(
          "Pratinjau belum tersedia. Tekan Play untuk membuka video.",
        );
      },
      { once: true },
    );
  }

  function buildAdSlot(slotName, slotConfig) {
    if (
      !isPlainObject(slotConfig) ||
      slotConfig.enabled !== true ||
      typeof slotConfig.script !== "string" ||
      !slotConfig.script.trim()
    ) {
      return "";
    }

    const script = slotConfig.script.trim();

    return `
      <div
        class="ad-slot ad-${slotName}"
        aria-label="Iklan ${slotName === "top" ? "atas" : "bawah"}"
      >
        ${script}
      </div>
    `;
  }

  function buildPopunderScript(popunderConfig) {
    if (
      !isPlainObject(popunderConfig) ||
      popunderConfig.enabled !== true ||
      typeof popunderConfig.script !== "string" ||
      !popunderConfig.script.trim()
    ) {
      return "";
    }

    return decodeAdScript(popunderConfig.script);
  }

  function buildDirectLinkScript(directConfig) {
    if (
      !isPlainObject(directConfig) ||
      directConfig.enabled !== true ||
      typeof directConfig.url !== "string" ||
      !directConfig.url.trim()
    ) {
      return "";
    }

    const targetUrl = decodeAdUrl(directConfig.url);
    const serializedUrl = JSON.stringify(targetUrl).replace(/<\//g, "<\\/");

    return `
      <script>
        (function () {
          var directUrl = ${serializedUrl};
          var fired = false;

          document.addEventListener('click', function () {
            if (fired) return;
            fired = true;
            window.open(directUrl, '_blank');
          }, { once: true });
        })();
      </script>
    `;
  }

  function clearLpAdSlot(element) {
    if (!element) return;

    element.replaceChildren();
    element.style.minHeight = "";
    element.hidden = true;
  }

  // Menyisakan ruang untuk slot iklan supaya kartu 9:16 tidak pernah
  // mendorong tombol Play keluar layar.
  function setLpReserve(slots) {
    if (!previewPage) return;

    const gap = 8;
    const padding = 20;
    const total = slots.reduce((sum, item) => sum + item, 0);

    previewPage.style.setProperty(
      "--lp-ad-reserve",
      `${padding + slots.length * gap + total}px`,
    );
  }

  function syncLpReserve() {
    const slots = [lpAdTop, lpAdBottom]
      .filter((element) => element && !element.hidden)
      .map((element) => element.getBoundingClientRect().height);

    setLpReserve(slots);
  }

  function injectScriptHtml(container, html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;

    fragment.querySelectorAll("script").forEach((oldScript) => {
      const newScript = document.createElement("script");
      for (const attr of oldScript.attributes) {
        newScript.setAttribute(attr.name, attr.value);
      }
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });

    container.replaceChildren(fragment);
  }

  function mountLpAdSlot(element, slotConfig, label) {
    if (!element) return 0;

    const script = typeof slotConfig.script === "string" ? slotConfig.script.trim() : "";
    if (!script) return 0;

    element.replaceChildren();
    element.style.minHeight = "50px";
    element.setAttribute("aria-label", `Iklan ${label}`);
    element.hidden = false;

    injectScriptHtml(element, script);

    return element.getBoundingClientRect().height || 50;
  }

  function renderLpAds(config) {
    clearLpAdSlot(lpAdTop);
    clearLpAdSlot(lpAdBottom);

    const ads = isPlainObject(config?.ads) ? config.ads : null;
    const lp = ads && isPlainObject(ads.lp) ? ads.lp : null;

    // Iklan LP punya saklar sendiri, tidak ikut saklar iklan player.
    if (
      !lp ||
      lp.enabled !== true ||
      lp.banner === false ||
      typeof lp.script !== "string" ||
      !lp.script.trim()
    ) {
      setLpReserve([]);
    } else {
      const position = ["top", "bottom", "both"].includes(lp.position)
        ? lp.position
        : "top";

      const slots = [];

      if (position === "top" || position === "both") {
        slots.push(mountLpAdSlot(lpAdTop, lp, "atas"));
      }

      if (position === "bottom" || position === "both") {
        slots.push(mountLpAdSlot(lpAdBottom, lp, "bawah"));
      }

      setLpReserve(slots);
    }

    // Inject popunder script untuk LP
    const lpPopunderScript =
      lp && isPlainObject(lp.popunder) && lp.popunder.enabled === true
        ? decodeAdScript(lp.popunder.script)
        : "";

    if (lpPopunderScript) {
      const existing = document.getElementById("lp-popunder-script");
      if (existing) existing.remove();
      const container = document.createElement("div");
      container.id = "lp-popunder-script";
      container.hidden = true;
      injectScriptHtml(container, lpPopunderScript);
      document.body.appendChild(container);
    } else {
      const existing = document.getElementById("lp-popunder-script");
      if (existing) existing.remove();
    }

    // Direct link untuk LP: sekali per sesi saat tombol Play ditekan
    const lpDirectUrl =
      lp && isPlainObject(lp.direct) && lp.direct.enabled === true
        ? decodeAdUrl(lp.direct.url)
        : "";

    if (lpDirectUrl) {
      playButton.dataset.lpDirectUrl = lpDirectUrl;
    } else {
      delete playButton.dataset.lpDirectUrl;
    }
  }

  // Iklan bisa mengubah tinggi slotnya sendiri; reserve ikut disesuaikan.
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => syncLpReserve());
    if (lpAdTop) observer.observe(lpAdTop);
    if (lpAdBottom) observer.observe(lpAdBottom);
  }

  window.addEventListener("resize", syncLpReserve);

  function buildHistats(config, placement) {
    const histats = config.histats;

    if (
      !isPlainObject(histats) ||
      histats.enabled !== true ||
      typeof histats.script !== "string" ||
      !histats.script.trim()
    ) {
      return "";
    }

    const placementKey = placement === "lp" ? "lp" : "player";
    const placementEnabled = histats[placementKey] !== false;
    if (!placementEnabled) {
      return "";
    }

    return histats.script.trim();
  }

  function mountLpHistats(config) {
    const histats = isPlainObject(config?.histats) ? config.histats : null;
    if (
      !histats ||
      histats.enabled !== true ||
      typeof histats.script !== "string" ||
      !histats.script.trim() ||
      histats.lp === false
    ) {
      const existing = document.getElementById("lp-histats-script");
      if (existing) existing.remove();
      return;
    }

    const existing = document.getElementById("lp-histats-script");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "lp-histats-script";
    container.hidden = true;
    injectScriptHtml(container, histats.script.trim());
    document.body.appendChild(container);
  }

  function buildPlayerHtml() {
    const pageName = escapeHtml(activePageName);
    const videoId = escapeHtml(activeVideo.id);
    const videoUrl = escapeHtml(activeVideoUrl);

    const adsEnabled = activeConfig.ads?.enabled === true;
    const topAd = adsEnabled ? buildAdSlot("top", activeConfig.ads.top) : "";
    const bottomAd = adsEnabled ? buildAdSlot("bottom", activeConfig.ads.bottom) : "";
    const popunderScript = adsEnabled ? buildPopunderScript(activeConfig.ads.popunder) : "";
    const directLinkScript = adsEnabled ? buildDirectLinkScript(activeConfig.ads.direct) : "";

    const histatsScript = buildHistats(activeConfig, "player");

    return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#000000">

  <title>${pageName} - ${videoId}</title>

  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      width: 100%;
      min-height: 100%;
      overflow-x: hidden;
      background: #000;
      color: #fff;
    }

    body {
      font-family: Arial, Helvetica, sans-serif;
      padding: 12px 6px;
      -webkit-text-size-adjust: 100%;
    }

    main {
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .ad-slot {
      width: 100%;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      overflow: hidden;
    }

    .ad-top {
      min-height: 50px;
    }

    .ad-bottom {
      min-height: 250px;
    }

    .video-block {
      width: 100%;
      max-width: 450px;
      min-width: 0;
    }

    video {
      display: block;
      width: 100%;
      height: auto;
      max-height: 75vh;
      max-height: 75dvh;
      object-fit: contain;
      background: #000;
      border-radius: 6px;
    }

    #videoError {
      display: none;
      margin: 12px 8px 0;
      padding: 12px;
      border: 1px solid #555;
      border-radius: 6px;
      background: #191919;
      font-size: 14px;
      line-height: 1.5;
    }

    #videoError a {
      color: #91c8ff;
    }

    @media (max-width: 600px) {
      body {
        padding: 0;
      }

      main {
        max-width: none;
        gap: 8px;
      }

      .ad-top {
        padding-top: 4px;
      }

      .video-block {
        max-width: none;
        width: 100%;
      }

      video {
        width: 100%;
        height: auto;
        max-height: calc(100vh - 80px);
        max-height: calc(100dvh - 80px);
        object-fit: contain;
        border-radius: 0;
      }

      .ad-bottom {
        padding-bottom: 8px;
      }
    }

    @media (max-height: 520px) and (orientation: landscape) {
      video {
        max-height: 70vh;
        max-height: 70dvh;
      }
    }
  </style>
</head>

<body>
  <main>
    ${topAd}

    <div class="video-block">
      <video
        id="player"
        controls
        autoplay
        muted
        playsinline
        preload="metadata"
        src="${videoUrl}"
      >
        Browser Anda tidak mendukung video HTML5.
      </video>

      <div id="videoError" role="alert">
        Video gagal dimuat. Periksa URL Videy atau
        <a
          href="${videoUrl}"
          target="_blank"
          rel="noopener noreferrer"
        >buka MP4 langsung</a>.
      </div>
    </div>

    ${bottomAd}
  </main>

  ${popunderScript}

  ${directLinkScript}

  ${histatsScript}

  <script>
    (function () {
      var player = document.getElementById('player');
      var error = document.getElementById('videoError');

      player.addEventListener('error', function () {
        error.style.display = 'block';
      });

      var attempt = player.play();

      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(function () {
          // Pengunjung tetap dapat memakai kontrol Play.
        });
      }
    })();
  </script>
</body>
</html>`;
  }

  let lpDirectFired = false;

  function handlePlayClick() {
    popupMessage.hidden = true;

    // Direct link LP: buka sekali per sesi dari event klik pengguna.
    const lpDirectUrl = playButton.dataset.lpDirectUrl;
    if (!lpDirectFired && typeof lpDirectUrl === "string" && lpDirectUrl) {
      lpDirectFired = true;
      try {
        const directTab = window.open(lpDirectUrl, "_blank");
        if (directTab) directTab.opener = null;
      } catch (_) {
        // Jangan gagalkan membuka player.
      }
    }

    // Membuka tab langsung dari event klik pengguna.
    const newTab = window.open("about:blank", "_blank");

    if (!newTab) {
      popupMessage.hidden = false;
      return;
    }

    try {
      if (configError) {
        throw configError;
      }

      if (!activeConfig || !activeVideo || !activeVideoUrl) {
        throw new Error("Video belum tersedia atau belum diaktifkan.");
      }

      newTab.document.open();
      newTab.document.write(buildPlayerHtml());
      newTab.document.close();

      newTab.opener = null;
    } catch (error) {
      console.error("Gagal membuka player:", error);

      popupMessage.textContent =
        error.message || "Player gagal dibuka. Coba muat ulang halaman.";

      popupMessage.hidden = false;

      try {
        newTab.close();
      } catch (_) {
        // Tidak perlu tindakan tambahan.
      }
    }
  }

  playButton.addEventListener("click", handlePlayClick);

  loadConfig()
    .then((config) => {
      activeConfig = config;

      renderLpAds(config);

      mountLpHistats(config);

      activeVideo = getVideoFromConfig(config);

      activeVideoUrl = activeVideo ? activeVideo.url : null;

      activePageName = activeVideo
        ? activeVideo.pageName
        : getSiteTitle(config);

      initializePreview();
    })
    .catch((error) => {
      configError = error;

      console.error("Gagal memuat konfigurasi pusat:", error);

      document.title = DEFAULT_SITE_TITLE;

      clearLpAdSlot(lpAdTop);
      clearLpAdSlot(lpAdBottom);
      setLpReserve([]);

      showPreviewError(
        error.message || "Konfigurasi pusat belum dapat dimuat.",
      );

      title.textContent = DEFAULT_SITE_TITLE;

      playButton.disabled = true;
      playButton.setAttribute("aria-disabled", "true");
    });
})();
