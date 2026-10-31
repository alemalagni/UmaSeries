"use strict";

/* ============================================================
   UmaSeries — home.js
   - Cerca anime tramite l'API jikan-edge (jikan.lucashdo.com)
   - Salva libreria + dati API in dati.json (via File System Access API,
     con fallback a localStorage/import-export per i browser che non
     la supportano)
   - Suggerisce quale anime guardare adesso
   ============================================================ */

const API_BASE = "https://jikan.lucashdo.com/v1";
const SUPPORTS_FS_ACCESS = "showOpenFilePicker" in window;

const state = {
    data: { anime: {} },
    storageMode: "checking", // "fs" | "fs-pending" | "local" | "none" | "checking"
    fileHandle: null,
    pendingHandle: null,
    activeTab: "watching",
    heroIndex: 0,
    searchResults: [],
    detailCache: {}, // malId -> dati grezzi dell'API, per gli anime non ancora salvati (catalogo/ricerca)
};

/* ---------------- IndexedDB (solo per ricordare il file handle) ---------------- */

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("UmaSeriesDB", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("handles");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readonly");
        const req = tx.objectStore("handles").get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/* ---------------- Storage: dati.json ---------------- */

function defaultData() {
    return { anime: {} };
}

async function initStorage() {
    if (SUPPORTS_FS_ACCESS) {
        const handle = await idbGet("datiJson").catch(() => null);
        if (handle) {
            const perm = await handle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
            if (perm === "granted") {
                state.fileHandle = handle;
                state.storageMode = "fs";
                await loadFromHandle();
            } else {
                state.pendingHandle = handle;
                state.storageMode = "fs-pending";
                loadLocalFallback();
            }
        } else {
            loadLocalFallback();
            state.storageMode = hasLocalData() ? "local" : "none";
        }
    } else {
        loadLocalFallback();
        state.storageMode = "local";
    }
    renderStorageBar();
    renderAll();
}

function hasLocalData() {
    return !!localStorage.getItem("umaseries_dati");
}

function loadLocalFallback() {
    try {
        const raw = localStorage.getItem("umaseries_dati");
        state.data = raw ? JSON.parse(raw) : defaultData();
    } catch (e) {
        state.data = defaultData();
    }
}

async function loadFromHandle() {
    try {
        const file = await state.fileHandle.getFile();
        const text = await file.text();
        state.data = text.trim() ? JSON.parse(text) : defaultData();
    } catch (e) {
        console.error("Errore leggendo dati.json", e);
        state.data = defaultData();
    }
}

async function connectExisting() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
        state.fileHandle = handle;
        await idbSet("datiJson", handle);
        await loadFromHandle();
        state.storageMode = "fs";
        renderStorageBar();
        renderAll();
        toast("dati.json collegato.");
    } catch (e) {
        if (e.name !== "AbortError") toast("Impossibile collegare il file.", true);
    }
}

async function connectNew() {
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: "dati.json",
            types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
        state.fileHandle = handle;
        state.data = hasLocalData() ? state.data : defaultData();
        await writeToHandle(handle, state.data);
        await idbSet("datiJson", handle);
        state.storageMode = "fs";
        renderStorageBar();
        renderAll();
        toast("dati.json creato e collegato.");
    } catch (e) {
        if (e.name !== "AbortError") toast("Impossibile creare il file.", true);
    }
}

async function reconnect() {
    try {
        const perm = await state.pendingHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") {
            toast("Permesso non concesso.", true);
            return;
        }
        state.fileHandle = state.pendingHandle;
        state.pendingHandle = null;
        await loadFromHandle();
        state.storageMode = "fs";
        renderStorageBar();
        renderAll();
        toast("dati.json ricollegato.");
    } catch (e) {
        toast("Impossibile ricollegare il file.", true);
    }
}

async function writeToHandle(handle, data) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
}

async function saveData() {
    if (state.storageMode === "fs" && state.fileHandle) {
        try {
            await writeToHandle(state.fileHandle, state.data);
        } catch (e) {
            console.error(e);
            toast("Errore salvando dati.json.", true);
        }
    } else {
        localStorage.setItem("umaseries_dati", JSON.stringify(state.data));
        if (state.storageMode === "none") state.storageMode = "local";
    }
    renderStorageBar();
}

function exportJson() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dati.json";
    a.click();
    URL.revokeObjectURL(url);
}

