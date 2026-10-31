const API_BASE = "https://jikan.lucashdo.com/v1";
renderAll()

/* ---------------- Pages Wrapper ---------------- */
document.getElementById('library').addEventListener('click', () => {
    window.location.href = "/home.html";
})

const accountIcon = document.getElementById('accountIcon')
accountIcon.addEventListener('click', () => {
    if (accountIcon.className === 'page-btn-unselected') {
        accountIcon.className = 'page-btn'
        document.getElementById('accountBurger').style.display = 'flex'
    } else {
        accountIcon.className = 'page-btn-unselected'
        document.getElementById('accountBurger').style.display = 'none'
    }
})

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
    // document.getElementById("tabs").style.display = 'none';

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
        ${a.relations ? `
            <div class="relations-flex">
                ${a.relations.map((r) => `
                    <button class="relation-box" data-mal-id="${r.malId}">
                        <h4>${escapeHtml(r.relation)}</h4>
                        <h3 class="relation-title">${escapeHtml(r.title)}</h3>
                        <span>${escapeHtml(r.type)}</span>
                    </button>
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

    document.querySelector('.relations-flex')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.relation-box');
        if (!btn) return;
        const type = btn.querySelector('span')?.textContent;
        const malId = btn.dataset.malId;

        if (type !== 'anime') {
            alert('Manga non ancora supportati, ci stiamo lavorando')
            return;
        }

        closeModal()
        openModal(malId);
    });
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
    // renderHero();
    renderCatalogue();
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});
