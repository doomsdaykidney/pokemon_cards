const TOTAL_POKEMON = 1025;
const CARDS_PER_PAGE = 16; // 4 wide x 4 high
const TOTAL_PAGES = Math.ceil(TOTAL_POKEMON / CARDS_PER_PAGE);

const STORAGE_KEYS = {
  COLLECTED: "pokedex_binder_collected_v1",
  NAMES_CACHE: "pokedex_binder_names_v1",
  GH_CONFIG: "pokedex_binder_gh_config_v1",
  LAST_PAGE: "pokedex_binder_last_page_v1",
};

// State
let currentPage = 1;
let pokemonNames = {}; // { 1: "bulbasaur", ... }
let collectedSet = new Set();
let pendingAdditions = new Set();
let pendingRemovals = new Set();
let isSyncing = false;
let syncTimeout = null;
let lastSyncError = "";

// DOM Elements
const binderGrid = document.getElementById("binderGrid");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageSelect = document.getElementById("pageSelect");
const pageRangeLabel = document.getElementById("pageRangeLabel");
const collectedCountEl = document.getElementById("collectedCount");
const totalCountEl = document.getElementById("totalCount");
const collectedPercentEl = document.getElementById("collectedPercent");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const genSelect = document.getElementById("genSelect");
const refreshBtn = document.getElementById("refreshBtn");
const syncSettingsBtn = document.getElementById("syncSettingsBtn");
const syncDot = document.getElementById("syncDot");
const syncStatusText = document.getElementById("syncStatusText");

