"use strict";

/* ===================== Utilitaires ===================== */

const $ = (sel) => document.querySelector(sel);
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

// Normalise caractère par caractère pour garder l'alignement avec le nom d'origine
// (utile pour surligner la correspondance) : minuscules, sans accents, tirets → espaces.
function fold(str) {
  let out = "";
  for (const ch of str) {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += /[-'’_.,/()]/.test(base) ? " " : (base[0] || " ");
  }
  return out;
}
// Forme de comparaison : « saint » et « st » sont équivalents.
const canon = (s) => s.replace(/\bsainte\b/g, "ste").replace(/\bsaint\b/g, "st").replace(/\s+/g, " ").trim();

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
            Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];
function formatKm(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km).toLocaleString("fr-FR")} km`;
}
const formatCoord = (v) => v.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");

const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// Liens de navigation. Sur iPhone on passe par les schémas des applis :
// ils s'ouvrent directement, sans réseau et sans passer par Safari.
const APPS = {
  waze: (p) => isApple ? `waze://?ll=${p.lat},${p.lon}&navigate=yes`
                       : `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`,
  gmaps: (p) => isApple ? `comgooglemaps://?daddr=${p.lat},${p.lon}&directionsmode=driving`
                        : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`,
  plans: (p) => isApple ? `maps://?daddr=${p.lat},${p.lon}&dirflg=d`
                        : `https://maps.apple.com/?daddr=${p.lat},${p.lon}&dirflg=d`,
};

/* ===================== État ===================== */

let plants = [];
const state = {
  mode: "az",
  query: "",
  pos: null,          // { lat, lon }
  locating: false,
  locError: "",
  favs: new Set(store.get("favs", [])),
  recents: store.get("recents", []),
  preferredApp: store.get("preferredApp", ""),
  current: null,
};

/* ===================== Rendu ===================== */

const ICON_ARROW = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 19 21l-7-4-7 4z"/></svg>';
const ICON_STAR = '<svg class="row-star" viewBox="0 0 24 24" aria-label="Favori"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';
const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';

function highlight(p, tokens) {
  if (!tokens.length) return escapeHtml(p.n);
  const marks = new Array(p.n.length).fill(false);
  for (const t of tokens) {
    const i = p.fold.indexOf(t);
    if (i >= 0) for (let k = i; k < i + t.length && k < marks.length; k++) marks[k] = true;
  }
  let html = "", open = false;
  [...p.n].forEach((ch, i) => {
    if (marks[i] && !open) { html += "<mark>"; open = true; }
    if (!marks[i] && open) { html += "</mark>"; open = false; }
    html += escapeHtml(ch);
  });
  return open ? html + "</mark>" : html;
}

function rowHtml(p, tokens) {
  let meta = "";
  if (state.pos) {
    const km = distanceKm(state.pos, p);
    const deg = bearing(state.pos, p);
    meta = `${ICON_ARROW.replace("<svg", `<svg style="transform:rotate(${deg.toFixed(0)}deg)"`)}<span>${formatKm(km)} ${compass(deg)}</span>`;
  } else {
    meta = `<span>${formatCoord(p.lat)}, ${formatCoord(p.lon)}</span>`;
  }
  if (p.r) meta += `<span class="tag">${p.r}</span>`;
  return `<li><button class="row" data-id="${p.id}">
    <span class="row-main"><span class="row-name">${highlight(p, tokens)}</span><span class="row-meta">${meta}</span></span>
    ${state.favs.has(p.id) ? ICON_STAR : ""}${ICON_CHEV}
  </button></li>`;
}

function group(label, items, tokens, small = false) {
  return `<li><h2 class="group-label${small ? " small" : ""}">${label}</h2><ul class="group">${items.map((p) => rowHtml(p, tokens)).join("")}</ul></li>`;
}