function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            state.data = JSON.parse(reader.result) || defaultData();
            localStorage.setItem("umaseries_dati", JSON.stringify(state.data));
            state.storageMode = "local";
            renderStorageBar();
            renderAll();
            toast("dati.json importato.");
        } catch (e) {
            toast("File non valido.", true);
        }
    };
    reader.readAsText(file);
}

/* ---------------- API jikan-edge ---------------- */

async function searchAnime(query) {
    const url = `${API_BASE}/anime?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Richiesta API fallita (" + res.status + ")");
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
}

async function fetchEpisode(malId, ep) {
    const url = `${API_BASE}/anime/${malId}/episodes/${ep}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Richiesta API fallita (" + res.status + ")");
    const json = await res.json();
    return json.data;
}

function normalizeApiAnime(item) {
    return {
        malId: item.malId,
        title: item.title || "Senza titolo",
        image: item.images?.medium || item.images?.large || item.imageUrl || "",
        episodesTotal: item.episodes || null,
        animeStatus: item.status || "",
        score: item.score ?? null,
        type: item.type || "",
        url: item.url || "",
        startDate: item.startDate,
        endDate: item.endDate,
        rating: item.rating
    };
}

function saveAnime(anime) {
    return {
        malId: anime.malId,
        title: anime.title || "Senza titolo",
        titleEnglish: anime.titleEnglish || "Nessun titolo inglese",
        titleJapanese: anime.titleJapanese || "Nessun titolo giapponese",
        image: anime.images?.medium || anime.images?.large || anime.imageUrl || "",
        imageLarge: anime.images?.large || anime.images?.medium || anime.imageUrl || "",
        episodesTotal: anime.episodes || null,
        synopsis: anime.synopsis || "",
        animeStatus: anime.status || "",
        score: anime.score ?? null,
        type: anime.type || "",
        genres: Array.isArray(anime.genres) ? anime.genres.map((g) => g.name) : [],
        url: anime.url || "",
        airedString: anime.aired?.string || "",
        startAired: anime.aired?.from || null,
        endAired: anime.aired?.to || null,
        rating: anime.rating,
        season: anime.season,
        year: anime.year,
        duration: anime.duration,
        broadcast: anime.broadcast,
        relations: anime.relations
    };
}

/* ---------------- Logica libreria ---------------- */

function addToLibrary(apiAnime, userStatus) {
    const existing = state.data.anime[apiAnime.malId];
    const now = new Date().toISOString();
    const episodesWatched =
        userStatus === "completed" && apiAnime.episodesTotal ? apiAnime.episodesTotal : 0;

    state.data.anime[apiAnime.malId] = {
        ...apiAnime,
        cachedAt: now,
        userStatus,
        episodesWatched: existing ? existing.episodesWatched : episodesWatched,
        addedAt: existing ? existing.addedAt : now,
        updatedAt: now,
    };
    saveData();
    renderAll();
    toast(`"${apiAnime.title}" aggiunto a ${labelForStatus(userStatus)}.`);
}

function updateEntry(malId, patch) {
    const entry = state.data.anime[malId];
    if (!entry) return;
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });

    if (entry.episodesTotal && entry.episodesWatched >= entry.episodesTotal) {
        entry.episodesWatched = entry.episodesTotal;
        if (entry.userStatus !== "completed") {
            entry.userStatus = "completed";
            toast(`Hai completato "${entry.title}"! 🎉`);
        }
    }
    saveData();
    renderAll();
}

function removeEntry(malId) {
    delete state.data.anime[malId];
    saveData();
    closeModal();
    renderAll();
}

function labelForStatus(status) {
    return { watching: "In corso", planned: "Da vedere", completed: "Completati" }[status] || status;
}

function entriesByStatus(status) {
    return Object.values(state.data.anime).filter((a) => a.userStatus === status);
}