// Modal Elements
const syncModal = document.getElementById("syncModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const syncForm = document.getElementById("syncForm");
const clearSyncBtn = document.getElementById("clearSyncBtn");
const ghOwnerInput = document.getElementById("ghOwner");
const ghRepoInput = document.getElementById("ghRepo");
const ghBranchInput = document.getElementById("ghBranch");
const ghTokenInput = document.getElementById("ghToken");

// Format #0001
function formatDexNumber(num) {
  return `#${String(num).padStart(4, "0")}`;
}

// Format Pokémon display name
function getPokemonName(id) {
  return pokemonNames[id] || `Pokémon ${formatDexNumber(id)}`;
}

// Sprite URL from PokéAPI GitHub sprite repository
function getSpriteUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

// Clean up user-entered owner/repo/token strings from mobile keyboards
function sanitizeConfig(raw) {
  let owner = (raw.owner || "").trim();
  let repo = (raw.repo || "").trim();
  let branch = (raw.branch || "main").trim() || "main";
  let token = (raw.token || "").trim();

  // If user pasted a full github.com or github.io URL, extract owner/repo
  owner = owner
    .replace(/^https?:\/\//i, "")
    .replace(/\.github\.io.*$/i, "")
    .replace(/^github\.com\//i, "")
    .split("/")[0]
    .trim();

  repo = repo
    .replace(/^https?:\/\/github\.com\/[^/]+\//i, "")
    .replace(/\.git$/i, "")
    .split("/")[0]
    .trim();

  return { owner, repo, branch, token };
}

// Auto-detect GitHub owner/repo when hosted on github.io
function getDefaultGitHubConfig() {
  let detectedOwner = "";
  let detectedRepo = "";
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split("/").filter(Boolean);

  if (host.endsWith(".github.io")) {
    detectedOwner = host.replace(".github.io", "");
    detectedRepo = pathParts[0] || "";
  }

  const savedRaw = localStorage.getItem(STORAGE_KEYS.GH_CONFIG);
  if (savedRaw) {
    try {
      const parsed = sanitizeConfig(JSON.parse(savedRaw));
      return {
        owner: parsed.owner || detectedOwner,
        repo: parsed.repo || detectedRepo,
        branch: parsed.branch || "main",
        token: parsed.token || "",
      };
    } catch (e) {
      // Fallback below
    }
  }

  return {
    owner: detectedOwner,
    repo: detectedRepo,
    branch: "main",
    token: "",
  };
}

function saveGitHubConfig(config) {
  localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify(sanitizeConfig(config)));
}

function canEdit() {
  const config = getDefaultGitHubConfig();
  return Boolean(config.owner && config.repo && config.token);
}

function updateSyncIndicator(state, label, errorDetail = "") {
  syncDot.className = "sync-dot";
  if (state === "synced") syncDot.classList.add("synced");
  if (state === "saving") syncDot.classList.add("saving");
  if (state === "error") syncDot.classList.add("error");
  syncStatusText.textContent = label;
  lastSyncError = errorDetail;
  syncSettingsBtn.title = errorDetail || label;
}

// Load local UI preferences and clear any legacy cached collection edits
function loadLocalState() {
  const savedPage = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_PAGE), 10);
  if (savedPage >= 1 && savedPage <= TOTAL_PAGES) {
    currentPage = savedPage;
  }

  // Remove any previously cached browser-only collection state
  localStorage.removeItem(STORAGE_KEYS.COLLECTED);

  const cachedNames = localStorage.getItem(STORAGE_KEYS.NAMES_CACHE);
  if (cachedNames) {
    try {
      pokemonNames = JSON.parse(cachedNames);
    } catch (e) {
      pokemonNames = {};
    }
  }
}

// Fetch all 1025 Pokémon names from PokéAPI once and cache in localStorage
async function fetchPokemonNames() {
  if (Object.keys(pokemonNames).length >= TOTAL_POKEMON) return;

  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species?limit=${TOTAL_POKEMON}`);
    if (!res.ok) return;
    const data = await res.json();
    const map = {};
    data.results.forEach((item, index) => {
      const parts = item.url.split("/").filter(Boolean);
      const id = parseInt(parts[parts.length - 1], 10) || index + 1;
      map[id] = item.name.replace(/-/g, " ");
    });
    pokemonNames = map;
    localStorage.setItem(STORAGE_KEYS.NAMES_CACHE, JSON.stringify(pokemonNames));
    renderBinderPage();
  } catch (err) {
    console.warn("Could not fetch Pokémon names from PokéAPI:", err);
  }
}

// Populate Page Dropdown
function initPageDropdown() {
  pageSelect.innerHTML = "";
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    const startId = (p - 1) * CARDS_PER_PAGE + 1;
    const endId = Math.min(p * CARDS_PER_PAGE, TOTAL_POKEMON);
    const opt = document.createElement("option");
    opt.value = String(p);
    opt.textContent = `Page ${p} / ${TOTAL_PAGES}`;
    opt.dataset.range = `${formatDexNumber(startId)} – ${formatDexNumber(endId)}`;
    pageSelect.appendChild(opt);
  }
}

// Update Progress Header
function updateProgressUI() {
  const count = collectedSet.size;
  const pct = ((count / TOTAL_POKEMON) * 100).toFixed(1);
  collectedCountEl.textContent = String(count);
  totalCountEl.textContent = String(TOTAL_POKEMON);
  collectedPercentEl.textContent = `${pct}%`;
}

// Render the 4x4 Binder Grid for currentPage
function renderBinderPage(highlightDexId = null) {
  const startId = (currentPage - 1) * CARDS_PER_PAGE + 1;
  const endId = Math.min(currentPage * CARDS_PER_PAGE, TOTAL_POKEMON);
  const editable = canEdit();

  pageSelect.value = String(currentPage);
  pageRangeLabel.textContent = `${formatDexNumber(startId)} – ${formatDexNumber(endId)}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= TOTAL_PAGES;
  localStorage.setItem(STORAGE_KEYS.LAST_PAGE, String(currentPage));

  binderGrid.innerHTML = "";

  for (let i = 0; i < CARDS_PER_PAGE; i++) {
    const dexId = startId + i;
    const pocket = document.createElement("div");
    pocket.className = "card-pocket";

    if (dexId > TOTAL_POKEMON) {
      pocket.classList.add("empty-slot");
      binderGrid.appendChild(pocket);
      continue;
    }

    const isCollected = collectedSet.has(dexId);
    const card = document.createElement("div");
    card.className = `pokemon-card ${isCollected ? "collected" : "missing"}${editable ? " editable" : ""}`;
    if (highlightDexId === dexId) {
      card.classList.add("highlight-jump");
    }
    card.dataset.dexId = String(dexId);
    card.setAttribute(
      "aria-label",
      `${getPokemonName(dexId)} ${formatDexNumber(dexId)} - ${isCollected ? "Collected" : "Missing"}`
    );

    card.innerHTML = `
      <div class="card-header">
        <span class="card-name">${getPokemonName(dexId)}</span>
        <span class="card-dex">${formatDexNumber(dexId)}</span>
      </div>
      <div class="card-art-window">
        <img
          class="card-sprite"
          src="${getSpriteUrl(dexId)}"
          alt="${getPokemonName(dexId)}"
          loading="lazy"
        />
      </div>
      <div class="card-footer">
        <div class="card-template-lines">
          <div class="template-line"></div>
          <div class="template-line short"></div>
        </div>
        <span class="status-badge">${isCollected ? "✓" : ""}</span>
      </div>
    `;

    if (editable) {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.addEventListener("click", () => toggleCard(dexId, card));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCard(dexId, card);
        }
      });
    }

    pocket.appendChild(card);
    binderGrid.appendChild(pocket);
  }

  updateProgressUI();
}