function render() {
  const tokens = canon(fold(state.query)).split(" ").filter(Boolean);
  const rawTokens = fold(state.query).split(" ").filter(Boolean);
  let items = plants;
  if (tokens.length) items = items.filter((p) => tokens.every((t) => p.canon.includes(t)));
  if (state.mode === "fav") items = items.filter((p) => state.favs.has(p.id));

  const list = $("#list"), empty = $("#empty");
  let html = "";

  if (state.mode === "near") {
    if (!state.pos) {
      list.innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = state.locating
        ? "Recherche de votre position…"
        : `${escapeHtml(state.locError || "La position sert à classer les centrales de la plus proche à la plus lointaine.")}<br><button type="button" data-action="locate">Utiliser ma position</button>`;
      return;
    }
    items = items.map((p) => [distanceKm(state.pos, p), p]).sort((a, b) => a[0] - b[0]).slice(0, tokens.length ? 200 : 60).map((x) => x[1]);
    if (items.length) html = group(tokens.length ? "Résultats" : "Les plus proches", items, rawTokens, true);
  } else if (state.mode === "fav" || tokens.length) {
    if (items.length) html = group(state.mode === "fav" ? "Favoris" : `${items.length} résultat${items.length > 1 ? "s" : ""}`, items, rawTokens, true);
  } else {
    const recents = state.recents.map((id) => byId.get(id)).filter(Boolean);
    if (recents.length) html += group("Récents", recents, [], true);
    let letter = "", bucket = [];
    for (const p of items) {
      const l = /[a-z]/.test(p.fold[0]) ? p.fold[0].toUpperCase() : "#";
      if (l !== letter && bucket.length) { html += group(letter, bucket, []); bucket = []; }
      letter = l; bucket.push(p);
    }
    if (bucket.length) html += group(letter, bucket, []);
  }

  list.innerHTML = html;
  empty.hidden = !!html;
  if (!html) {
    empty.innerHTML = state.mode === "fav" && !tokens.length
      ? "Aucun favori pour l'instant. Ouvrez une centrale et touchez l'étoile pour la retrouver ici."
      : `Aucune centrale ne correspond à « ${escapeHtml(state.query)} ».<br><button type="button" data-action="clear">Effacer la recherche</button>`;
  }
}

function renderFavCount() {
  $("#favCount").textContent = state.favs.size ? state.favs.size : "";
}

/* ===================== Position ===================== */

function locate() {
  if (!("geolocation" in navigator)) {
    state.locError = "La localisation n'est pas disponible sur cet appareil.";
    return render();
  }
  state.locating = true; state.locError = "";
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.locating = false;
      state.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      render();
    },
    (err) => {
      state.locating = false;
      state.locError = err.code === 1
        ? "L'accès à la position est refusé. Autorisez-le dans Réglages › Confidentialité › Service de localisation."
        : "Position introuvable pour le moment. Réessayez à découvert.";
      render();
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }
  );
}

/* ===================== Feuille de lancement ===================== */

const sheet = $("#sheet");

function openSheet(p) {
  state.current = p;
  $("#sheetName").textContent = p.n;
  let meta = `${formatCoord(p.lat)}, ${formatCoord(p.lon)}`;
  if (state.pos) meta = `${formatKm(distanceKm(state.pos, p))} à vol d'oiseau, direction ${compass(bearing(state.pos, p))}`;
  if (p.r) meta += ` — ${p.r}`;
  $("#sheetMeta").textContent = meta;
  const star = $("#sheetStar"), fav = state.favs.has(p.id);
  star.setAttribute("aria-pressed", fav);
  star.setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
  $("#goWaze").href = APPS.waze(p);
  $("#goGmaps").href = APPS.gmaps(p);
  $("#goPlans").href = APPS.plans(p);
  for (const [key, el] of [["waze", "#goWaze"], ["gmaps", "#goGmaps"], ["plans", "#goPlans"]]) {
    $(el).classList.toggle("preferred", state.preferredApp === key);
  }
  $("#offlineHint").hidden = navigator.onLine;
  sheet.showModal();
}

function closeSheet() { if (sheet.open) sheet.close(); }