/* ---------------- Suggerimento "Cosa guardo ora" ---------------- */
function fixEpisodeDate(airedStr) {
    if (!airedStr) return "";
    let clean = airedStr.replace(/\(JST\)/g, "").trim();
    // Se è YYYY-MM-DD usa la tua fixDate, altrimenti la formatta al volo
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return fixDate(clean);
    }
    // Per formati tipo "Jul 31, 2026"
    let d = new Date(clean);
    return isNaN(d) ? clean : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function pickCandidates() {
    const watching = entriesByStatus("watching").filter(
        (a) => !a.episodesTotal || a.episodesWatched < a.episodesTotal
    );
    const planned = entriesByStatus("planned");

    const candidates = {
        list: [...watching, ...planned]
    };

    candidates.list.sort((a, b) => a.addedAt.localeCompare(b.addedAt))

    if (candidates.list.length) {
        return candidates;
    }

    return { list: [] };
}

function fixDuration(duration) {
    const [hours, minutes, seconds] = duration.split(':').map(Number);
    const parts = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    if (seconds > 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(' ');
}

function fixDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d)) return "";
    const monthName = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    return `${d.getUTCDate()} ${monthName[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function renderHero() {
    const host = document.getElementById("heroCard");
    const { list } = pickCandidates();

    if (list.length === 0) {
        host.innerHTML = `<p class="hero-empty">Aggiungi un anime alla libreria per sapere cosa guardare.</p>`;
        document.getElementById("heroCarousel").innerHTML = "";
        return;
    }

    if (state.heroIndex >= list.length) state.heroIndex = 0;
    const pick = list[state.heroIndex];
    const total = pick.episodesTotal;
    const watched = pick.episodesWatched || 0;
    const pct = total ? Math.min(100, Math.round((watched / total) * 100)) : 0;

    if (!pick.episode || pick.episode.length === 0) {
        try {
            const episode = await fetchEpisode(pick.malId, watched + 1)

            if (episode.title) {
                updateEntry(pick.malId, { episode: episode })
            }

        } catch (e) {
            console.error("episodio non caricato :( ", e, watched)
        }
    }

    let colorHero;
    switch (watched) {
        case 0: colorHero = '#d96b4a';
            break;
        default: colorHero = '#d9b44a';
            break;
    }
    host.style.borderLeftColor = colorHero;

    host.innerHTML = `
            ${pick.imageLarge ? `<img class="hero-poster" src="${escapeAttr(pick.imageLarge)}" alt="">` : pick.Largeimage ? `<img class="hero-poster" src="${escapeAttr(pick.image)}" alt="">` : ""}
            <div class="hero-body">
                <span class="hero-eyebrow" style='color: ${colorHero}'>${watched > 0 ? "Continua a vedere" : "Inizia a vedere"}</span>
                ${pick?.episode ? `<h4 id="hero-title" class="hero-anime">${pick.title}</h4>` : ""}
                <h3 id="hero-episode">${pick?.episode && pick.episode?.title ? pick.episode.title : escapeHtml(pick.title)}</h3>
                <h4 class="hero-anime">${pick?.episode.aired && `${fixEpisodeDate(pick.episode.aired)}`} ${pick?.episode.duration != null ? `- ${fixDuration(pick.episode.duration)}` : ""}</h4>
                <span class="hero-meta">${total ? `Episodio ${watched + 1 > total ? total : watched + 1} di ${total}` : `Episodi visti: ${watched}`}</span>
                <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
                <div class="hero-actions">
                    <button class="btn btn-primary" id="heroWatchBtn" style='background-color: ${colorHero}'>Segna episodio visto</button>
                    <button class="btn btn-ghost" id="heroDetailBtn">Dettagli</button>
                </div>
                </div>
            `;

    const heroAnime = pick?.episode ? document.getElementById('hero-title') : document.getElementById('hero-episode')
    const heroEpisode = pick?.episode ? document.getElementById('hero-episode') : null

    heroAnime.addEventListener('click', () => {
        if (heroAnime.textContent === pick.title) {
            heroAnime.innerHTML = pick.titleEnglish;
        } else if (heroAnime.textContent === pick.titleEnglish) {
            heroAnime.innerHTML = pick.titleJapanese;
        } else {
            heroAnime.innerHTML = pick.title;
        }
    })

    if (heroEpisode != null) {
        heroEpisode.addEventListener('click', () => {

            let [romaji, japanese] = pick.episode.titleAlternative.split('(')
            romaji.trim()
            japanese = japanese.replace(')', '').trim();

            if (heroEpisode.textContent === pick.episode.title) {
                heroEpisode.innerHTML = japanese;
            } else if (heroEpisode.textContent === japanese) {
                heroEpisode.innerHTML = romaji;
            } else {
                heroEpisode.innerHTML = pick.episode.title;
            }
        })
    }

    document.getElementById("heroWatchBtn").addEventListener("click", async () => {
        try {
            const newEpisode = await fetchEpisode(pick.malId, watched + 2)
            updateEntry(pick.malId, {
                episodesWatched: watched + 1,
                episode: newEpisode
            });
        } catch (e) {
            alert('Errore nel caricamento nuovo episodio: ', e)
            console.error('Errore nel caricamento nuovo episodio: ', e)
            return
        }
    });

    const skipBtn = document.getElementById("heroSkipBtn");
    if (skipBtn) skipBtn.addEventListener("click", () => {
        state.heroIndex = (state.heroIndex + 1) % list.length;
        renderHero();
    });
    document.getElementById("heroDetailBtn").addEventListener("click", () => openModal(pick.malId));

    renderHeroCarousel(list);
}



function renderHeroCarousel(list) {
    const host = document.getElementById("heroCarousel");
    if (!host) return;
    if (list.length <= 1) {
        host.innerHTML = "";
        return;
    }
    host.innerHTML = list
        .map(
            (item, i) => `
        <button class="carousel-item ${i === state.heroIndex ? "active" : ""}" data-index="${i}" title="${escapeAttr(item.title)}">
            ${item.image ? `<img src="${escapeAttr(item.image)}" alt="">` : ""}
        </button>
    `
        )
        .join("");

    host.querySelectorAll(".carousel-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.heroIndex = Number(btn.dataset.index);
            renderHero();
        });
    });
}

/* ---------------- Libreria (tabs + griglia) ---------------- */

const library = document.getElementById('library')
const catalogue = document.getElementById('catalogue')

// Registrati una sola volta: prima venivano riaggiunti a ogni render,
// accumulandosi e facendo scattare il cambio di sezione più volte di seguito.
catalogue.addEventListener('click', () => {
    library.className = 'section-title-unselected'
    catalogue.className = 'section-title'
    renderCatalogue()
})

library.addEventListener('click', () => {
    catalogue.className = 'section-title-unselected'
    library.className = 'section-title'
    document.getElementById("tabs").style.display = 'flex';
    renderLibrary()
})

function renderLibrary() {
    document.getElementById("countWatching").textContent = entriesByStatus("watching").length;
    document.getElementById("countPlanned").textContent = entriesByStatus("planned").length;
    document.getElementById("countCompleted").textContent = entriesByStatus("completed").length;

    const grid = document.getElementById("libraryGrid");
    const items = entriesByStatus(state.activeTab).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    if (!items.length) {
        grid.innerHTML = `<p class="library-empty">Nessun anime in "${labelForStatus(state.activeTab)}".</p>`;
        return;
    }

    grid.innerHTML = items
        .map(
            (a) => `
        <button class="anime-card" data-id="${a.malId}">
        ${a.imageLarge ? `<img src="${escapeAttr(a.imageLarge)}" alt="">` : a.image ? `<img src="${escapeAttr(a.image)}" alt="">` : ""}
        <div class="anime-card-body">
        <span class="anime-card-title">${escapeHtml(a.title)}</span>
        <span class="anime-card-meta">${a.episodesTotal ? `${a.episodesWatched}/${a.episodesTotal} ep.` : `${a.episodesWatched} ep. visti`}</span>
        </div>
        </button>
        `
        )
        .join("");

    grid.querySelectorAll(".anime-card").forEach((card) => {
        card.addEventListener("click", () => openModal(card.dataset.id));
    });
}

document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    state.activeTab = btn.dataset.tab;
    renderLibrary();
});

/* ---------------- Catalogo ---------------- */
async function runSeason() {
    try {
        const url = `${API_BASE}/seasons/now`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Richiesta API fallita (" + res.status + ")");
        const json = await res.json();
        return json.data
    } catch (e) {
        console.error("C'è stato un problema nel caricamento anime stagionali, ", e)
    }
}
async function renderCatalogue() {
    document.getElementById("tabs").style.display = 'none';

    const seasonAnime = await runSeason();
    const grid = document.getElementById("libraryGrid");

    grid.innerHTML = seasonAnime
        .map(
            (a) => `
        <button class="anime-card" data-id="${a.malId}">
        ${a.imageUrl ? `<img src="${escapeAttr(a.imageUrl)}" alt="">` : ""}
        <div class="anime-card-body">
        <span class="anime-card-title">${escapeHtml(a.title)}</span>
        <span class="anime-card-meta">${a.episodes != null ? `${a.episodes} ep.` : ""}</span>
        </div>
        </button>
        `
        )
        .join("");

    grid.querySelectorAll(".anime-card").forEach((card) => {
        card.addEventListener("click", () => openModal(card.dataset.id));
    });
}


/* ---------------- Modale dettaglio ---------------- */

async function openModal(malId) {
    const overlay = document.getElementById("modalOverlay");
    const box = document.getElementById("modalBox");
    overlay.className = "modal-overlay";

    let a = state.data.anime[malId];
    const inLibrary = !!a;

    if (!a) {
        // Non è (ancora) in libreria: arriva dal catalogo stagionale o dalla ricerca,
        // quindi non abbiamo i dettagli completi salvati — li recuperiamo al volo.
        box.innerHTML = `<button class="modal-close" id="modalCloseBtn" aria-label="Chiudi">×</button><p class="hero-empty">Caricamento dei dettagli…</p>`;
        document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
        try {
            if (!state.detailCache[malId]) {
                const raw = await saveAnimeResult(malId);
                if (!raw || raw === "Errore" || !raw.malId) throw new Error("dettagli non disponibili");
                state.detailCache[malId] = raw;
            }
            a = saveAnime(state.detailCache[malId]);
        } catch (e) {
            console.error("Impossibile caricare i dettagli", e);
            box.innerHTML = `<button class="modal-close" id="modalCloseBtn" aria-label="Chiudi">×</button><p class="hero-empty">Impossibile caricare i dettagli di questo anime.</p>`;
            document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
            return;
        }
    }

    renderModalBody(a, inLibrary, malId);
}

function renderModalBody(a, inLibrary, malId) {
    const box = document.getElementById("modalBox");
    const overlay = document.getElementById("modalOverlay");

    const colors = {
        "TV": "#d48a01",
        "ONA": "#a829a8",
        "Movie": "#a21414",
        "winter": "#9dccdc",
        "spring": "#eeb6bf",
        "summer": "#dc420b",
        "fall": "#d08801",
        "G": "#6fa84a",
        "PG": "#d0ae01",
        "PG-13": "#d4820a",
        "R": "#b80505",
        "R+": "#a21414",
        "Rx": "#7a0e0e",
    };

    const ratingCode = a.rating ? a.rating.split(" ")[0] : "";
    const colorType = colors[a.type] || "none";
    const colorSeason = colors[a.season] || "none";
    const colorRating = colors[ratingCode] || "none";

    box.innerHTML = `
        <button class="modal-close" id="modalCloseBtn" aria-label="Chiudi">×</button>
        <div class="modal-head">
            ${a.image ? `<img src="${escapeAttr(a.image)}" alt="">` : ""}
            <div>
                <h3 id="modal-title">${escapeHtml(a.title)}</h3>
                <div class="tag-row">${a.type ? `<h4 class="type" style="color: ${colorType}; border-color: ${colorType}">${a.type}</h4>` : ""} ${a.season ? `<h5 style="color: ${colorSeason};">${a.season} ${a.year || ""}</h5>` : ""}</div>
                ${a.rating ? `<div class="modal-meta"><span style="color: ${colorRating};">${escapeHtml(a.rating)}</span></div>` : ""}
                <div class="modal-meta">${[a.score ? `★ ${a.score}` : ""].filter(Boolean).join(" · ")}</div>
                <div class="modal-meta">${a.startAired ? fixDate(a.startAired) : "?"}${a.endAired ? ` - ${fixDate(a.endAired)}` : ""}</div>
                <div class="modal-meta">${a.duration ? `${a.duration}` : ""}</div>
                </div>
            </div>
        <div class="tag-row">${a.genres.map((g) => `<span class="tag">${escapeHtml(g)}</span>`).join("")}</div>
        ${a.synopsis ? `<p class="modal-synopsis">${escapeHtml(a.synopsis)}</p>` : ""}
        ${inLibrary ? `
        <div class="field-row">
            <label for="statusSelect">Stato</label>
            <select id="statusSelect">
                <option value="watching" ${a.userStatus === "watching" ? "selected" : ""}>In corso</option>
                <option value="planned" ${a.userStatus === "planned" ? "selected" : ""}>Da vedere</option>
                <option value="completed" ${a.userStatus === "completed" ? "selected" : ""}>Completato</option>
            </select>
        </div>
        <div class="field-row">
            <label>Episodi visti</label>
            <div class="stepper">
                <button id="epMinus" aria-label="Riduci">−</button>
                <input id="epInput" type="number" min="0" ${a.episodesTotal ? `max="${a.episodesTotal}"` : ""} value="${a.episodesWatched}">
                <button id="epPlus" aria-label="Aumenta">+</button>
            </div>
        </div>
        ` : ""}
        ${a.url ? `<p class="hero-meta"><a href="${escapeAttr(a.url)}" target="_blank" rel="noopener" style="color:var(--accent)">Pagina su MyAnimeList ↗</a></p>` : ""}
        ${a.relations && a.relations.length ? `
            <div class="relations-flex">
                ${a.relations.map((r) => `
                    <div class="relation-box">
                        <h4>${escapeHtml(r.relation)}</h4>
                        <h3 class="relation-title">${escapeHtml(r.title)}</h3>
                        <span>${escapeHtml(r.type)}</span>
                    </div>
                `).join("")}
            </div>` : ""
        }
        ${inLibrary ? `
        <div class="modal-actions">
            <button class="btn-danger" id="removeBtn">Rimuovi dalla libreria</button>
        </div>
        ` : `
        <div class="modal-add-group">
            <button class="btn btn-primary" data-status="watching">Aggiungi · In corso</button>
            <button class="btn btn-ghost" data-status="planned">Aggiungi · Da vedere</button>
            <button class="btn btn-ghost" data-status="completed">Aggiungi · Visto</button>
        </div>
        `}
    `;

    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
    }, { once: true });

    const modalTitle = document.getElementById('modal-title')

    modalTitle.addEventListener('click', () => {
        if (modalTitle.textContent === escapeHtml(a.title)) {
            modalTitle.innerHTML = escapeHtml(a.titleEnglish);
        } else if (modalTitle.textContent === escapeHtml(a.titleEnglish)) {
            modalTitle.innerHTML = escapeHtml(a.titleJapanese);
        } else {
            modalTitle.innerHTML = escapeHtml(a.title);
        }
    })

    if (inLibrary) {
        document.getElementById("statusSelect").addEventListener("change", (e) => {
            updateEntry(a.malId, { userStatus: e.target.value });
            openModal(malId);
        });

        const epInput = document.getElementById("epInput");
        function commitEp(val) {
            let n = Math.max(0, parseInt(val, 10) || 0);
            if (a.episodesTotal) n = Math.min(n, a.episodesTotal);
            updateEntry(a.malId, { episodesWatched: n });
            openModal(malId);
        }
        document.getElementById("epMinus").addEventListener("click", () => commitEp(a.episodesWatched - 1));
        document.getElementById("epPlus").addEventListener("click", () => commitEp(a.episodesWatched + 1));
        epInput.addEventListener("change", () => commitEp(epInput.value));

        document.getElementById("removeBtn").addEventListener("click", () => {
            if (confirm(`Rimuovere "${a.title}" dalla libreria?`)) removeEntry(a.malId);
        });
    } else {
        box.querySelectorAll(".modal-add-group button").forEach((btn) => {
            btn.addEventListener("click", () => {
                addToLibrary(a, btn.dataset.status);
                delete state.detailCache[malId];
                openModal(malId);
            });
        });
    }
}

function closeModal() {
    document.getElementById("modalOverlay").className = ('modal-overlay-hidden');
}

/* ---------------- Ricerca ---------------- */

let searchDebounce = null;
const searchInput = document.getElementById("searchInput");
const searchPanel = document.getElementById("searchPanel");

searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) {
        searchPanel.hidden = true;
        return;
    }
    searchDebounce = setTimeout(() => runSearch(q), 500);
});

document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) searchPanel.hidden = true;
});

async function runSearch(query) {
    searchPanel.hidden = false;
    searchPanel.innerHTML = `<p class="search-panel-msg">Ricerca in corso…</p>`;
    try {
        const raw = await searchAnime(query);
        state.searchResults = raw.map(normalizeApiAnime);
        renderSearchResults();
    } catch (e) {
        searchPanel.innerHTML = `<p class="search-panel-msg">Errore nella ricerca. Riprova tra poco.</p>`;
    }
}

async function saveAnimeResult(id) {
    try {
        const url = `${API_BASE}/anime/${id}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Richiesta API fallita (" + res.status + ")");
        const json = await res.json();
        if (json.data) {
            return json.data
        }
    } catch (e) {
        alert('Errore nel salvataggio');
        console.error(e);
        return "Errore";
    }
}