// Toggle a card's collected state and schedule sync
function toggleCard(dexId, cardEl) {
  if (!canEdit()) return;

  const nowCollected = !collectedSet.has(dexId);

  if (nowCollected) {
    collectedSet.add(dexId);
    pendingAdditions.add(dexId);
    pendingRemovals.delete(dexId);
  } else {
    collectedSet.delete(dexId);
    pendingRemovals.add(dexId);
    pendingAdditions.delete(dexId);
  }

  // Update card DOM immediately
  cardEl.className = `pokemon-card ${nowCollected ? "collected" : "missing"} editable`;
  const badge = cardEl.querySelector(".status-badge");
  if (badge) badge.textContent = nowCollected ? "✓" : "";
  cardEl.setAttribute(
    "aria-label",
    `${getPokemonName(dexId)} ${formatDexNumber(dexId)} - ${nowCollected ? "Collected" : "Missing"}`
  );

  updateProgressUI();
  scheduleGitHubSave();
}

// Decode Base64 UTF-8 content from GitHub API
function decodeBase64Json(base64Str) {
  const clean = base64Str.replace(/\s/g, "");
  const text = decodeURIComponent(escape(atob(clean)));
  return JSON.parse(text);
}

// Encode UTF-8 string to Base64 for GitHub API
function encodeBase64Json(obj) {
  const jsonStr = JSON.stringify(obj, null, 2) + "\n";
  return btoa(unescape(encodeURIComponent(jsonStr)));
}

// Describe GitHub HTTP error clearly
function formatGitHubError(status, message) {
  if (status === 401) return "Invalid Token (401)";
  if (status === 403) return "Token lacks Write permission (403)";
  if (status === 404) return "Repo/Branch not found (404)";
  if (status === 409) return "Conflict, tap Refresh (409)";
  if (status === 422) return "Branch/SHA mismatch (422)";
  return `GitHub Error (${status}${message ? ": " + message : ""})`;
}

