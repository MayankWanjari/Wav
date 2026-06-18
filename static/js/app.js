// =============================================================
//  MediaForge — Complete Frontend Application
//  ES6+ · No dependencies · Fetch API
// =============================================================

(function () {
  "use strict";

  // ===========================================================
  //  1. DOM REFERENCES
  // ===========================================================
  const $ = (id) => document.getElementById(id);

  const dom = {
    form:           $("download-form"),
    urlInput:       $("url-input"),
    downloadBtn:    $("download-btn"),
    convertLabel:   $("convert-label"),
    pasteBtn:       $("paste-btn"),

    platformBadge:  $("platform-badge"),
    platformDot:    $("platform-dot"),
    platformText:   $("platform-text"),
    formatGroup:    $("format-group"),
    qualitySelect:  $("quality-select"),
    customSelectContainer: $("custom-select-container"),
    customSelectTrigger:   $("custom-select-trigger"),
    customSelectValue:     $("custom-select-value"),
    customSelectArrow:     $("custom-select-arrow"),
    customSelectOptions:   $("custom-select-options"),

    downloadCard:   $("download-card"),
    statusCard:     $("status-card"),
    statusText:     $("status-text"),
    progressFill:   $("progress-fill"),

    resultCard:     $("result-card"),
    resultTitle:    $("result-title"),
    resultFilename: $("result-filename"),
    resultDownload: $("result-download"),
    resultDownloadText: $("result-download-text"),
    newDownloadBtn: $("new-download-btn"),

    errorCard:      $("error-card"),
    errorMessage:   $("error-message"),
    retryBtn:       $("retry-btn"),

    historySection: $("history-section"),
    historyList:    $("history-list"),
    clearHistoryBtn:$("clear-history-btn"),
    historyEmpty:   $("history-empty"),

    addToQueueBtn:  $("add-to-queue-btn"),
    queueSection:   $("queue-section"),
    queueList:      $("queue-list"),
    queueCount:     $("queue-count"),
    startQueueBtn:  $("start-queue-btn"),
    clearQueueBtn:  $("clear-queue-btn"),

    diskStats:      $("disk-stats"),

    tagEditor:      $("tag-editor"),
    tagTitle:       $("tag-title"),
    tagArtist:      $("tag-artist"),
    tagAlbum:       $("tag-album"),
    applyTagsBtn:   $("apply-tags-btn"),

    confettiCanvas: $("confetti-canvas"),
    toastContainer: $("toast-container"),
  };

  // ===========================================================
  //  2. CONSTANTS & PATTERNS
  // ===========================================================
  const PLATFORM_PATTERNS = {
    youtube: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|playlist\?list=)|youtu\.be\/)/i,
    spotify: /(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|album|playlist)\//i,
  };

  const PLATFORM_LABELS = {
    youtube: "YouTube Detected",
    spotify: "Spotify Detected",
    generic: "Media Link Detected",
  };

  const HISTORY_KEY  = "mediaforge_history";
  const MAX_HISTORY  = 10;
  const TIMEOUT_MS   = 1800_000; // 30 minutes

  // ===========================================================
  //  3. STATE
  // ===========================================================
  let currentState   = "idle"; // idle | detecting | loading | success | error
  let progressTimer  = null;
  let progress       = 0;
  let abortCtrl      = null;

  let currentMediaSizes = { audio: {}, video: {} };
  let currentInfoAbortCtrl = null;

  let loadedSpotifyTracks = null;
  let spotifyPreviewUrl = "";
  let currentMatchingTrackIndex = null;

  // queue
  let downloadQueue  = [];
  let isQueueRunning = false;

  // tag editor
  let currentTagFilename = null;

  // server-side history cache
  let historyCache = [];

  // ===========================================================
  //  4. UTILITY HELPERS
  // ===========================================================
  const show = (el) => { if (el) el.classList.remove("hidden"); };
  const hide = (el) => { if (el) el.classList.add("hidden"); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectPlatform(url) {
    if (!url) return null;
    for (const [name, re] of Object.entries(PLATFORM_PATTERNS)) {
      if (re.test(url)) return name;
    }
    if (isValidUrl(url)) return "generic";
    return null;
  }

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_");
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // ===========================================================
  //  4b. TOAST & SOUND
  // ===========================================================
  function showToast(message, type = "info") {
    if (!dom.toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    
    let icon = "";
    if (type === "success") icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    else if (type === "error") icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    else icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

    toast.innerHTML = `${icon}<span>${message}</span>`;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast--closing");
      toast.addEventListener("transitionend", () => toast.remove());
    }, 4000);
  }

  function playSuccessSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1); // C6
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      // AudioContext not supported or blocked
    }
  }

  // ===========================================================
  //  5. PLATFORM BADGE
  // ===========================================================
  async function performSearch(query) {
    const searchSection = document.getElementById("search-section");
    const searchList = document.getElementById("search-results-list");
    if (!searchSection || !searchList) return;

    show(searchSection);
    searchList.innerHTML = `
      <div class="text-center py-8 font-label-sm animate-pulse">
        Mining YouTube block indexes... ⛏️
      </div>`;
    
    searchSection.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await response.json();

      if (data.success && data.results && data.results.length > 0) {
        renderSearchResults(data.results);
      } else {
        searchList.innerHTML = `
          <div class="text-center py-8 font-body-lg text-red-500 bg-red-50 dark:bg-red-950/20 border-4 border-red-500 p-4">
            No results found. Try a different query!
          </div>`;
      }
    } catch (err) {
      searchList.innerHTML = `
        <div class="text-center py-8 font-body-lg text-red-500 bg-red-50 dark:bg-red-950/20 border-4 border-red-500 p-4">
          Failed to load search results. Please verify connection and try again.
        </div>`;
    }
  }

  function renderSearchResults(results) {
    const searchList = document.getElementById("search-results-list");
    if (!searchList) return;

    searchList.innerHTML = results.map((item, index) => {
      const title = escapeHtml(item.title);
      const uploader = escapeHtml(item.uploader);
      const views = item.view_count ? `${Number(item.view_count).toLocaleString()} views` : "";
      const metaStr = views ? `${uploader} · ${views}` : uploader;
      
      return `
        <div class="search-card" style="animation-delay: ${index * 0.05}s">
          <div class="search-card__thumb-container">
            <img class="search-card__thumb" src="${item.thumbnail}" alt="${title}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23000%22/></svg>'">
            ${item.duration ? `<span class="search-card__duration">${item.duration}</span>` : ""}
          </div>
          <div class="search-card__info">
            <h4 class="search-card__title">${title}</h4>
            <span class="search-card__meta">${metaStr}</span>
          </div>
          <div class="search-card__actions">
            <button type="button" class="neo-button bg-primary-container text-[#005e2d] hover:bg-primary-fixed-dim px-4 py-2 font-label-sm search-select-btn" data-url="${item.url}">
              SELECT
            </button>
          </div>
        </div>
      `;
    }).join("");

    searchList.querySelectorAll(".search-select-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        dom.urlInput.value = url;
        updatePlatformBadge(url);
        
        dom.downloadCard.scrollIntoView({ behavior: "smooth", block: "center" });
        dom.urlInput.classList.add("input-pulse");
        setTimeout(() => dom.urlInput.classList.remove("input-pulse"), 500);

        const searchSection = document.getElementById("search-section");
        if (searchSection) hide(searchSection);
      });
    });
  }

  function updatePlatformBadge(url) {
    const trimmed = url.trim();
    const platform = detectPlatform(trimmed);
    const downloadBtn = dom.downloadBtn;

    // Reset button states
    if (downloadBtn) {
      downloadBtn.classList.remove("bg-[#fd9e70]", "hover:bg-[#ffb693]", "text-on-background", "search-mode-active");
      downloadBtn.classList.add("bg-primary-container", "hover:bg-primary-fixed-dim", "text-[#005e2d]");
    }

    if (platform) {
      if (dom.convertLabel) dom.convertLabel.textContent = "RIP IT!";
      dom.platformBadge.classList.remove("platform-tag--youtube", "platform-tag--spotify", "platform-tag--generic");
      dom.platformBadge.classList.add("platform-tag", `platform-tag--${platform}`);
      dom.platformText.textContent = PLATFORM_LABELS[platform];
      show(dom.platformBadge);
      
      if (platform === "spotify") {
        hide(dom.formatGroup);
        setState("detecting");
        fetchSpotifyPreview(trimmed);
      } else {
        // Hide preview container when non-spotify URL is entered
        const previewSection = $("spotify-preview-section");
        if (previewSection) hide(previewSection);
        loadedSpotifyTracks = null;
        spotifyPreviewUrl = "";

        if (platform === "youtube" || platform === "generic") {
          show(dom.formatGroup);
          const audioBtn = document.querySelector('.format-btn[value="audio"]');
          if (audioBtn && window.toggleFormat) window.toggleFormat(audioBtn);
        }
        
        setState("detecting");
        fetchMediaSizes(trimmed);
      }
    } else {
      hide(dom.platformBadge);
      hide(dom.formatGroup);
      const previewSection = $("spotify-preview-section");
      if (previewSection) hide(previewSection);
      loadedSpotifyTracks = null;
      spotifyPreviewUrl = "";

      if (currentState === "detecting") setState("idle");

      if (trimmed.length > 0 && !isValidUrl(trimmed)) {
        if (dom.convertLabel) dom.convertLabel.textContent = "SEARCH YOUTUBE";
        if (downloadBtn) {
          downloadBtn.classList.remove("bg-primary-container", "hover:bg-primary-fixed-dim", "text-[#005e2d]");
          downloadBtn.classList.add("bg-[#fd9e70]", "hover:bg-[#ffb693]", "text-on-background", "search-mode-active");
        }
      } else {
        if (dom.convertLabel) dom.convertLabel.textContent = "RIP IT!";
      }
    }
  }

  // ===========================================================
  //  6. STATE MANAGEMENT
  // ===========================================================
  function setState(next) {
    currentState = next;

    switch (next) {
      case "idle":
      case "detecting":
        show(dom.downloadCard);
        hide(dom.statusCard);
        hide(dom.resultCard);
        hide(dom.errorCard);
        dom.downloadBtn.disabled = false;
        dom.urlInput.disabled = false;
        dom.progressFill.style.width = "0%";
        break;

      case "loading":
        hide(dom.downloadCard);
        show(dom.statusCard);
        hide(dom.resultCard);
        hide(dom.errorCard);
        dom.downloadBtn.disabled = true;
        dom.urlInput.disabled = true;
        break;

      case "success":
        hide(dom.downloadCard);
        hide(dom.statusCard);
        show(dom.resultCard);
        hide(dom.errorCard);
        break;

      case "error":
        hide(dom.downloadCard);
        hide(dom.statusCard);
        hide(dom.resultCard);
        show(dom.errorCard);
        break;
    }
  }

  function resetToIdle() {
    dom.urlInput.value = "";
    if (currentInfoAbortCtrl) currentInfoAbortCtrl.abort();
    currentMediaSizes = { audio: {}, video: {} };

    hide(dom.platformBadge);
    const previewSection = $("spotify-preview-section");
    if (previewSection) hide(previewSection);
    loadedSpotifyTracks = null;
    spotifyPreviewUrl = "";

    hide(dom.tagEditor);
    currentTagFilename = null;

    const audioBtn = document.querySelector('.format-btn[value="audio"]');
    if (audioBtn && window.toggleFormat) window.toggleFormat(audioBtn);
    updateQualityOptions();
    setState("idle");
    dom.urlInput.focus();
  }

  // ===========================================================
  //  7. FAKE PROGRESS BAR
  // ===========================================================
  function formatQualityLabel(format, val) {
    if (format === "audio") {
      if (typeof val === "string") {
        return val.toLowerCase().replace("k", "kbps");
      }
      return "320kbps";
    } else {
      if (val === "best") return "best quality";
      return val + "p";
    }
  }

  function startProgress(format) {
    progress = 0;
    dom.progressFill.style.width = "0%";
    let msgIdx = 0;
    
    const val = dom.qualitySelect ? dom.qualitySelect.value : (format === 'audio' ? '320K' : 'best');
    const qualityLabel = formatQualityLabel(format, val);
    
    const messages = format === "video" 
      ? [
          "Generating World... 🌍",
          "Loading terrain... ⛰️",
          `Smelting redstone ${qualityLabel} video blocks... 🔴`,
          "Combining textures and shaders... 🎨",
          `Crafting voxel ${qualityLabel} video in inventory... 📦`,
        ]
      : [
          "Generating World... 🌍",
          "Mining audio blocks... ⛏️",
          "Smelting gold nuggets... 🪵",
          `Brewing ${qualityLabel} music disc... 🧪`,
          "Crafting music disc in inventory... 💿",
        ];

    dom.statusText.textContent = messages[0];

    progressTimer = setInterval(() => {
      // Slowly animate up to 92% to keep interface alive, in case backend doesn't send progress events (e.g. Spotify)
      if (progress < 92) {
        const increment = Math.random() * (progress < 40 ? 5 : 2) + 0.5;
        progress = Math.min(progress + increment, 92);
        dom.progressFill.style.width = progress + "%";
      }

      const nextIdx = Math.min(
        Math.floor(progress / (100 / messages.length)),
        messages.length - 1
      );
      if (nextIdx !== msgIdx) {
        msgIdx = nextIdx;
        dom.statusText.style.opacity = "0";
        setTimeout(() => {
          dom.statusText.textContent = messages[msgIdx];
          dom.statusText.style.opacity = "1";
        }, 150);
      }
    }, 1000);
  }

  function stopProgress(complete) {
    clearInterval(progressTimer);
    progressTimer = null;
    if (complete) {
      dom.progressFill.style.width = "100%";
    }
  }

  // ===========================================================
  //  7b. FETCH MEDIA SIZES
  // ===========================================================
  async function fetchMediaSizes(url) {
    if (currentInfoAbortCtrl) currentInfoAbortCtrl.abort();
    currentMediaSizes = { audio: {}, video: {} };
    updateQualityOptions(); // Reset to base options

    const platform = detectPlatform(url);
    if (!platform) return;

    const loader = $("size-loader");
    if (loader) show(loader);

    currentInfoAbortCtrl = new AbortController();
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: currentInfoAbortCtrl.signal
      });
      const data = await res.json();
      if (data.success) {
        currentMediaSizes = { audio: data.audio || {}, video: data.video || {} };
        updateQualityOptions();
      }
    } catch (e) {
      // Ignored (timeout or abort)
    } finally {
      if (loader) hide(loader);
    }
  }

  // ===========================================================
  //  7c. SPOTIFY PREVIEW & PLAYLIST FLOW
  // ===========================================================
  async function fetchSpotifyPreview(url) {
    if (spotifyPreviewUrl === url && loadedSpotifyTracks) return;
    spotifyPreviewUrl = url;
    loadedSpotifyTracks = null;

    const previewSection = $("spotify-preview-section");
    const trackListElem = $("spotify-track-list");
    const listCover = $("preview-list-cover");
    const listTitle = $("preview-list-title");
    const listCount = $("preview-list-count");

    if (!previewSection || !trackListElem) return;

    show(previewSection);
    trackListElem.innerHTML = `
      <div class="text-center py-8 font-label-sm animate-pulse text-on-background dark:text-white bg-white dark:bg-[#121212] p-4">
        Connecting to Spotify Satellite... 🛰️
      </div>`;
    listCover.src = "";
    listTitle.textContent = "Loading Spotify Details...";
    listCount.textContent = "Fetching track list...";

    if (dom.convertLabel) dom.convertLabel.textContent = "LOADING PREVIEW...";
    dom.downloadBtn.disabled = true;

    try {
      const response = await fetch("/api/spotify/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();

      if (data.success && data.tracks && data.tracks.length > 0) {
        loadedSpotifyTracks = data.tracks;
        listTitle.textContent = data.title;
        listCover.src = data.cover_url || "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%2322c55e%22/></svg>";
        listCount.textContent = `${data.tracks.length} track${data.tracks.length > 1 ? "s" : ""} loaded`;
        
        renderSpotifyTracks(data.tracks);
        if (dom.convertLabel) dom.convertLabel.textContent = "RIP PLAYLIST!";
      } else {
        trackListElem.innerHTML = `
          <div class="text-center py-8 font-body-lg text-red-500 bg-red-50 dark:bg-red-950/20 border-4 border-red-500 p-4">
            Failed to parse Spotify link. Double check URL.
          </div>`;
        if (dom.convertLabel) dom.convertLabel.textContent = "RIP IT!";
      }
    } catch (err) {
      trackListElem.innerHTML = `
        <div class="text-center py-8 font-body-lg text-red-500 bg-red-50 dark:bg-red-950/20 border-4 border-red-500 p-4">
          Failed to fetch Spotify preview.
        </div>`;
      if (dom.convertLabel) dom.convertLabel.textContent = "RIP IT!";
    } finally {
      dom.downloadBtn.disabled = false;
    }
  }

  function renderSpotifyTracks(tracks) {
    const trackListElem = $("spotify-track-list");
    if (!trackListElem) return;

    trackListElem.innerHTML = tracks.map((track, index) => {
      const title = escapeHtml(track.name);
      const artists = escapeHtml(track.artists.join(", "));
      const durationStr = `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}`;
      const coverUrl = track.cover_url || "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23000%22/></svg>";

      return `
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 gap-4 bg-white dark:bg-[#121212] select-none hover:bg-surface-container transition-colors duration-75 text-on-background dark:text-white" data-index="${index}">
            <div class="flex items-center gap-3 min-w-0 flex-grow">
                <input type="checkbox" checked class="track-select-checkbox w-6 h-6 text-primary border-4 border-on-background focus:ring-0 rounded-none shrink-0" data-index="${index}" />
                <img class="w-10 h-10 border-2 border-on-background object-cover bg-black shrink-0" src="${coverUrl}" alt="" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23000%22/></svg>'">
                <div class="min-w-0 text-left">
                    <p class="font-display-lg text-body-md truncate dark:text-white font-bold">${title}</p>
                    <p class="font-body-md text-xs text-on-surface-variant truncate dark:text-gray-400">${artists} · ${durationStr}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <input type="text" placeholder="Custom YouTube URL..." class="track-override-input flex-grow sm:w-48 bg-surface border-2 border-on-background px-3 py-1 font-mono text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none placeholder:text-[#999] dark:bg-[#1e1e1e] dark:border-black dark:text-white" data-index="${index}" />
                <button type="button" class="track-match-btn neo-button bg-[#fd9e70] hover:bg-[#ffb693] px-3 py-1 font-label-sm text-xs text-on-background flex items-center justify-center gap-1 dark:border-black" data-index="${index}">
                    <span class="material-symbols-outlined text-sm">search</span> MATCH
                </button>
            </div>
        </div>
      `;
    }).join("");

    // Bind event listeners
    trackListElem.querySelectorAll(".track-match-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const index = parseInt(btn.getAttribute("data-index"), 10);
        openMatchModal(index);
      });
    });

    trackListElem.querySelectorAll(".track-select-checkbox").forEach(cb => {
      cb.addEventListener("change", () => {
        updateSelectedCount();
      });
    });
  }

  function updateSelectedCount() {
    const listCount = $("preview-list-count");
    if (!listCount || !loadedSpotifyTracks) return;

    const checkboxes = document.querySelectorAll(".track-select-checkbox");
    let selected = 0;
    checkboxes.forEach(cb => {
      if (cb.checked) selected++;
    });

    listCount.textContent = `${selected} / ${loadedSpotifyTracks.length} track${loadedSpotifyTracks.length > 1 ? "s" : ""} selected`;

    const selectAllBtn = $("preview-select-all");
    if (selectAllBtn) {
      if (selected === 0) {
        selectAllBtn.textContent = "Select All";
      } else {
        selectAllBtn.textContent = "Deselect All";
      }
    }
  }

  function openMatchModal(index) {
    currentMatchingTrackIndex = index;
    const track = loadedSpotifyTracks[index];
    if (!track) return;

    const modalTitle = $("match-modal-title");
    const modalSearchInput = $("match-modal-search-input");
    const matchModal = $("match-modal");

    if (modalTitle) modalTitle.textContent = `Match: ${track.name}`;
    if (modalSearchInput) modalSearchInput.value = `${track.artists.join(", ")} - ${track.name}`;
    
    show(matchModal);
    performModalSearch(modalSearchInput.value);
  }

  async function performModalSearch(query) {
    const modalResults = $("match-modal-results");
    if (!modalResults) return;

    modalResults.innerHTML = `
      <div class="text-center py-8 font-label-sm animate-pulse text-on-background dark:text-white p-4">
        Searching YouTube... 🔍
      </div>`;

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await response.json();

      if (data.success && data.results && data.results.length > 0) {
        renderModalSearchResults(data.results);
      } else {
        modalResults.innerHTML = `
          <div class="text-center py-8 font-body-lg text-red-500 bg-red-50 dark:bg-red-950/20 p-4">
            No videos found. Try editing the search box above.
          </div>`;
      }
    } catch (err) {
      modalResults.innerHTML = `
        <div class="text-center py-8 font-body-lg text-red-500 bg-red-50 dark:bg-red-950/20 p-4">
          Search failed.
        </div>`;
    }
  }

  function renderModalSearchResults(results) {
    const modalResults = $("match-modal-results");
    const matchModal = $("match-modal");
    if (!modalResults) return;

    modalResults.innerHTML = results.map((item, index) => {
      const title = escapeHtml(item.title);
      const uploader = escapeHtml(item.uploader);
      const duration = item.duration ? `[${item.duration}]` : "";
      
      return `
        <button type="button" class="w-full flex items-center justify-between p-3 gap-4 text-left bg-white dark:bg-[#121212] hover:bg-surface-container transition-colors border-b-2 border-on-background dark:border-black text-on-background dark:text-white modal-select-btn" data-url="${item.url}">
          <div class="min-w-0">
            <p class="font-display-lg text-body-md truncate font-bold">${title}</p>
            <p class="font-body-md text-xs text-on-surface-variant dark:text-gray-400 truncate">${uploader} · ${duration}</p>
          </div>
          <span class="material-symbols-outlined text-primary-container shrink-0">check_circle</span>
        </button>
      `;
    }).join("");

    modalResults.querySelectorAll(".modal-select-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        
        const trackRow = document.querySelector(`#spotify-track-list div[data-index="${currentMatchingTrackIndex}"]`);
        if (trackRow) {
          const input = trackRow.querySelector(".track-override-input");
          if (input) {
            input.value = url;
            input.classList.add("input-pulse");
            setTimeout(() => input.classList.remove("input-pulse"), 500);
          }
        }
        
        hide(matchModal);
        showToast("Match updated!", "success");
      });
    });
  }

  async function startSpotifyPlaylistDownload(tracks, retryCount = 0) {
    const formatInput = document.querySelector('.format-btn[aria-pressed="true"]');
    const format = formatInput ? formatInput.value : 'audio';
    const quality = dom.qualitySelect ? dom.qualitySelect.value : '320K';

    const selectedTracks = [];
    const rows = document.querySelectorAll("#spotify-track-list div[data-index]");
    
    rows.forEach(row => {
      const idx = parseInt(row.getAttribute("data-index"), 10);
      const cb = row.querySelector(".track-select-checkbox");
      if (cb && cb.checked) {
        const input = row.querySelector(".track-override-input");
        const youtube_url = input ? input.value.trim() : "";
        selectedTracks.push({
          spotify_url: tracks[idx].spotify_url,
          youtube_url: youtube_url || null
        });
      }
    });

    if (selectedTracks.length === 0) {
      showToast("Please select at least one track to download.", "error");
      return;
    }

    const consoleElem = document.getElementById("terminal-console");
    if (consoleElem) {
      consoleElem.textContent = "Connecting to media socket...\n";
    }

    if (retryCount === 0) {
      setState("loading");
      startProgress(format);
    } else {
      dom.statusText.textContent = `Retrying... (Attempt ${retryCount + 1})`;
      if (consoleElem) {
        consoleElem.textContent += `Retrying connection (Attempt ${retryCount + 1})...\n`;
      }
    }

    abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), TIMEOUT_MS);

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: selectedTracks, format, quality }),
        signal: abortCtrl.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        stopProgress(false);
        showError("You've reached the limit of 5 downloads per minute. Please wait a moment.");
        return;
      }

      if (!response.ok) {
        if (response.status >= 500 && retryCount < 2) {
          const delay = Math.pow(2, retryCount) * 1500;
          await sleep(delay);
          return startSpotifyPlaylistDownload(tracks, retryCount + 1);
        }
        throw new Error(`HTTP Error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === "log") {
              if (consoleElem) {
                consoleElem.textContent += data.message + "\n";
                consoleElem.scrollTop = consoleElem.scrollHeight;
              }
            } else if (data.type === "progress") {
              const pct = data.percent;
              progress = Math.max(progress, pct);
              dom.progressFill.style.width = progress + "%";
            } else if (data.type === "success") {
              stopProgress(true);
              await sleep(400);
              showResult(data, spotifyPreviewUrl, "spotify", format);
              showToast("Playlist ready!", "success");
              return;
            } else if (data.type === "error") {
              stopProgress(false);
              showError(data.message || "Subprocess returned an error.");
              showToast("Playlist download failed", "error");
              return;
            }
          } catch (jsonErr) {
            console.error("Failed to parse SSE line:", trimmed, jsonErr);
          }
        }
      }

      stopProgress(false);
      showError("Connection ended abruptly before download completion.");
      showToast("Download failed", "error");

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name !== "AbortError" && retryCount < 2) {
        const delay = Math.pow(2, retryCount) * 1500;
        await sleep(delay);
        return startSpotifyPlaylistDownload(tracks, retryCount + 1);
      }

      stopProgress(false);

      if (err.name === "AbortError") {
        showError("Request timed out after 30 minutes. The server may be busy — please try again.");
      } else {
        showError(err.message || "Connection failed. Please check your internet and make sure the server is running.");
      }
    } finally {
      abortCtrl = null;
    }
  }

  // ===========================================================
  //  8. DOWNLOAD FLOW
  // ===========================================================
  async function startDownload(url, retryCount = 0) {
    const platform = detectPlatform(url);

    if (!platform) {
      showError("Please paste a valid media link.");
      return;
    }

    if (!isValidUrl(url)) {
      showError("That doesn't look like a valid URL. Please check and try again.");
      return;
    }

    const formatInput = document.querySelector('.format-btn[aria-pressed="true"]');
    const format = formatInput ? formatInput.value : 'audio';
    const quality = dom.qualitySelect ? dom.qualitySelect.value : (format === 'audio' ? '320K' : 'best');

    const consoleElem = document.getElementById("terminal-console");
    if (consoleElem) {
      consoleElem.textContent = "Connecting to media socket...\n";
    }

    if (retryCount === 0) {
      setState("loading");
      startProgress(format);
    } else {
      dom.statusText.textContent = `Retrying... (Attempt ${retryCount + 1})`;
      if (consoleElem) {
        consoleElem.textContent += `Retrying connection (Attempt ${retryCount + 1})...\n`;
      }
    }

    abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), TIMEOUT_MS);

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, format, quality }),
        signal: abortCtrl.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        stopProgress(false);
        showError("You've reached the limit of 5 downloads per minute. Please wait a moment.");
        return;
      }

      if (!response.ok) {
        if (response.status >= 500 && retryCount < 2) {
          const delay = Math.pow(2, retryCount) * 1500;
          await sleep(delay);
          return startDownload(url, retryCount + 1);
        }
        throw new Error(`HTTP Error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // store the trailing line fragment

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === "log") {
              if (consoleElem) {
                consoleElem.textContent += data.message + "\n";
                consoleElem.scrollTop = consoleElem.scrollHeight;
              }
            } else if (data.type === "progress") {
              const pct = data.percent;
              progress = Math.max(progress, pct);
              dom.progressFill.style.width = progress + "%";
            } else if (data.type === "success") {
              stopProgress(true);
              await sleep(400);
              showResult(data, url, platform, format);
              showToast("Download ready!", "success");
              return;
            } else if (data.type === "error") {
              stopProgress(false);
              showError(data.message || "Subprocess returned an error.");
              showToast("Download failed", "error");
              return;
            }
          } catch (jsonErr) {
            console.error("Failed to parse SSE line:", trimmed, jsonErr);
          }
        }
      }

      // If stream finishes without success event
      stopProgress(false);
      showError("Connection ended abruptly before download completion.");
      showToast("Download failed", "error");

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name !== "AbortError" && retryCount < 2) {
        const delay = Math.pow(2, retryCount) * 1500;
        await sleep(delay);
        return startDownload(url, retryCount + 1);
      }

      stopProgress(false);

      if (err.name === "AbortError") {
        showError("Request timed out after 30 minutes. The server may be busy — please try again.");
      } else {
        showError(err.message || "Connection failed. Please check your internet and make sure the server is running.");
      }
    } finally {
      abortCtrl = null;
    }
  }

  // ===========================================================
  //  9. SUCCESS STATE
  // ===========================================================
  function showResult(data, sourceUrl, platform, format) {
    setState("success");

    dom.resultTitle.textContent    = data.title || "Unknown Title";
    const sizeStr = data.size_bytes ? formatBytes(data.size_bytes) : "";
    dom.resultFilename.textContent = (data.filename || "download.mp3") + (sizeStr ? ` · ${sizeStr}` : "");
    dom.resultDownload.href        = data.download_url;
    dom.resultDownload.download    = data.filename || "download.mp3";
    
    if (dom.resultDownloadText) {
      if (data.filename && data.filename.endsWith(".zip")) {
        dom.resultDownloadText.textContent = "Save ZIP";
      } else {
        dom.resultDownloadText.textContent = format === "video" ? "Save MP4" : "Save MP3";
      }
    }

    // Save to history
    addToHistory({
      title: data.title || "Unknown Title",
      filename: data.filename,
      sizeStr: sizeStr,
      url: sourceUrl,
      platform,
      format,
      timestamp: Date.now(),
    });

    // Show tag editor for single MP3 files
    if (format === "audio" && data.filename && !data.filename.endsWith(".zip")) {
      showTagEditor(data.title, data.filename);
    }

    // Auto-download after a brief moment
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = data.filename || (format === "video" ? "download.mp4" : "download.mp3");
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, 600);

    // Confetti and sound!
    launchConfetti();
    playSuccessSound();
  }

  // ===========================================================
  //  10. ERROR STATE
  // ===========================================================
  function showError(message) {
    setState("error");
    dom.errorMessage.textContent = message;
  }

  // ===========================================================
  //  11. CLIPBOARD PASTE
  // ===========================================================
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        dom.urlInput.value = text.trim();
        dom.urlInput.dispatchEvent(new Event("input", { bubbles: true }));
        dom.urlInput.focus();

        // Quick pulse animation on the input
        dom.urlInput.classList.add("input-pulse");
        setTimeout(() => dom.urlInput.classList.remove("input-pulse"), 500);
      }
    } catch {
      // Fallback: try execCommand
      dom.urlInput.focus();
      document.execCommand("paste");
    }
  }

  // ===========================================================
  //  12. DOWNLOAD HISTORY (server-side)
  // ===========================================================
  async function loadHistoryFromServer() {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (data.success) {
        historyCache = data.history || [];
        renderHistory();
      }
    } catch { /* offline or error — start empty */ }
  }

  function addToHistory(entry) {
    historyCache = historyCache.filter((e) => e.url !== entry.url);
    historyCache.unshift(entry);
    historyCache = historyCache.slice(0, MAX_HISTORY);
    renderHistory();
    // fire-and-forget sync to server
    fetch("/api/history/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {});
  }

  function clearHistory() {
    historyCache = [];
    renderHistory();
    fetch("/api/history", { method: "DELETE" }).catch(() => {});
  }

  function renderHistory() {
    const list = historyCache;

    if (list.length === 0) {
      hide(dom.historySection);
      return;
    }

    show(dom.historySection);
    hide(dom.historyEmpty);

    dom.historyList.innerHTML = list
      .map((entry, i) => {
        const platformClass = entry.platform || "youtube";
        const time = formatTime(new Date(entry.timestamp));
        const title = escapeHtml(entry.title || "Unknown");
        const filename = escapeHtml(entry.filename || "download.mp3");
        const metaStr = entry.sizeStr ? `${filename} · ${entry.sizeStr} · ${time}` : `${filename} · ${time}`;

        return `
          <div class="history-item" data-index="${i}" style="animation-delay: ${i * 0.04}s">
            <div class="history-item__platform history-item__platform--${platformClass}">
              ${platformClass === "spotify" ? spotifyMiniIcon() : platformClass === "youtube" ? youtubeMiniIcon() : genericMiniIcon()}
            </div>
            <div class="history-item__info">
              <span class="history-item__title">${title}</span>
              <span class="history-item__meta">${metaStr}</span>
            </div>
            <a class="history-item__dl" href="${entry.downloadUrl || "#"}" download="${filename}" title="Re-download">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
          </div>`;
      })
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function youtubeMiniIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
  }

  function spotifyMiniIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;
  }

  function genericMiniIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  }

  // ===========================================================
  //  13. CONFETTI EFFECT
  // ===========================================================
  function launchConfetti() {
    const canvas = dom.confettiCanvas;
    if (!canvas) return;

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    show(canvas);

    const ctx = canvas.getContext("2d");
    const particles = [];
    const COLORS = [
      "#00f2fe", "#4facfe", "#2dd4bf", "#38bdf8",
      "#818cf8", "#34d399", "#fbbf24", "#22d3ee",
    ];
    const PARTICLE_COUNT = 120;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.45,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 1) * 16 - 4,
        size: Math.random() * 8 + 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        gravity: 0.25 + Math.random() * 0.15,
        drag: 0.98 + Math.random() * 0.015,
        opacity: 1,
      });
    }

    let frame = 0;
    const MAX_FRAMES = 180; // ~3 seconds at 60fps

    function animate() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = 0;

      for (const p of particles) {
        p.vy += p.gravity;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        // Fade out in the last third
        if (frame > MAX_FRAMES * 0.6) {
          p.opacity -= 0.025;
        }

        if (p.opacity <= 0 || p.y > canvas.height + 20) continue;
        alive++;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);

        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#1a1c1c";
        ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size);

        ctx.restore();
      }

      if (alive > 0 && frame < MAX_FRAMES) {
        requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hide(canvas);
      }
    }

    requestAnimationFrame(animate);
  }

  // ===========================================================
  //  14. EVENT LISTENERS
  // ===========================================================

  // --- Quality options updater ---
  const updateQualityOptions = () => {
    const formatInput = document.querySelector('.format-btn[aria-pressed="true"]');
    const format = formatInput ? formatInput.value : 'audio';
    const qs = dom.qualitySelect;
    if (!qs) return;
    
    const previousValue = qs.value;
    
    const getSize = (type, key) => {
       const bytes = currentMediaSizes[type]?.[key];
       if (bytes === -1) return " (~ 3-8 MB)"; 
       if (bytes > 0) return ` (~ ${formatBytes(bytes)})`;
       return "";
    };

    const audioOptions = [
      { value: "320K", label: "320kbps (Best)" },
      { value: "256K", label: "256kbps" },
      { value: "192K", label: "192kbps" },
      { value: "128K", label: "128kbps" }
    ];

    const videoOptions = [
      { value: "best", label: "Best Available" },
      { value: "1080", label: "1080p" },
      { value: "720", label: "720p" },
      { value: "480", label: "480p" },
      { value: "360", label: "360p" }
    ];

    const currentOptions = format === "audio" ? audioOptions : videoOptions;
    
    // Build options HTML for custom list
    let html = "";
    currentOptions.forEach(opt => {
      const sizeText = getSize(format, opt.value);
      const fullLabel = opt.label + sizeText;
      html += `
        <button type="button" class="custom-option text-left p-4 font-label-sm transition-colors duration-75 border-b-[2px] last:border-b-0 border-on-background dark:border-black bg-surface-container dark:bg-[#121212] text-on-background dark:text-white" data-value="${opt.value}" data-label="${opt.label}">
          ${fullLabel}
        </button>`;
    });

    if (dom.customSelectOptions) {
      dom.customSelectOptions.innerHTML = html;
    }

    // Determine value to select
    let selectedValue = currentOptions[0].value;
    if (previousValue) {
      const optionExists = currentOptions.some(opt => opt.value === previousValue);
      if (optionExists) {
        selectedValue = previousValue;
      }
    }

    // Update hidden input and display label
    qs.value = selectedValue;
    const selectedOpt = currentOptions.find(opt => opt.value === selectedValue);
    if (dom.customSelectValue && selectedOpt) {
      dom.customSelectValue.textContent = selectedOpt.label;
    }

    // Re-bind click event handlers for the newly rendered custom options
    if (dom.customSelectOptions) {
      dom.customSelectOptions.querySelectorAll(".custom-option").forEach(btn => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-value");
          const label = btn.getAttribute("data-label");
          
          qs.value = val;
          if (dom.customSelectValue) dom.customSelectValue.textContent = label;
          
          hide(dom.customSelectOptions);
          if (dom.customSelectArrow) dom.customSelectArrow.classList.remove("rotate-180");
          
          // Trigger change event on quality-select hidden input so handlers trigger
          qs.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
    }
  };

  // --- Custom Dropdown Event Listeners ---
  if (dom.customSelectTrigger) {
    dom.customSelectTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dom.customSelectOptions) {
        const isHidden = dom.customSelectOptions.classList.contains("hidden");
        if (isHidden) {
          show(dom.customSelectOptions);
          if (dom.customSelectArrow) dom.customSelectArrow.classList.add("rotate-180");
        } else {
          hide(dom.customSelectOptions);
          if (dom.customSelectArrow) dom.customSelectArrow.classList.remove("rotate-180");
        }
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (dom.customSelectContainer && !dom.customSelectContainer.contains(e.target)) {
      hide(dom.customSelectOptions);
      if (dom.customSelectArrow) dom.customSelectArrow.classList.remove("rotate-180");
    }
  });

  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('change', updateQualityOptions);
  });

  // --- URL input: detect platform on typing / pasting ---
  let inputDebounceTimer = null;

  dom.urlInput.addEventListener("input", () => {
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      updatePlatformBadge(dom.urlInput.value);
    }, 500);
  });

  dom.urlInput.addEventListener("paste", (e) => {
    clearTimeout(inputDebounceTimer);
    // Let the paste complete, then detect immediately
    setTimeout(() => updatePlatformBadge(dom.urlInput.value), 50);
  });

  // --- Enter key triggers download ---
  dom.urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dom.form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  // --- Form submit ---
  dom.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = dom.urlInput.value.trim();
    if (!url || currentState === "loading") return;
    
    const platform = detectPlatform(url);
    if (platform === "spotify" && loadedSpotifyTracks) {
      startSpotifyPlaylistDownload(loadedSpotifyTracks);
    } else if (platform) {
      startDownload(url);
    } else {
      performSearch(url);
    }
  });

  // --- Modal Search Handlers ---
  const matchModal = $("match-modal");
  const closeMatchModalBtn = $("close-match-modal");
  const modalSearchBtn = $("match-modal-search-btn");
  const modalSearchInput = $("match-modal-search-input");

  if (closeMatchModalBtn) {
    closeMatchModalBtn.addEventListener("click", () => hide(matchModal));
  }

  if (modalSearchBtn && modalSearchInput) {
    modalSearchBtn.addEventListener("click", () => {
      const q = modalSearchInput.value.trim();
      if (q) performModalSearch(q);
    });
    modalSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        modalSearchBtn.click();
      }
    });
  }

  // --- Select / Deselect All button ---
  const selectAllBtn = $("preview-select-all");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".track-select-checkbox");
      const isAnyChecked = Array.from(checkboxes).some(cb => cb.checked);
      
      checkboxes.forEach(cb => {
        cb.checked = !isAnyChecked;
      });
      updateSelectedCount();
    });
  }

  // --- Paste button ---
  dom.pasteBtn.addEventListener("click", pasteFromClipboard);

  // --- "Download Another" ---
  dom.newDownloadBtn.addEventListener("click", resetToIdle);

  // --- "Try Again" ---
  dom.retryBtn.addEventListener("click", () => {
    setState(dom.urlInput.value.trim() ? "detecting" : "idle");
    dom.urlInput.focus();
  });

  // --- Clear history ---
  if (dom.clearHistoryBtn) {
    dom.clearHistoryBtn.addEventListener("click", () => {
      // Animate items out
      const items = dom.historyList.querySelectorAll(".history-item");
      items.forEach((item, i) => {
        item.style.transition = `opacity .25s ${i * 0.03}s, transform .25s ${i * 0.03}s`;
        item.style.opacity = "0";
        item.style.transform = "translateX(20px)";
      });

      setTimeout(() => {
        clearHistory();
      }, items.length * 30 + 280);
    });
  }

  // --- Smooth-scroll nav links ---
  document.querySelectorAll('.nav-link[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = link.getAttribute("href");
      if (href === "#") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      try {
        const target = document.querySelector(href);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        console.warn("Invalid smooth-scroll selector:", href);
      }
    });
  });

  // --- Resize confetti canvas if window resizes ---
  window.addEventListener("resize", () => {
    if (dom.confettiCanvas && !dom.confettiCanvas.classList.contains("hidden")) {
      dom.confettiCanvas.width  = window.innerWidth;
      dom.confettiCanvas.height = window.innerHeight;
    }
  });

  // --- Global Ctrl+V to auto-paste ---
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      // If user isn't already focused on an input
      if (document.activeElement !== dom.urlInput) {
        dom.urlInput.focus();
        // The browser will handle the paste into the newly focused input natively
      }
    }
  });

  // ===========================================================
  //  15. SCROLL-REVEAL (IntersectionObserver)
  // ===========================================================
  function initScrollReveal() {
    const targets = document.querySelectorAll(".feature-card, .step");
    if (!("IntersectionObserver" in window) || targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    targets.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(28px)";
      el.style.transition = `opacity .55s cubic-bezier(.22,1,.36,1) ${i * 0.08}s, transform .55s cubic-bezier(.22,1,.36,1) ${i * 0.08}s`;
      observer.observe(el);
    });
  }

  // ===========================================================
  //  16. INITIALISE
  // ===========================================================
  function init() {
    loadHistoryFromServer();
    initScrollReveal();
    updateQualityOptions();
    updateDiskStats();
    setTimeout(() => dom.urlInput.focus(), 300);
  }

  // Run when DOM is ready (it should be, since script is at bottom)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ===========================================================
  //  17. DISK STATS
  // ===========================================================
  async function updateDiskStats() {
    if (!dom.diskStats) return;
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      if (data.success && data.file_count > 0) {
        dom.diskStats.textContent = `${data.file_count} file${data.file_count !== 1 ? "s" : ""} · ${formatBytes(data.total_size)}`;
        show(dom.diskStats);
      } else {
        hide(dom.diskStats);
      }
    } catch { /* ignore */ }
  }

  // ===========================================================
  //  18. DOWNLOAD QUEUE
  // ===========================================================
  function renderQueue() {
    if (downloadQueue.length === 0) {
      hide(dom.queueSection);
      return;
    }
    show(dom.queueSection);
    if (dom.queueCount) dom.queueCount.textContent = `${downloadQueue.length} item${downloadQueue.length !== 1 ? "s" : ""}`;

    const statusColor = { pending: "bg-surface-container", downloading: "bg-tertiary-container", done: "bg-primary-container", error: "bg-error-container" };
    const statusLabel = { pending: "PENDING", downloading: "LOADING…", done: "DONE ✓", error: "ERROR" };

    dom.queueList.innerHTML = downloadQueue.map(item => {
      const displayName = item.title || (item.url.length > 55 ? item.url.slice(0, 55) + "…" : item.url);
      const fmtStr = item.format === "audio"
        ? `MP3 · ${(item.quality || "320K").toLowerCase().replace("k", "kbps")}`
        : `MP4 · ${item.quality || "best"}`;

      return `
        <div class="flex items-center gap-3 border-[4px] border-on-background p-3 ${statusColor[item.status]} shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" data-id="${item.id}">
          <span class="font-label-sm uppercase text-xs w-24 shrink-0 text-center border-2 border-on-background px-2 py-1 bg-surface">${statusLabel[item.status]}</span>
          <div class="flex-grow min-w-0">
            <p class="font-label-sm text-xs truncate">${escapeHtml(displayName)}</p>
            <p class="font-body-md text-xs text-on-surface-variant">${item.platform.toUpperCase()} · ${fmtStr}</p>
          </div>
          ${item.downloadUrl ? `<a href="${item.downloadUrl}" download="${escapeHtml(item.filename)}" class="neo-button bg-surface hover:bg-primary-container px-3 py-2 font-label-sm text-xs flex items-center gap-1 shrink-0"><span class="material-symbols-outlined text-sm">download</span></a>` : ""}
          ${item.status === "pending" ? `<button type="button" class="queue-remove-btn neo-button bg-error-container hover:bg-[#ffdad6] px-3 py-2 font-label-sm text-xs text-[#93000a] shrink-0" data-id="${item.id}"><span class="material-symbols-outlined text-sm">close</span></button>` : ""}
        </div>`;
    }).join("");

    dom.queueList.querySelectorAll(".queue-remove-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-id"), 10);
        downloadQueue = downloadQueue.filter(q => q.id !== id);
        renderQueue();
      });
    });

    if (dom.startQueueBtn) {
      dom.startQueueBtn.disabled = isQueueRunning || !downloadQueue.some(q => q.status === "pending");
    }
  }

  function addCurrentToQueue() {
    const url = dom.urlInput.value.trim();
    if (!url) { showToast("Paste a URL first", "error"); return; }
    const platform = detectPlatform(url);
    if (!platform || !isValidUrl(url)) { showToast("Only valid media URLs can be queued", "error"); return; }

    const formatInput = document.querySelector('.format-btn[aria-pressed="true"]');
    const format  = formatInput ? formatInput.value : "audio";
    const quality = dom.qualitySelect ? dom.qualitySelect.value : "320K";

    downloadQueue.push({
      id: Date.now(),
      url,
      format,
      quality,
      platform: platform || "generic",
      status: "pending",
      title: null,
      downloadUrl: null,
      filename: null,
      tracks: platform === "spotify" && loadedSpotifyTracks ? loadedSpotifyTracks.map(t => ({ spotify_url: t.spotify_url, youtube_url: null })) : null,
    });

    dom.urlInput.value = "";
    updatePlatformBadge("");
    renderQueue();
    showToast("Added to queue!", "success");
    if (dom.queueSection) dom.queueSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function runQueue() {
    if (isQueueRunning) return;
    isQueueRunning = true;
    if (dom.startQueueBtn) dom.startQueueBtn.disabled = true;

    for (const item of downloadQueue) {
      if (item.status !== "pending") continue;
      item.status = "downloading";
      renderQueue();

      try {
        const result = await downloadQueueItem(item);
        item.status = "done";
        item.title = result.title || item.url;
        item.downloadUrl = result.download_url;
        item.filename = result.filename;
        addToHistory({
          title: result.title || "Unknown",
          filename: result.filename,
          sizeStr: result.size_bytes ? formatBytes(result.size_bytes) : "",
          url: item.url,
          platform: item.platform,
          format: item.format,
          timestamp: Date.now(),
        });
      } catch {
        item.status = "error";
      }
      renderQueue();
      updateDiskStats();
    }

    isQueueRunning = false;
    showToast("Queue complete!", "success");
    renderQueue();
  }

  function downloadQueueItem(item) {
    return new Promise(async (resolve, reject) => {
      try {
        const body = item.tracks
          ? { tracks: item.tracks, format: item.format, quality: item.quality }
          : { url: item.url, format: item.format, quality: item.quality };

        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { reject(new Error(`HTTP ${res.status}`)); return; }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(t.slice(6));
              if (d.type === "success") { resolve(d); return; }
              if (d.type === "error")   { reject(new Error(d.message)); return; }
            } catch { /* skip */ }
          }
        }
        reject(new Error("Stream ended without success"));
      } catch (err) { reject(err); }
    });
  }

  if (dom.addToQueueBtn) dom.addToQueueBtn.addEventListener("click", addCurrentToQueue);
  if (dom.startQueueBtn) dom.startQueueBtn.addEventListener("click", runQueue);
  if (dom.clearQueueBtn) {
    dom.clearQueueBtn.addEventListener("click", () => {
      downloadQueue = downloadQueue.filter(q => q.status !== "pending");
      renderQueue();
    });
  }

  // ===========================================================
  //  19. TAG EDITOR
  // ===========================================================
  function showTagEditor(title, filename) {
    if (!dom.tagEditor || !dom.tagTitle) return;
    if (!filename || !filename.endsWith(".mp3")) return;
    currentTagFilename = filename;
    dom.tagTitle.value  = title || "";
    dom.tagArtist.value = "";
    dom.tagAlbum.value  = "";
    show(dom.tagEditor);
    dom.tagEditor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (dom.applyTagsBtn) {
    dom.applyTagsBtn.addEventListener("click", async () => {
      if (!currentTagFilename) return;
      const btn = dom.applyTagsBtn;
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.innerHTML = `<span class="material-symbols-outlined animate-spin">autorenew</span> SAVING…`;
      try {
        const res = await fetch(`/api/tags/${encodeURIComponent(currentTagFilename)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:  dom.tagTitle.value.trim(),
            artist: dom.tagArtist.value.trim(),
            album:  dom.tagAlbum.value.trim(),
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast("Tags saved!", "success");
        } else {
          showToast("Failed: " + data.error, "error");
        }
      } catch {
        showToast("Tags save failed", "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
  }
})();