async function runSave(id) {
    try {
        const raw = await saveAnimeResult(id.malId)
        if (raw.malId) {
            const newAnime = saveAnime(raw);
            return newAnime
        }

    } catch (e) {
        alert('Errore nel salvataggio');
        console.error(e);
        return "Errore";
    }
}

function renderSearchResults() {
    if (!state.searchResults.length) {
        searchPanel.innerHTML = `<p class="search-panel-msg">Nessun risultato.</p>`;
        return;
    }
    searchPanel.innerHTML = state.searchResults
        .map(
            (a) => `
        <div class="search-result">
            ${a.image ? `<img src="${escapeAttr(a.image)}" alt="">` : ""}
            <div class="search-result-info">
                <strong>${escapeHtml(a.title)}</strong>
                <span>${[a.type, a.episodesTotal ? `${a.episodesTotal} ep.` : ""].filter(Boolean).join(" · ")}</span>
            </div>
            <div class="search-add-group">
                <button data-status="watching" data-id="${a.malId}">In corso</button>
                <button data-status="planned" data-id="${a.malId}">Da vedere</button>
                <button data-status="completed" data-id="${a.malId}">Visto</button>
            </div>
        </div>
    `
        )
        .join("");

    searchPanel.querySelectorAll(".search-add-group button").forEach((btn) => {
        btn.addEventListener("click", async () => {
            try {
                const malId = state.searchResults.find((a) => String(a.malId) === btn.dataset.id);
                const anime = await runSave(malId)
                addToLibrary(anime, btn.dataset.status);
                searchPanel.hidden = true;
                searchInput.value = "";
            } catch (e) {
                alert('Errore nel salvataggio');
                console.error(e);
                return "Errore";
            }
        });
    });
}