// Fetch latest collection.json from GitHub API (or fallback to ./collection.json)
async function fetchRemoteCollection() {
  const config = getDefaultGitHubConfig();
  const editable = canEdit();
  let hadAuthError = false;

  if (!editable) {
    pendingAdditions.clear();
    pendingRemovals.clear();
  }

  if (config.owner && config.repo) {
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/collection.json?ref=${encodeURIComponent(config.branch || "main")}`;
    const headers = {
      Accept: "application/vnd.github.v3+json",
    };
    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
    }

    try {
      const res = await fetch(apiUrl, { headers, cache: "no-store" });
      if (res.ok) {
        const fileData = await res.json();
        const parsed = decodeBase64Json(fileData.content);
        if (Array.isArray(parsed.collected)) {
          collectedSet = new Set(parsed.collected);
          if (editable) {
            pendingAdditions.forEach((id) => collectedSet.add(id));
            pendingRemovals.forEach((id) => collectedSet.delete(id));
          }
          renderBinderPage();
          updateSyncIndicator(
            editable ? "synced" : "idle",
            editable ? "Synced" : "Log in to make edits"
          );
          return;
        }
      } else if (res.status === 404 && editable) {
        // collection.json might not exist in repo yet; first save will create it
        renderBinderPage();
        updateSyncIndicator("synced", "Ready to Save");
        return;
      } else if (editable) {
        let errMsg = "";
        try {
          const errJson = await res.json();
          errMsg = errJson.message || "";
        } catch (_) {}
        if (res.status === 401 || res.status === 403) {
          pendingAdditions.clear();
          pendingRemovals.clear();
        }
        hadAuthError = true;
        updateSyncIndicator("error", formatGitHubError(res.status), errMsg);
      }
    } catch (err) {
      console.warn("GitHub API fetch failed, trying static file fallback:", err);
      if (editable) {
        hadAuthError = true;
        updateSyncIndicator("error", "Network Error", String(err.message || err));
      }
    }
  }

  // Fallback: fetch static ./collection.json
  try {
    const res = await fetch(`./collection.json`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.collected)) {
        collectedSet = new Set(data.collected);
        if (editable && !hadAuthError) {
          pendingAdditions.forEach((id) => collectedSet.add(id));
          pendingRemovals.forEach((id) => collectedSet.delete(id));
        }
        renderBinderPage();
      }
    }
  } catch (e) {
    // Running via file:// or offline
  }

  if (!hadAuthError) {
    updateSyncIndicator(
      editable ? "synced" : "idle",
      editable ? "Synced" : "Log in to make edits"
    );
  }
}

// Schedule debounced save + auto-merge to GitHub API
function scheduleGitHubSave() {
  if (!canEdit()) {
    updateSyncIndicator("idle", "Log in to make edits");
    return;
  }

  updateSyncIndicator("saving", "Saving...");
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncTimeout = null;
    pushChangesToGitHub();
  }, 500);
}

// Auto-merge local toggles onto latest remote collection.json and commit
async function pushChangesToGitHub() {
  const config = getDefaultGitHubConfig();
  if (!canEdit()) {
    updateSyncIndicator("idle", "Log in to make edits");
    return;
  }

  if (isSyncing) return;

  if (pendingAdditions.size === 0 && pendingRemovals.size === 0) {
    updateSyncIndicator("synced", "Synced");
    return;
  }

  isSyncing = true;
  let hadError = false;
  updateSyncIndicator("saving", "Saving...");

  // Snapshot the changes we are about to commit
  const addSnapshot = new Set(pendingAdditions);
  const removeSnapshot = new Set(pendingRemovals);

  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/collection.json`;
  const branch = config.branch || "main";
  const authHeaders = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${config.token}`,
  };

  try {
    // 1. Fetch latest file and SHA from GitHub so 2 users never overwrite each other
    const getRes = await fetch(`${baseUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: authHeaders,
      cache: "no-store",
    });

    let currentSha = null;
    let mergedSet = new Set(collectedSet);

    if (getRes.ok) {
      const fileData = await getRes.json();
      currentSha = fileData.sha;
      const remoteObj = decodeBase64Json(fileData.content);
      mergedSet = new Set(Array.isArray(remoteObj.collected) ? remoteObj.collected : []);

      // Apply our pending additions and removals onto the latest remote list
      addSnapshot.forEach((id) => mergedSet.add(id));
      removeSnapshot.forEach((id) => mergedSet.delete(id));
    } else if (getRes.status !== 404) {
      let errMsg = "";
      try {
        const errJson = await getRes.json();
        errMsg = errJson.message || "";
      } catch (_) {}
      throw { status: getRes.status, message: errMsg };
    }

    const sortedList = Array.from(mergedSet).sort((a, b) => a - b);
    const body = {
      message: `Update binder collection (${sortedList.length}/${TOTAL_POKEMON} collected)`,
      content: encodeBase64Json({ collected: sortedList }),
      branch,
    };
    if (currentSha) {
      body.sha = currentSha;
    }

    // 2. Commit merged collection.json back to GitHub
    const putRes = await fetch(baseUrl, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!putRes.ok) {
      let errMsg = "";
      try {
        const errJson = await putRes.json();
        errMsg = errJson.message || "";
      } catch (_) {}
      throw { status: putRes.status, message: errMsg };
    }

    // Clear committed items from pending sets
    addSnapshot.forEach((id) => pendingAdditions.delete(id));
    removeSnapshot.forEach((id) => pendingRemovals.delete(id));

    // Update local state with any cards the other person added in the meantime
    collectedSet = mergedSet;
    pendingAdditions.forEach((id) => collectedSet.add(id));
    pendingRemovals.forEach((id) => collectedSet.delete(id));
    renderBinderPage();

    updateSyncIndicator("synced", "Synced");
  } catch (err) {
    hadError = true;
    console.error("Failed to sync with GitHub:", err);
    if (err && (err.status === 401 || err.status === 403)) {
      pendingAdditions.clear();
      pendingRemovals.clear();
      await fetchRemoteCollection();
    }
    const statusLabel = err && err.status
      ? formatGitHubError(err.status)
      : "Sync Error (Tap to Check)";
    updateSyncIndicator("error", statusLabel, err && err.message ? err.message : String(err));
  } finally {
    isSyncing = false;
    // Only auto-schedule another pass if the previous pass succeeded AND new clicks arrived
    if (!hadError && (pendingAdditions.size > 0 || pendingRemovals.size > 0)) {
      scheduleGitHubSave();
    }
  }
}

