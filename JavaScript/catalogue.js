"use strict";

/* ============================================================
   UmaSeries — catalogue.js
   Solo ciò che riguarda QUESTA pagina (il catalogo stagionale,
   e in futuro le altre categorie). Tutto il resto — stato,
   salvataggio, API, modale, ricerca, barra di salvataggio — è
   in common.js, caricato prima di questo file.
   ============================================================ */

wireNavButton('library', '/');
wireAccountToggle();

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

/* ---------------- Avvio ---------------- */

// Il catalogo stagionale non dipende dalla libreria, quindi non c'è
// nulla da ridisegnare quando la libreria cambia (es. aggiungendo un
// anime dal modale) — il modale stesso si aggiorna già da solo.
function renderAll() { }

initStorage();