function launched(appKey) {
  const p = state.current;
  if (!p) return;
  state.recents = [p.id, ...state.recents.filter((id) => id !== p.id)].slice(0, 5);
  store.set("recents", state.recents);
  state.preferredApp = appKey;
  store.set("preferredApp", appKey);
  setTimeout(() => { closeSheet(); render(); }, 400);
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ===================== Statut hors ligne ===================== */

function renderStatus() {
  const s = $("#status");
  if (!navigator.onLine) {
    s.hidden = false; s.className = "status"; s.textContent = "Sans réseau";
  } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    s.hidden = false; s.className = "status ok"; s.textContent = "Prête hors ligne";
  } else {
    s.hidden = true;
  }
}

/* ===================== Événements ===================== */

const byId = new Map();
let searchTimer;

function bind() {
  const q = $("#q"), clear = $("#clear");
  q.addEventListener("input", () => {
    clear.hidden = !q.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = q.value; render(); window.scrollTo(0, 0); }, 60);
  });
  clear.addEventListener("click", () => { q.value = ""; clear.hidden = true; state.query = ""; render(); q.focus(); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") q.blur(); });

  document.querySelectorAll(".modes button").forEach((b) => b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll(".modes button").forEach((x) => x.setAttribute("aria-selected", x === b));
    if (state.mode === "near" && !state.pos && !state.locating) locate();
    render();
    window.scrollTo(0, 0);
  }));

  $("#main").addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (row) { q.blur(); return openSheet(byId.get(row.dataset.id)); }
    const action = e.target.closest("[data-action]");
    if (action?.dataset.action === "locate") locate();
    if (action?.dataset.action === "clear") clear.click();
  });

  $("#sheetStar").addEventListener("click", () => {
    const p = state.current;
    if (state.favs.has(p.id)) state.favs.delete(p.id); else state.favs.add(p.id);
    store.set("favs", [...state.favs]);
    const fav = state.favs.has(p.id);
    $("#sheetStar").setAttribute("aria-pressed", fav);
    $("#sheetStar").setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
    renderFavCount();
    render();
    toast(fav ? "Ajoutée aux favoris" : "Retirée des favoris");
  });

  $("#goWaze").addEventListener("click", () => launched("waze"));
  $("#goGmaps").addEventListener("click", () => launched("gmaps"));
  $("#goPlans").addEventListener("click", () => launched("plans"));

  $("#copy").addEventListener("click", async () => {
    const p = state.current;
    try { await navigator.clipboard.writeText(`${p.lat}, ${p.lon}`); toast("Coordonnées copiées"); }
    catch { toast(`${p.lat}, ${p.lon}`); }
  });
  $("#close").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  const top = $(".top");
  window.addEventListener("scroll", () => top.classList.toggle("scrolled", window.scrollY > 4), { passive: true });
  window.addEventListener("online", renderStatus);
  window.addEventListener("offline", renderStatus);
}

/* ===================== Démarrage ===================== */

async function init() {
  bind();
  renderFavCount();
  try {
    const res = await fetch("data/centrales.json");
    const raw = await res.json();
    plants = raw.map((p) => {
      const f = fold(p.n);
      return { ...p, id: `${p.n}|${p.lat}|${p.lon}`, fold: f, canon: canon(f) };
    }).sort((a, b) => a.n.localeCompare(b.n, "fr", { sensitivity: "base", numeric: true }));
    plants.forEach((p) => byId.set(p.id, p));
    // Nettoie les favoris/récents qui n'existent plus dans la liste
    state.recents = state.recents.filter((id) => byId.has(id));
    $("#q").placeholder = `Rechercher parmi ${plants.length} centrales`;
  } catch {
    $("#empty").hidden = false;
    $("#empty").textContent = "La liste des centrales n'a pas pu être chargée. Ouvrez l'appli une fois avec du réseau pour l'enregistrer sur le téléphone.";
    return;
  }
  render();

  if (isApple && !isStandalone) {
    const note = $("#note");
    note.hidden = false;
    note.textContent = "Pour l'installer : touchez Partager, puis «\u00a0Sur l'écran d'accueil\u00a0».";
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(renderStatus).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", renderStatus);
}
renderStatus();
init();