// Jump to a specific Pokémon's binder page and highlight its slot
function jumpToPokemon(dexId) {
  const targetPage = Math.ceil(dexId / CARDS_PER_PAGE);
  currentPage = Math.max(1, Math.min(TOTAL_PAGES, targetPage));
  renderBinderPage(dexId);
}

// Event Listeners
prevPageBtn.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    renderBinderPage();
  }
});

nextPageBtn.addEventListener("click", () => {
  if (currentPage < TOTAL_PAGES) {
    currentPage++;
    renderBinderPage();
  }
});

pageSelect.addEventListener("change", (e) => {
  currentPage = parseInt(e.target.value, 10) || 1;
  renderBinderPage();
});

genSelect.addEventListener("change", (e) => {
  const startDex = parseInt(e.target.value, 10);
  if (startDex) {
    jumpToPokemon(startDex);
    genSelect.value = "";
  }
});

// Keyboard Left/Right navigation
window.addEventListener("keydown", (e) => {
  if (
    document.activeElement === searchInput ||
    !syncModal.classList.contains("hidden")
  ) {
    return;
  }
  if (e.key === "ArrowLeft" && currentPage > 1) {
    currentPage--;
    renderBinderPage();
  } else if (e.key === "ArrowRight" && currentPage < TOTAL_PAGES) {
    currentPage++;
    renderBinderPage();
  }
});

// Touch Swipe Left/Right on Binder Page
let touchStartX = null;
binderGrid.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
    }
  },
  { passive: true }
);

