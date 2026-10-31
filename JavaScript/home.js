"use strict";

/* ============================================================
   UmaSeries — home.js
   Solo ciò che riguarda QUESTA pagina (hero "Cosa guardo ora"
   con carosello, libreria con le tab). Tutto il resto — stato,
   salvataggio, API, modale, ricerca, barra di salvataggio — è
   in common.js, caricato prima di questo file.
   ============================================================ */

wireNavButton('catalogue', '/catalogue.html');
wireAccountToggle();

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

    if (!pick.episode && pick.type !== 'Movie') {
        try {
            const episode = await fetchEpisode(pick.malId, watched + 1)

            if (episode.title) {
                updateEntry(pick.malId, { episode: episode })
            }

        } catch (e) {
            console.error("episodio non caricato :( ", e, watched)
        }
    }

    if (!pick.episode && pick.type === 'Movie') {
        let [hours, minutes] = pick.duration.split('hr.');
        hours = hours.trim()
        minutes = minutes.replace('min.', '').trim()
        if (hours < 10) hours = `0${hours}`
        if (minutes < 10) minutes = `0${minutes}`
        const duration = `${hours}:${minutes}:00`

        const episode = {
            "malId": pick.malId,
            "title": null,
            "episode": 1,
            "duration": duration,
            "aired": pick.startAired,
            "synopsis": pick.synopsis
        }

        updateEntry(pick.malId, { episode: episode })
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
                <h4 class="hero-anime">${pick?.episode?.aired && `${fixEpisodeDate(pick.episode.aired)}`} ${pick?.episode?.duration != null ? `- ${fixDuration(pick.episode.duration)}` : ""}</h4>
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


/* ---------------- Avvio ---------------- */

function renderAll() {
    renderHero();
    renderLibrary();
}

initStorage();