/* ---------------- Barra storage ---------------- */

function renderStorageBar() {
    const dot = document.getElementById("storageDot");
    const label = document.getElementById("storageLabel");
    const actions = document.getElementById("storageActions");
    dot.className = "storage-dot";
    actions.innerHTML = "";

    if (state.storageMode === "fs") {
        dot.classList.add("ok");
        label.textContent = "dati.json collegato";
    } else if (state.storageMode === "fs-pending") {
        dot.classList.add("warn");
        label.textContent = "dati.json da ricollegare";
        actions.innerHTML = `<button id="reconnectBtn">Ricollega</button>`;
        actions.querySelector("#reconnectBtn").addEventListener("click", reconnect);
    } else if (state.storageMode === "local") {
        dot.classList.add("warn");
        label.textContent = SUPPORTS_FS_ACCESS ? "salvataggio locale (non su dati.json)" : "salvataggio nel browser";
        actions.innerHTML = buildConnectActions();
    } else {
        label.textContent = "nessun salvataggio collegato";
        actions.innerHTML = buildConnectActions();
    }
}

function buildConnectActions() {
    if (SUPPORTS_FS_ACCESS) {
        return `
            <button id="connectExistingBtn">Apri dati.json</button>
            <button id="connectNewBtn">Crea dati.json</button>
        `;
    }
    return `
        <button id="importBtn">Importa dati.json</button>
        <button id="exportBtn">Esporta dati.json</button>
    `;
}

document.getElementById("storageActions").addEventListener("click", (e) => {
    if (e.target.id === "connectExistingBtn") connectExisting();
    if (e.target.id === "connectNewBtn") connectNew();
    if (e.target.id === "exportBtn") exportJson();
    if (e.target.id === "importBtn") document.getElementById("importInput").click();
});

document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = "";
});

/* ---------------- Toast ---------------- */

function toast(message, isError = false) {
    const host = document.getElementById("toastHost");
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

/* ---------------- Utility ---------------- */

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function escapeAttr(str) {
    return escapeHtml(str);
}

/* ---------------- Avvio ---------------- */

function renderAll() {
    renderHero();
    renderLibrary();
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

initStorage();