binderGrid.addEventListener(
  "touchend",
  (e) => {
    if (touchStartX === null || e.changedTouches.length === 0) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(deltaX) > 60) {
      if (deltaX < 0 && currentPage < TOTAL_PAGES) {
        currentPage++;
        renderBinderPage();
      } else if (deltaX > 0 && currentPage > 1) {
        currentPage--;
        renderBinderPage();
      }
    }
    touchStartX = null;
  },
  { passive: true }
);

// Search Input Logic
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    searchResults.classList.add("hidden");
    return;
  }

  const matches = [];
  for (let id = 1; id <= TOTAL_POKEMON; id++) {
    const name = getPokemonName(id).toLowerCase();
    const numStr = String(id);
    const padded = formatDexNumber(id).toLowerCase();
    if (name.includes(query) || numStr === query || padded.includes(query)) {
      matches.push(id);
      if (matches.length >= 12) break;
    }
  }

  searchResults.innerHTML = "";
  if (matches.length === 0) {
    searchResults.classList.add("hidden");
    return;
  }

  matches.forEach((id) => {
    const row = document.createElement("div");
    row.className = "search-item";
    const owned = collectedSet.has(id);
    const pageNum = Math.ceil(id / CARDS_PER_PAGE);
    row.innerHTML = `
      <span><strong>${formatDexNumber(id)}</strong> ${getPokemonName(id)} <small style="color:#94a3b8">(Page ${pageNum})</small></span>
      <span class="search-item-status ${owned ? "owned" : "missing"}">${owned ? "Collected" : "Missing"}</span>
    `;
    row.addEventListener("click", () => {
      jumpToPokemon(id);
      searchResults.classList.add("hidden");
      searchInput.value = "";
    });
    searchResults.appendChild(row);
  });

  searchResults.classList.remove("hidden");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrapper")) {
    searchResults.classList.add("hidden");
  }
});

// Refresh Button
refreshBtn.addEventListener("click", async () => {
  updateSyncIndicator("saving", "Refreshing...");
  await fetchRemoteCollection();
  if (pendingAdditions.size > 0 || pendingRemovals.size > 0) {
    pushChangesToGitHub();
  }
});

// Sync Settings Modal
syncSettingsBtn.addEventListener("click", () => {
  const cfg = getDefaultGitHubConfig();
  ghOwnerInput.value = cfg.owner || "";
  ghRepoInput.value = cfg.repo || "";
  ghBranchInput.value = cfg.branch || "main";
  ghTokenInput.value = cfg.token || "";
  syncModal.classList.remove("hidden");
});

closeModalBtn.addEventListener("click", () => {
  syncModal.classList.add("hidden");
});

syncModal.addEventListener("click", (e) => {
  if (e.target === syncModal) {
    syncModal.classList.add("hidden");
  }
});

clearSyncBtn.addEventListener("click", async () => {
  localStorage.removeItem(STORAGE_KEYS.GH_CONFIG);
  localStorage.removeItem(STORAGE_KEYS.COLLECTED);
  pendingAdditions.clear();
  pendingRemovals.clear();
  ghTokenInput.value = "";
  syncModal.classList.add("hidden");
  renderBinderPage();
  updateSyncIndicator("idle", "Log in to make edits");
  await fetchRemoteCollection();
});

syncForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = sanitizeConfig({
    owner: ghOwnerInput.value,
    repo: ghRepoInput.value,
    branch: ghBranchInput.value,
    token: ghTokenInput.value,
  });
  saveGitHubConfig(cfg);
  syncModal.classList.add("hidden");
  updateSyncIndicator("saving", "Syncing...");
  await fetchRemoteCollection();
  if (pendingAdditions.size > 0 || pendingRemovals.size > 0) {
    pushChangesToGitHub();
  }
});

// Initialize App
initPageDropdown();
loadLocalState();
renderBinderPage();
fetchPokemonNames();
fetchRemoteCollection();
