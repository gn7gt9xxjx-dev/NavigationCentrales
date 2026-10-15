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

const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// Ordinateur (ni iPhone/iPad, ni Android) : navigation dans un nouvel onglet, et fichier de favoris
// relié (Chrome, Edge : mis à jour sur place au lieu d'être téléchargé à nouveau).
const isDesktop = !isApple && !/Android|Mobi/i.test(navigator.userAgent);
const canLinkFile = isDesktop && "showSaveFilePicker" in window && "showOpenFilePicker" in window;

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

function regionOf(lat, lon) {
  if (lat < 0 && lon > 54 && lon < 57) return "La Réunion";
  if (lat > 1 && lat < 7 && lon > -55 && lon < -51) return "Guyane";
  return "";
}

// Leaflet (cartes) : chargé à la demande depuis vendor/, mis en cache par le service worker.
let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "vendor/leaflet/leaflet.js";
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletLoading = null; reject(new Error("leaflet")); };
    document.head.appendChild(js);
  });
  return leafletLoading;
}
const tileLayers = (L) => ({
  plan: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri, Maxar" }),
});

/* ===================== Groupes : UP, GEH, couleurs et icônes ===================== */

// Même classement et mêmes couleurs que l'ancienne carte Google « Centrales EDF » :
// une UP (ou CNPE, SEI / PEI…) regroupe des GEH (ou paliers), chacun avec sa couleur.
// Chaque centrale porte `up` et `geh` dans la liste partagée ; sans eux elle est grise.
// Couleurs relevées sur les icônes de l'ancienne carte.
const COLOR = {
  bleu: "#0058B8", orange: "#FC5814", orangeClair: "#FCA03C", noir: "#222222", vert: "#509C2C",
  violet: "#9014FC", jaune: "#FCF014", rouge: "#FC1414", lime: "#C4D400", brun: "#6D4C41",
};
const GREY = "#8C98A5";
const GROUPS = [
  { up: "CNPE", type: "nucleaire", geh: [["P'4", "lime"], ["CP1", "rouge"], ["P4", "vert"], ["CP0", "jaune"], ["CP2", "orangeClair"], ["N4", "bleu"]] },
  { up: "UP Centre", geh: [["GEH Dordogne", "bleu"], ["GEH Loire-Ardèche", "orange"], ["GEH Limoges", "noir"], ["GEH BERGERAC", "vert"], ["GEH Lot Truyère", "orangeClair"], ["GEH Ouest", "violet"], ["GEH Inconnu", "jaune"]] },
  { up: "UP Méditerranée", geh: [["GEH Durance", "violet"], ["GEH Var Roya", "bleu"]] },
  { up: "UP Sud-Ouest", geh: [["GEH Inconnu", "jaune"], ["GEH Adour et Gaves", "bleu"], ["GEH Aude Ariège", "orange"], ["GEH Garonne", "noir"], ["GEH Tarn Agout", "violet"]] },
  { up: "SEI / PEI", geh: [["SEI", "bleu"], ["PEI", "orange"]] },
  { up: "UP Alpes", geh: [["GEH Savoie Mont Blanc", "bleu"], ["GEH Ecrins Vercors", "vert"], ["GEH Vallée de la Maurienne", "noir"]] },
  { up: "UP Est", geh: [["GEH Jura-Bourgogne", "bleu"], ["GEH Rhin", "orange"], ["GEH Revin-St-Nicolas", "vert"], ["GEH Inconnu", "jaune"]] },
  { up: "Thermique", type: "thermique", geh: [["CPT", "brun"]] },
  { up: "Sites EDF", type: "site", geh: [["Bureaux", "bleu"], ["R&D", "violet"]] },   // pas des centrales
];
const GROUP_COLOR = new Map(GROUPS.flatMap((g) => g.geh.map(([geh, c]) => [`${g.up}|${geh}`, COLOR[c]])));
const UP_TYPE = new Map(GROUPS.map((g) => [g.up, g.type || "hydro"]));

// Type (forme de l'icône) : celui de l'UP, sinon deviné d'après le nom.
function typeOf(p) {
  if (p.up && UP_TYPE.has(p.up)) return UP_TYPE.get(p.up);
  if (/^CNPE\b/i.test(p.n)) return "nucleaire";
  if (/^CPT\b/i.test(p.n)) return "thermique";
  return "hydro";
}
const colorOf = (p) => GROUP_COLOR.get(`${p.up}|${p.geh}`) || GREY;
// Trait clair ou foncé selon la couleur de fond (jaune, lime : trait foncé).
function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.62 ? "#1B1B1B" : "#FFFFFF";
}

const SPOKES = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
  return `M${(16 + 4.3 * c).toFixed(1)} ${(11.5 + 4.3 * s).toFixed(1)}L${(16 + 6.3 * c).toFixed(1)} ${(11.5 + 6.3 * s).toFixed(1)}`;
}).join("");
const WAVE = (y) => `M8.5 ${y}q1.9-1.8 3.75 0t3.75 0 3.75 0 3.75 0`;
const TOWER = "M5.5 29.5Q13.5 20 9.8 10.5h12.4Q18.5 20 26.5 29.5z";
const HOUSE = "M5.5 29.5V13L16 4.5 26.5 13v16.5z";
const FLAME = "M16 2.5c.8 4.6 7.5 8 7.5 15.5a7.5 7.5 0 0 1-15 0c0-3.9 1.9-6.4 3.6-8.4.2 2.6 1.3 4.2 2.9 4.8-.6-4.8.3-8.4 1-11.9z";

// Icône d'une centrale (ou d'un groupe) : turbine sur l'eau, tour de refroidissement, flamme
// ou bâtiment (sites EDF qui ne sont pas des centrales).
function plantIcon(type, color) {
  const ink = inkOn(color);
  const shape = (d) => `<path d="${d}" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="3" stroke-linejoin="round"/>` +
                       `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`;
  let body;
  if (type === "nucleaire") {
    body = shape(TOWER) + `<path d="M14.2 8.4c0-2.4 1.8-3.2 3.6-3.2s3.4-.8 3.4-3" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="4.4" stroke-linecap="round"/>` +
           `<path d="M14.2 8.4c0-2.4 1.8-3.2 3.6-3.2s3.4-.8 3.4-3" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>`;
  } else if (type === "site") {
    body = shape(HOUSE) + `<path d="M11 16h3v3h-3zM18 16h3v3h-3zM14 29.5V23h4v6.5" fill="${ink}" stroke="none"/>`;
  } else if (type === "thermique") {
    body = shape(FLAME) + `<path d="M16 25c-1.7 0-2.8-1.2-2.8-2.8 0-1.6 1.3-2.8 2.8-4.7 1.5 1.9 2.8 3.1 2.8 4.7 0 1.6-1.1 2.8-2.8 2.8z" fill="${ink}" stroke="none"/>`;
  } else {
    body = `<circle cx="16" cy="16" r="14.4" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="3"/>` +
           `<circle cx="16" cy="16" r="14.4" fill="${color}" stroke="#fff" stroke-width="1.4"/>` +
           `<g fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"><circle cx="16" cy="11.5" r="2.6"/>` +
           `<path d="${SPOKES}${WAVE(21)}${WAVE(25)}"/></g>`;
  }
  return `<svg class="pi" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}
const iconOf = (p) => plantIcon(typeOf(p), colorOf(p));

/* ===================== État ===================== */

let basePlants = [];   // dernière liste partagée connue
let plants = [];       // liste affichée = liste partagée + modifications pas encore envoyées
const state = {
  mode: "az",
  query: "",
  pos: null,          // { lat, lon }
  locating: false,
  locError: "",
  favs: new Set(store.get("favs", [])),
  recents: store.get("recents", []),
  preferredApp: store.get("preferredApp", ""),
  pending: store.get("pending", []),   // modifications en attente d'envoi
  token: store.get("token", ""),       // code d'édition (vide = lecture seule)
  author: store.get("author", ""),
  sync: "idle",                        // idle | busy | ok | error | auth
  syncError: "",
  lastSync: store.get("lastSync", 0),
  current: null,
  view: store.get("nearView", "list"),             // « Autour de moi » : list | map
  hiddenUps: new Set(store.get("hiddenUps", [])),  // UP masquées sur la carte ("" = non classées)
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

const ICON_STAR_BIG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

function rowHtml(p, tokens, swipe = false, icon = false) {
  let meta = "";
  if (state.pos) {
    const km = distanceKm(state.pos, p);
    const deg = bearing(state.pos, p);
    meta = `${ICON_ARROW.replace("<svg", `<svg style="transform:rotate(${deg.toFixed(0)}deg)"`)}<span>${formatKm(km)} ${compass(deg)}</span>`;
  } else {
    meta = `<span>${formatCoord(p.lat)}, ${formatCoord(p.lon)}</span>`;
  }
  if (p.r) meta += `<span class="tag">${p.r}</span>`;
  if (p.note) meta += `<span class="tag note">${escapeHtml(p.note)}</span>`;
  if (p.pending) meta += `<span class="tag pending">En attente d'envoi</span>`;
  const fav = state.favs.has(p.id);
  // Récents : boutons révélés en balayant la ligne vers la gauche (voir « Balayage des récents »)
  const actions = swipe ? `<div class="swipe-actions">
    <button type="button" class="swipe-fav${fav ? " on" : ""}" data-swipe="fav" tabindex="-1">${ICON_STAR_BIG}<span>${fav ? "Retirer" : "Favori"}</span></button>
    <button type="button" class="swipe-del" data-swipe="del" tabindex="-1">${ICON_TRASH}<span>Supprimer</span></button>
  </div>` : "";
  return `<li${swipe ? ` class="swipe" data-id="${p.id}"` : ""}>${actions}<button class="row${icon ? " with-icon" : ""}" data-id="${p.id}">
    ${icon ? iconOf(p) : ""}<span class="row-main"><span class="row-name">${highlight(p, tokens)}</span><span class="row-meta">${meta}</span></span>
    ${fav ? ICON_STAR : ""}${ICON_CHEV}
  </button></li>`;
}

function group(label, items, tokens, small = false, swipe = false, icon = false) {
  return `<li><h2 class="group-label${small ? " small" : ""}">${label}</h2><ul class="group">${items.map((p) => rowHtml(p, tokens, swipe, icon)).join("")}</ul></li>`;
}

function render() {
  const tokens = canon(fold(state.query)).split(" ").filter(Boolean);
  const rawTokens = fold(state.query).split(" ").filter(Boolean);
  let items = plants;
  if (tokens.length) items = items.filter((p) => tokens.every((t) => p.canon.includes(t)));
  if (state.mode === "fav") items = items.filter((p) => state.favs.has(p.id));

  const list = $("#list"), empty = $("#empty");
  let html = "";
  swipeOpen = null;   // les lignes sont redessinées, aucune ne reste ouverte

  // « Autour de moi » : liste ou carte
  const mapView = state.mode === "near" && state.view === "map";
  $("#views").hidden = state.mode !== "near";
  document.querySelectorAll("#views button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === state.view));
  document.body.classList.toggle("map-view", mapView);
  measureTop();
  if (mapView) {
    list.innerHTML = "";
    empty.hidden = true;
    NearMap.show(items);
    return;
  }
  NearMap.hide();

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
    if (items.length) html = group(tokens.length ? "Résultats" : "Les plus proches", items, rawTokens, true, false, true);
  } else if (state.mode === "fav" || tokens.length) {
    if (items.length) html = group(state.mode === "fav" ? "Favoris" : `${items.length} résultat${items.length > 1 ? "s" : ""}`, items, rawTokens, true);
  } else {
    const recents = state.recents.map((id) => byId.get(id)).filter(Boolean);
    if (recents.length) html += group("Récents", recents, [], true, true);
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
  $("#favBackup").hidden = !FavFile.dirty();
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
  // iPhone, clavier ouvert : un toucher sur le fond de l'éditeur peut atteindre la liste cachée dessous
  if ($("#editor").open) return;
  state.current = p;
  $("#sheetName").textContent = p.n;
  let meta = `${formatCoord(p.lat)}, ${formatCoord(p.lon)}`;
  if (state.pos) meta = `${formatKm(distanceKm(state.pos, p))} à vol d'oiseau, direction ${compass(bearing(state.pos, p))}`;
  if (p.r) meta += ` — ${p.r}`;
  $("#sheetMeta").textContent = meta;
  $("#sheetNote").textContent = p.note || "";
  $("#sheetNote").hidden = !p.note;
  const star = $("#sheetStar"), fav = state.favs.has(p.id);
  star.setAttribute("aria-pressed", fav);
  star.setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
  $("#goWaze").href = APPS.waze(p);
  $("#goGmaps").href = APPS.gmaps(p);
  $("#goPlans").href = APPS.plans(p);
  for (const [key, el] of [["waze", "#goWaze"], ["gmaps", "#goGmaps"], ["plans", "#goPlans"]]) {
    $(el).classList.toggle("preferred", state.preferredApp === key);
  }
  $("#goPlans").hidden = !isApple;   // Plans n'existe que sur iPhone
  // Ordinateur : Waze / Google Maps dans un nouvel onglet, l'appli reste ouverte dans le sien
  if (isDesktop) for (const el of ["#goWaze", "#goGmaps", "#goPlans"]) Object.assign($(el), { target: "_blank", rel: "noopener" });
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

function toggleFav(id) {
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  store.set("favs", [...state.favs]);
  const fav = state.favs.has(id);
  renderFavCount();
  // Fichier de favoris en place : on propose de le mettre à jour tout de suite
  // (ordinateur, fichier relié et autorisé : mis à jour directement)
  const msg = fav ? "Ajoutée aux favoris" : "Retirée des favoris";
  toast(msg, FavFile.dirty() ? FavFile.save : null, "Enregistrer");
  FavFile.update().then((done) => { if (done) toast(`${msg}, fichier à jour`); });
  return fav;
}

let toastTimer, toastUndo = null;
function toast(msg, undo = null, label = "Annuler", ms = undo ? 5000 : 1800) {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  toastUndo = undo;
  $("#toastAction").hidden = !undo;
  $("#toastAction").textContent = label;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); toastUndo = null; }, ms);
}

/* ===================== Carte « Autour de moi » ===================== */

// Mêmes centrales que la liste (recherche comprise), à leur position GPS, avec l'icône
// et la couleur de leur groupe. Toucher une centrale ouvre la feuille de lancement.
// Hors ligne : le fond de carte manque, mais les centrales et la position restent affichées.
function measureTop() {
  const h = $(".top").offsetHeight;
  if (h) document.documentElement.style.setProperty("--top-h", `${h}px`);   // 0 : en-tête retiré pendant l'ajout
}
const upKey = (p) => p.up || "";

const NearMap = (() => {
  const wrap = $("#nearMap"), msg = $("#nmMsg");
  let L = null, map = null, layers = null, markers = null, me = null, ready = null;
  let items = [], drawn = "", centered = false, failed = false, query = "";
  let layerKey = store.get("mapLayer", "plan");

  function init() {
    if (!ready) {
      ready = loadLeaflet().then((Lf) => {
        L = Lf;
        map = L.map("nmap", { zoomControl: false, attributionControl: true });
        layers = tileLayers(L);
        (layers[layerKey] || layers.plan).addTo(map);
        markers = L.layerGroup().addTo(map);
        map.setView([46.6, 2.4], 5);
        const labels = () => wrap.classList.toggle("labels", map.getZoom() >= 13);
        map.on("zoomend", labels);
        labels();
      }, (e) => { ready = null; throw e; });
    }
    return ready;
  }

  function renderMsg() {
    const text = failed ? "La carte n'a pas pu être chargée. Utilisez la liste."
      : !navigator.onLine ? "Hors ligne : le fond de carte n'est pas disponible."
      : state.pos ? ""
      : state.locating ? "Recherche de votre position…"
      : state.locError;
    msg.textContent = text || "";
    msg.hidden = !text;
  }

  function draw() {
    const shown = items.filter((p) => !state.hiddenUps.has(upKey(p)));
    const key = shown.map((p) => `${p.id}|${p.up}|${p.geh}`).join("\n");
    if (key === drawn) return;
    drawn = key;
    markers.clearLayers();
    for (const p of shown) {
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "mk", html: `${iconOf(p)}<span class="mk-label">${escapeHtml(p.n)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: p.n, riseOnHover: true,
      });
      m.on("click", () => openSheet(byId.get(p.id) || p));
      markers.addLayer(m);
    }
  }

  function placeMe() {
    if (!state.pos) return;
    const ll = [state.pos.lat, state.pos.lon];
    if (me) me.setLatLng(ll);
    else me = L.marker(ll, { icon: L.divIcon({ className: "me", html: "<span></span>", iconSize: [22, 22] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
  }

  // Cadre la position et les centrales les plus proches
  function recenter() {
    const near = items.map((p) => [distanceKm(state.pos, p), p]).sort((a, b) => a[0] - b[0]).slice(0, 8);
    const pts = [[state.pos.lat, state.pos.lon], ...near.map(([, p]) => [p.lat, p.lon])];
    map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 12 });
  }

  async function show(list) {
    items = list;
    wrap.hidden = false;
    renderMsg();
    try { await init(); failed = false; }
    catch { failed = true; renderMsg(); return; }
    if (wrap.hidden) return;
    map.invalidateSize();
    draw();
    placeMe();
    if (state.query !== query) {
      // Nouvelle recherche : la carte cadre les résultats
      query = state.query;
      if (query && items.length) {
        map.fitBounds(L.latLngBounds(items.map((p) => [p.lat, p.lon])), { padding: [48, 48], maxZoom: 12 });
        return;
      }
    }
    if (state.pos && !centered) { centered = true; recenter(); }
  }

  function hide() { wrap.hidden = true; }
  function redraw() { if (map && !wrap.hidden) { drawn = ""; draw(); } }

  wrap.querySelectorAll(".map-layers button").forEach((b) => b.addEventListener("click", () => {
    layerKey = b.dataset.layer;
    store.set("mapLayer", layerKey);
    wrap.querySelectorAll(".map-layers button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    if (map) Object.entries(layers).forEach(([k, layer]) => (k === layerKey ? layer.addTo(map) : layer.remove()));
  }));
  wrap.querySelectorAll(".map-layers button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.layer === layerKey));
  $("#nmLocate").addEventListener("click", () => {
    if (state.pos && map) recenter();
    else { centered = false; locate(); }
  });
  $("#nmLegend").addEventListener("click", () => Legend.open());
  window.addEventListener("online", () => { renderMsg(); if (map) layers[layerKey]?.redraw(); });   // recharge les tuiles manquées
  window.addEventListener("offline", renderMsg);

  return { show, hide, redraw };
})();

// Légende : comme le panneau des calques de l'ancienne carte, une case par UP pour
// l'afficher ou la masquer, et la liste de ses GEH avec leur icône.
const Legend = (() => {
  const dlg = $("#legend"), body = $("#legendBody");

  function sections() {
    const count = new Map();
    const add = (k) => count.set(k, (count.get(k) || 0) + 1);
    const extra = new Map();   // groupes présents dans la liste mais absents de GROUPS
    for (const p of plants) {
      add(upKey(p)); add(`${upKey(p)}|${p.geh || ""}`);
      if (p.up && !GROUP_COLOR.has(`${p.up}|${p.geh}`)) {
        if (!extra.has(p.up)) extra.set(p.up, new Set());
        extra.get(p.up).add(p.geh || "");
      }
    }
    const out = GROUPS.map((g) => ({
      up: g.up,
      rows: [...g.geh.map(([geh, c]) => ({ geh, type: g.type || "hydro", color: COLOR[c] })),
             ...[...(extra.get(g.up) || [])].map((geh) => ({ geh, type: g.type || "hydro", color: GREY }))],
    }));
    for (const [up, gehs] of extra) {
      if (!UP_TYPE.has(up)) out.push({ up, rows: [...gehs].map((geh) => ({ geh, type: "hydro", color: GREY })) });
    }
    // Sans groupe : une ligne par type (hydraulique, nucléaire, thermique)
    const loose = plants.filter((p) => !p.up);
    const types = [["hydro", "Hydraulique"], ["nucleaire", "Nucléaire"], ["thermique", "Thermique"]]
      .map(([type, label]) => ({ geh: label, type, color: GREY, n: loose.filter((p) => typeOf(p) === type).length }))
      .filter((r) => r.n);
    if (loose.length) out.push({ up: "", label: "Non classées", rows: types });
    return out.map((s) => ({ ...s, n: count.get(s.up) || 0, rows: s.rows.map((r) => ({ n: count.get(`${s.up}|${r.geh}`) || 0, ...r })) }));
  }

  function render() {
    body.innerHTML = sections().map((s) => `<section class="lg">
      <label class="lg-up"><input type="checkbox" data-up="${escapeHtml(s.up)}"${state.hiddenUps.has(s.up) ? "" : " checked"}>
        <span>${escapeHtml(s.label || s.up)}</span><small>${s.n}</small></label>
      <ul>${s.rows.map((r) => `<li${r.n ? "" : ' class="none"'}>${plantIcon(r.type, r.color)}<span>${escapeHtml(r.geh || "Sans GEH")}</span><small>${r.n || ""}</small></li>`).join("")}</ul>
    </section>`).join("");
  }

  function open() { render(); dlg.showModal(); }

  body.addEventListener("change", (e) => {
    const up = e.target.dataset.up;
    if (up == null) return;
    if (e.target.checked) state.hiddenUps.delete(up); else state.hiddenUps.add(up);
    store.set("hiddenUps", [...state.hiddenUps]);
    NearMap.redraw();
  });
  $("#legendClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  return { open };
})();

/* ===================== Statut hors ligne ===================== */

function renderStatus() {
  const s = $("#status");
  const n = state.pending.length;
  let cls = "status", text;
  if (!navigator.onLine) text = n ? `${n} en attente` : "Hors ligne";
  else if (state.sync === "busy") text = "Synchro…";
  else if (state.sync === "auth") { cls += " warn"; text = "Code refusé"; }
  else if (state.sync === "error") { cls += " warn"; text = n ? `${n} en attente` : "Non vérifiée"; }
  else if (n) text = `${n} en attente`;
  else { cls += " ok"; text = "À jour"; }
  s.className = cls;
  s.textContent = text;
  s.hidden = false;
  document.body.classList.toggle("can-edit", !!state.token);
  if ($("#settings").open) renderSettings();
}

/* ===================== Liste (base + modifications locales) ===================== */

function prep(p, pending = false) {
  const f = fold(p.n);
  return { ...p, id: Sync.idOf(p), pending, fold: f, canon: canon(f) };
}
// Centrale telle qu'elle est dans la liste partagée (sans les champs calculés par prep)
const rawOf = ({ id, pending, fold, canon, ...raw }) => raw;

function rebuild() {
  const pendingIds = new Set(state.pending.filter((o) => o.op === "add").map((o) => Sync.idOf(o.item)));
  plants = Sync.applyOps(basePlants, state.pending)
    .map((p) => prep(p, pendingIds.has(Sync.idOf(p))))
    .sort((a, b) => a.n.localeCompare(b.n, "fr", { sensitivity: "base", numeric: true }));
  byId.clear();
  plants.forEach((p) => byId.set(p.id, p));
  state.recents = state.recents.filter((id) => byId.has(id));
  $("#q").placeholder = `Rechercher parmi ${plants.length} centrales`;
  renderFavCount();
}

function saveLocal() {
  store.set("pending", state.pending);
  store.set("recents", state.recents);
  store.set("favs", [...state.favs]);
}

function changed() {
  saveLocal();
  rebuild();
  render();
  renderStatus();
  scheduleSync();
}

function addPlant(name, lat, lon, up = "", geh = "") {
  const item = { n: name, lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  if (up) item.up = up;
  if (geh) item.geh = geh;
  const r = regionOf(item.lat, item.lon);
  if (r) item.r = r;
  state.pending.push({ op: "add", item });
  changed();
}

function removePlant(p) {
  const id = p.id, item = rawOf(p);
  const wasFav = state.favs.has(id), recents = [...state.recents];
  const addIdx = state.pending.findIndex((o) => o.op === "add" && Sync.idOf(o.item) === id);
  if (addIdx >= 0) state.pending.splice(addIdx, 1);  // ajout pas encore envoyé : on l'annule simplement
  else state.pending.push({ op: "remove", id });
  state.favs.delete(id);
  state.recents = state.recents.filter((x) => x !== id);
  changed();
  toast(`« ${p.n} » supprimée`, () => {
    const delIdx = state.pending.findIndex((o) => o.op === "remove" && o.id === id);
    if (delIdx >= 0) state.pending.splice(delIdx, 1);   // pas encore envoyée
    else state.pending.push({ op: "add", item });       // déjà envoyée : on la remet
    if (wasFav) state.favs.add(id);
    state.recents = recents;
    changed();
    toast("Suppression annulée");
  });
}

/* ===================== Synchronisation ===================== */

let syncTimer = null, syncRunning = false, syncAgain = false;

function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  clearTimeout(syncTimer);
  if (!navigator.onLine) { renderStatus(); return; }
  if (syncRunning) { syncAgain = true; return; }
  syncRunning = true;
  state.sync = "busy";
  renderStatus();
  try {
    const ops = state.pending.slice();
    let list;
    if (ops.length && state.token) list = await Sync.push(ops, state.token, state.author);
    else list = (await Sync.fetchList(state.token)).list;
    // Retire les modifications envoyées (d'autres ont pu s'ajouter entre-temps)
    if (ops.length && state.token) state.pending = state.pending.filter((o) => !ops.includes(o));
    basePlants = list;
    store.set("list", list);
    state.lastSync = Date.now();
    store.set("lastSync", state.lastSync);
    state.sync = "ok";
    state.syncError = "";
    saveLocal();
    rebuild();
    render();
  } catch (e) {
    state.sync = e.code === "auth" ? "auth" : "error";
    state.syncError = e.message;
  } finally {
    syncRunning = false;
    renderStatus();
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

/* ===================== Réglages ===================== */

const settingsDlg = $("#settings");

function timeAgo(ts) {
  if (!ts) return "jamais";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

function renderSettings() {
  const n = state.pending.length;
  let line = `${plants.length} centrales. Mise à jour ${timeAgo(state.lastSync)}.`;
  if (n) line += ` ${n} modification${n > 1 ? "s" : ""} en attente d'envoi.`;
  $("#setSyncInfo").textContent = line;
  const err = $("#setSyncError");
  err.hidden = !state.syncError;
  err.textContent = state.syncError;
  $("#setSyncNow").disabled = state.sync === "busy" || !navigator.onLine;
  $("#setSyncNow").textContent = !navigator.onLine ? "Pas de réseau" : state.sync === "busy" ? "Synchronisation…" : "Mettre à jour maintenant";
  $("#setEditOff").hidden = !!state.token;
  $("#setEditOn").hidden = !state.token;
  if (n && !state.token) {
    err.hidden = false;
    err.textContent = "Des modifications attendent un code d'édition pour être envoyées.";
  }
  $("#setFavInfo").textContent = FavFile.info();
}

function openSettings() {
  $("#setToken").value = "";
  $("#setTokenMsg").textContent = "";
  $("#setAuthor").value = state.author;
  renderSettings();
  settingsDlg.showModal();
}

async function activateToken() {
  const token = $("#setToken").value.trim();
  const msg = $("#setTokenMsg");
  if (!token) { msg.className = "error"; msg.textContent = "Collez le code d'édition."; return; }
  if (!navigator.onLine) { msg.className = "error"; msg.textContent = "Il faut du réseau pour vérifier le code."; return; }
  msg.className = ""; msg.textContent = "Vérification…";
  try {
    await Sync.checkToken(token);
  } catch (e) {
    msg.className = "error";
    msg.textContent = e.code === "auth" ? "Ce code n'est pas valide pour cette liste." : e.message;
    return;
  }
  state.token = token;
  store.set("token", token);
  state.sync = "idle";
  renderStatus();
  renderSettings();
  toast("Édition activée");
  syncNow();
  News.forEditors();
}

/* ===================== Balayage des récents ===================== */

// Comme dans les listes de l'iPhone : balayer une ligne des récents vers la gauche
// révèle « Favori » et « Supprimer » ; balayer à fond la retire des récents
// (sans toucher aux favoris). Pointer events + `touch-action: pan-y` : le défilement
// vertical reste au navigateur, le geste horizontal nous revient.
const SWIPE_OPEN = 160;       // largeur des deux boutons
const SWIPE_FULL = 0.6;       // au-delà de cette part de la largeur : suppression
let swipeOpen = null;         // ligne restée ouverte
let swipeDrag = null;         // geste en cours
let swipeEatClick = false;    // le clic qui suit un geste ne doit pas ouvrir la fiche

function setSwipe(li, x) {
  li.style.setProperty("--x", `${x}px`);
  if (x) li.classList.add("active");
}

function closeSwipe(li = swipeOpen) {
  if (!li) return;
  if (li === swipeOpen) swipeOpen = null;
  li.classList.remove("armed");
  setSwipe(li, 0);
  setTimeout(() => { if (li !== swipeOpen && !li.classList.contains("dragging")) li.classList.remove("active"); }, 300);
}

function removeRecent(id) {
  const p = byId.get(id), idx = state.recents.indexOf(id);
  if (!p || idx < 0) return render();
  state.recents.splice(idx, 1);
  store.set("recents", state.recents);
  render();
  toast(`« ${p.n} » retirée des récents`, () => {
    if (!state.recents.includes(id)) state.recents.splice(idx, 0, id);
    state.recents = state.recents.slice(0, 5);
    store.set("recents", state.recents);
    render();
  });
}

function swipeDelete(li) {
  if (swipeOpen === li) swipeOpen = null;
  li.classList.add("armed", "leaving");
  setSwipe(li, -li.offsetWidth);
  li.style.height = `${li.offsetHeight}px`;
  void li.offsetHeight;          // fixe la hauteur de départ de l'animation
  li.style.height = "0px";
  setTimeout(() => removeRecent(li.dataset.id), 380);
}

function bindSwipe() {
  const list = $("#list");

  document.addEventListener("pointerdown", (e) => {
    swipeEatClick = false;
    const li = e.target.closest(".swipe");
    // Toucher ailleurs referme la ligne ouverte (et ce toucher-là ne fait rien d'autre dans la liste)
    if (swipeOpen && swipeOpen !== li) {
      closeSwipe();
      if (list.contains(e.target)) swipeEatClick = true;
    }
    if (!li || e.button > 0 || e.target.closest(".swipe-actions") || li.classList.contains("leaving")) return;
    const base = li === swipeOpen ? -SWIPE_OPEN : 0;
    swipeDrag = { li, id: e.pointerId, x0: e.clientX, y0: e.clientY, base, x: base, moved: false, lastX: e.clientX, lastT: e.timeStamp, vx: 0 };
  });

  document.addEventListener("pointermove", (e) => {
    const d = swipeDrag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { swipeDrag = null; return; }   // défilement vertical
      d.moved = true;
      d.li.classList.add("dragging", "active");
      try { d.li.setPointerCapture(e.pointerId); } catch { /* sans importance */ }
    }
    const w = d.li.offsetWidth;
    d.x = Math.max(-w, Math.min(0, d.base + dx));
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vx = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX; d.lastT = e.timeStamp;
    d.li.classList.toggle("armed", -d.x > w * SWIPE_FULL);
    setSwipe(d.li, d.x);
  });

  const end = (e) => {
    const d = swipeDrag;
    if (!d || e.pointerId !== d.id) return;
    swipeDrag = null;
    if (!d.moved) {
      // Simple toucher sur la ligne ouverte : on la referme sans ouvrir la fiche
      if (d.li === swipeOpen) { closeSwipe(); swipeEatClick = true; }
      return;
    }
    swipeEatClick = true;
    d.li.classList.remove("dragging");
    if (e.type === "pointerup" && d.li.classList.contains("armed")) return swipeDelete(d.li);
    d.li.classList.remove("armed");
    const flick = e.type === "pointerup" && d.vx < -0.5;
    if (-d.x > SWIPE_OPEN / 2 || (flick && d.x < -20)) {
      if (swipeOpen && swipeOpen !== d.li) closeSwipe();
      swipeOpen = d.li;
      setSwipe(d.li, -SWIPE_OPEN);
    } else {
      closeSwipe(d.li);
    }
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);

  // Le clic qui termine un geste est avalé avant d'atteindre la ligne
  document.addEventListener("click", (e) => {
    if (!swipeEatClick) return;
    swipeEatClick = false;
    if (list.contains(e.target)) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-swipe]");
    if (!btn) return;
    e.stopPropagation();
    const li = btn.closest(".swipe");
    if (btn.dataset.swipe === "del") return swipeDelete(li);
    toggleFav(li.dataset.id);
    closeSwipe(li);
    setTimeout(render, 300);   // laisse la ligne se refermer avant de redessiner
  });

  window.addEventListener("scroll", () => { if (swipeOpen && !swipeDrag) closeSwipe(); }, { passive: true });
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
  document.querySelectorAll("#views button").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view;
    store.set("nearView", state.view);
    render();
    window.scrollTo(0, 0);
  }));
  window.addEventListener("resize", measureTop);

  $("#main").addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (row) { q.blur(); return openSheet(byId.get(row.dataset.id)); }
    const action = e.target.closest("[data-action]");
    if (action?.dataset.action === "locate") locate();
    if (action?.dataset.action === "clear") clear.click();
  });

  $("#sheetStar").addEventListener("click", () => {
    const fav = toggleFav(state.current.id);
    $("#sheetStar").setAttribute("aria-pressed", fav);
    $("#sheetStar").setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
    render();
  });
  bindSwipe();

  $("#goWaze").addEventListener("click", () => launched("waze"));
  $("#goGmaps").addEventListener("click", () => launched("gmaps"));
  $("#goPlans").addEventListener("click", () => launched("plans"));

  $("#copy").addEventListener("click", async () => {
    const p = state.current;
    try { await navigator.clipboard.writeText(`${p.lat}, ${p.lon}`); toast("Coordonnées copiées"); }
    catch { toast(`${p.lat}, ${p.lon}`); }
  });
  $("#close").addEventListener("click", closeSheet);

  const confirmDlg = $("#confirm");
  $("#remove").addEventListener("click", () => {
    $("#confirmTitle").textContent = `Supprimer « ${state.current.n} » ?`;
    confirmDlg.showModal();
  });
  $("#confirmCancel").addEventListener("click", () => confirmDlg.close());
  $("#confirmOk").addEventListener("click", () => {
    const p = state.current;
    confirmDlg.close();
    closeSheet();
    removePlant(p);
  });
  confirmDlg.addEventListener("click", (e) => { if (e.target === confirmDlg) confirmDlg.close(); });

  $("#toastAction").addEventListener("click", () => {
    const undo = toastUndo;
    toastUndo = null;
    $("#toast").classList.remove("show");
    if (undo) undo();
  });

  $("#add").addEventListener("click", () => Editor.open());

  $("#status").addEventListener("click", openSettings);
  $("#openSettings").addEventListener("click", openSettings);
  $("#setClose").addEventListener("click", () => settingsDlg.close());
  settingsDlg.addEventListener("click", (e) => { if (e.target === settingsDlg) settingsDlg.close(); });
  $("#setSyncNow").addEventListener("click", syncNow);
  $("#setNews").addEventListener("click", () => News.openAll());
  $("#setFavSave").addEventListener("click", () => FavFile.save());
  $("#setFavLoad").addEventListener("click", () => FavFile.pick());
  $("#favBackupGo").addEventListener("click", () => FavFile.save());
  $("#setTokenGo").addEventListener("click", activateToken);
  $("#setToken").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); activateToken(); } });
  $("#setAuthor").addEventListener("change", () => { state.author = $("#setAuthor").value.trim(); store.set("author", state.author); });
  $("#setEditDisable").addEventListener("click", () => {
    state.token = "";
    store.set("token", "");
    if (state.sync === "auth") state.sync = "idle";
    renderStatus();
    renderSettings();
    toast("Édition désactivée sur ce téléphone");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.lastSync > 60000) syncNow();
  });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  const top = $(".top");
  window.addEventListener("scroll", () => top.classList.toggle("scrolled", window.scrollY > 4), { passive: true });
  window.addEventListener("online", () => { renderStatus(); syncNow(); });
  window.addEventListener("offline", renderStatus);
}

/* ===================== Ajout d'une centrale ===================== */

// Comprend « 45.10453, 1.95359 », « 45,10453 1,95359 », les degrés-minutes-secondes
// (45°06'16.3"N 1°57'12.9"E), les degrés-minutes des GPS (N 45° 6.272' E 1° 57.215')
// et les liens Google Maps / Waze contenant des coordonnées.
function parseCoords(text) {
  let t = text.trim();
  if (!t) return null;
  try { t = decodeURIComponent(t); } catch { /* texte ordinaire */ }
  const ok = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null);

  let m = t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);                     // lien vers un lieu
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);                       // lien
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);          // 45.1, 1.9
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/^(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/);                      // 45,1 1,9
  if (m) return ok(+m[1].replace(",", "."), +m[2].replace(",", "."));

  // Degrés, minutes, secondes ; N/S/E/O (ou W) après chaque valeur, sinon avant
  const n = "(\\d{1,3}(?:[.,]\\d+)?)";
  const dms = `${n}\\s*°\\s*(?:${n}\\s*['′’]\\s*)?(?:${n}\\s*(?:["″”]|['′’]{2})\\s*)?`;
  const num = (s) => +(s || "0").replace(",", ".");
  for (const [re, h, d] of [[`${dms}([NSEOW])`, 4, 1], [`([NSEOW])\\s*${dms}`, 1, 2]]) {
    const parts = [...t.matchAll(new RegExp(re, "gi"))];
    if (parts.length !== 2) continue;
    const val = (p) => {
      const v = num(p[d]) + num(p[d + 1]) / 60 + num(p[d + 2]) / 3600;
      return /[SOW]/i.test(p[h]) ? -v : v;
    };
    const [a, b] = parts;
    if (/[NS]/i.test(a[h]) === /[NS]/i.test(b[h])) return null;
    return /[NS]/i.test(a[h]) ? ok(val(a), val(b)) : ok(val(b), val(a));
  }
  return null;
}

// Plus Codes, les « codes Google » de Google Maps (algorithme public Open Location Code).
// Complet : « 8CPXXQ5R+9M ». Court : « XQ5R+9M Arrens-Marsous » ; il manque alors le début du
// code, repris d'un point proche (la commune écrite à côté, ou à défaut votre position).
const OLC = "23456789CFGHJMPQRVWX";

// → { code, short, place } ou null. `place` : le reste du texte (la commune).
function parsePlusCode(text) {
  let t = text.trim();
  try { t = decodeURIComponent(t); } catch { /* texte ordinaire */ }
  const m = t.match(/(?:^|[\s,;(])((?:[2-9CFGHJMPQRVWX]{2}){1,4}(?:0{2,6})?\+(?:[2-9CFGHJMPQRVWX]{2,})?)(?=$|[\s,;)])/i);
  if (!m) return null;
  const code = m[1].toUpperCase(), [head, tail] = code.split("+");
  const padded = head.includes("0");
  if (head.length !== 8 && padded) return null;                       // 8 caractères avant « + »
  if (padded && tail) return null;
  if (head.length < 8 && tail.length < 2) return null;               // code court : au moins 2 après « + »
  if (head.length === 8 && (OLC.indexOf(head[0]) > 8 || OLC.indexOf(head[1]) > 17)) return null;  // hors de la Terre
  const start = m.index + m[0].length - m[1].length;
  const place = (t.slice(0, start) + " " + t.slice(start + code.length)).replace(/^[\s,;()]+|[\s,;()]+$/g, "").replace(/\s+/g, " ");
  return { code, short: head.length < 8, place };
}

// Centre de la zone désignée par un code complet
function plusCodeDecode(code) {
  const d = code.replace("+", "").replace(/0+$/, "");
  let lat = -90, lon = -180, h = 20, w = 20;
  for (let i = 0, r = 20; i < Math.min(d.length, 10); i += 2, r /= 20) {
    lat += OLC.indexOf(d[i]) * r;
    lon += OLC.indexOf(d[i + 1]) * r;
    h = w = r;
  }
  for (let i = 10; i < d.length; i++) {                               // précision supplémentaire
    h /= 5; w /= 4;
    const k = OLC.indexOf(d[i]);
    lat += Math.floor(k / 4) * h;
    lon += (k % 4) * w;
  }
  return { lat: Math.min(lat + h / 2, 90), lon: lon + w / 2 };
}

// Code complet ou court complété autour de `ref` (le point le plus proche de `ref`)
function plusCodePoint({ code, short }, ref) {
  if (!short) return plusCodeDecode(code);
  const missing = 8 - code.indexOf("+");
  const size = 20 ** (2 - missing / 2);                             // côté de la zone (degrés)
  let la = Math.min(Math.max(ref.lat, -90), 89.999999) + 90, lo = (((ref.lon + 180) % 360) + 360) % 360;
  let prefix = "";
  for (let i = 0, r = 20; i < missing; i += 2, r /= 20) {
    const a = Math.floor(la / r), b = Math.floor(lo / r);
    prefix += OLC[a] + OLC[b];
    la -= a * r; lo -= b * r;
  }
  let { lat, lon } = plusCodeDecode(prefix + code);
  if (ref.lat + size / 2 < lat && lat - size >= -90) lat -= size;
  else if (ref.lat - size / 2 > lat && lat + size <= 90) lat += size;
  if (ref.lon + size / 2 < lon) lon -= size;
  else if (ref.lon - size / 2 > lon) lon += size;
  if (lon >= 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

async function geocode(q, limit = 6) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&accept-language=fr&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

// Position d'un Plus Code → { lat, lon, note? } ou { error }
async function locatePlusCode(pc) {
  if (!pc.short) return plusCodePoint(pc);
  let missing = "";
  if (pc.place) {
    if (navigator.onLine) {
      try {
        const [r] = await geocode(pc.place, 1);
        if (r) return plusCodePoint(pc, { lat: +r.lat, lon: +r.lon });
        missing = `Commune « ${pc.place} » introuvable.`;
      } catch { missing = `Commune « ${pc.place} » : la recherche n'a pas abouti.`; }
    } else missing = `Pas de réseau pour trouver « ${pc.place} ».`;
  }
  if (state.pos) {
    return { ...plusCodePoint(pc, state.pos), note: `${missing} Code complété d'après votre position : vérifiez le point sur la carte.`.trim() };
  }
  return { error: missing || `Ajoutez la commune après le code, par exemple « ${pc.code} Arrens-Marsous ».` };
}

const Editor = (() => {
  const dlg = $("#editor");
  const name = $("#fName"), search = $("#fSearch"), coords = $("#fCoords");
  const results = $("#fResults"), save = $("#editorSave"), coordsMsg = $("#fCoordsMsg");
  const mapMsg = $("#mapMsg"), mapHint = $("#mapHint");
  const groupSel = $("#fGroup");
  let L = null, map = null, marker = null, layers = {}, point = null, groupTouched = false;

  const PIN = '<svg viewBox="0 0 34 44" aria-hidden="true"><path fill="currentColor" d="M17 1C8.2 1 1 7.9 1 16.4 1 27.6 13.4 37.6 15.8 39.4a2 2 0 0 0 2.4 0C20.6 37.6 33 27.6 33 16.4 33 7.9 25.8 1 17 1z"/><circle cx="17" cy="16" r="6" fill="#fff"/></svg>';

  function showMapMessage(text) {
    mapMsg.textContent = text;
    mapMsg.hidden = !text;
    mapHint.hidden = !!text;
  }

  async function initMap() {
    if (!navigator.onLine) {
      showMapMessage("Pas de réseau : la carte et la recherche ne sont pas disponibles. Vous pouvez saisir les coordonnées GPS ci-dessous.");
      return;
    }
    showMapMessage("");
    try { L = await loadLeaflet(); }
    catch { showMapMessage("La carte n'a pas pu être chargée. Vérifiez le réseau, ou saisissez les coordonnées GPS ci-dessous."); return; }

    if (!map) {
      map = L.map("map", { zoomControl: false, attributionControl: true });
      layers = tileLayers(L);
      layers.plan.addTo(map);
      map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng, { pan: false }));
    }
    const start = point || state.pos;
    if (start) map.setView([start.lat, start.lon], point ? 15 : 11);
    else map.setView([46.6, 2.4], 5);
    setTimeout(() => map.invalidateSize(), 50);
    if (point) placeMarker();
  }

  function placeMarker() {
    if (!map || !point) return;
    if (!marker) {
      marker = L.marker([point.lat, point.lon], {
        draggable: true,
        icon: L.divIcon({ className: "pin", html: PIN, iconSize: [34, 44], iconAnchor: [17, 42] }),
      }).addTo(map);
      marker.on("dragend", () => { const ll = marker.getLatLng(); setPoint(ll.lat, ll.lng, { pan: false }); });
    } else {
      marker.setLatLng([point.lat, point.lon]);
    }
  }

  function setPoint(lat, lon, { pan = true, zoom = 15, fromInput = false } = {}) {
    point = { lat, lon };
    if (!fromInput) coords.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    coords.style.borderColor = "";
    let near = null, nearKm = Infinity;
    for (const p of plants) { const d = distanceKm(point, p); if (d < nearKm) { nearKm = d; near = p; } }
    if (near && nearKm < 1) {
      coordsMsg.className = "warn";
      coordsMsg.textContent = `Attention : « ${near.n} » est déjà dans la liste, à ${formatKm(nearKm)} de ce point.`;
    } else {
      coordsMsg.className = "";
      coordsMsg.textContent = state.pos
        ? `À ${formatKm(distanceKm(state.pos, point))} de vous à vol d'oiseau.`
        : "Position du repère.";
    }
    // Groupe proposé : celui de la centrale classée la plus proche (à moins de 30 km)
    if (!groupTouched) {
      const ref = plants.filter((p) => p.up).map((p) => [distanceKm(point, p), p]).sort((a, b) => a[0] - b[0])[0];
      groupSel.value = ref && ref[0] < 30 ? `${ref[1].up}|${ref[1].geh || ""}` : "";
    }
    placeMarker();
    if (map && pan) map.setView([lat, lon], Math.max(map.getZoom(), zoom));
    validate();
  }

  // Groupes connus (GROUPS) et ceux déjà présents dans la liste
  function fillGroups() {
    const ups = new Map(GROUPS.map((g) => [g.up, new Set(g.geh.map(([geh]) => geh))]));
    for (const p of plants) {
      if (!p.up) continue;
      if (!ups.has(p.up)) ups.set(p.up, new Set());
      ups.get(p.up).add(p.geh || "");
    }
    const opt = (up, geh) => `<option value="${escapeHtml(`${up}|${geh}`)}">${escapeHtml(geh || up)}</option>`;
    groupSel.innerHTML = '<option value="">Non classée</option>' + [...ups].map(([up, gehs]) =>
      `<optgroup label="${escapeHtml(up)}">${(gehs.size ? [...gehs] : [""]).map((geh) => opt(up, geh)).join("")}</optgroup>`).join("");
  }

  // Code Google saisi dans « Coordonnées GPS » : le champ garde le code, le message
  // donne les coordonnées (utile sans carte, hors ligne)
  function showPlusCode(r) {
    if (r.error) { coordsMsg.className = "error"; coordsMsg.textContent = r.error; return; }
    setPoint(r.lat, r.lon, { fromInput: true });
    coordsMsg.textContent = `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)} · ${coordsMsg.textContent}${r.note ? ` ${r.note}` : ""}`;
  }

  function validate() {
    save.disabled = !(name.value.trim() && point);
  }

  function showResults(html) {
    results.innerHTML = html;
    results.hidden = !html;
  }

  async function runSearch() {
    const q = search.value.trim();
    if (!q) return;
    const c = parseCoords(q);
    if (c) { showResults(""); search.blur(); setPoint(c.lat, c.lon); return; }
    const pc = parsePlusCode(q);
    if (pc) {
      showResults('<li class="info">Lecture du code…</li>');
      const r = await locatePlusCode(pc);
      if (search.value.trim() !== q) return;
      if (r.error) { showResults(`<li class="info">${escapeHtml(r.error)}</li>`); return; }
      showResults(""); search.blur();
      setPoint(r.lat, r.lon);
      if (r.note) coordsMsg.textContent += ` ${r.note}`;
      return;
    }
    if (!navigator.onLine) { showResults('<li class="info">La recherche par nom nécessite du réseau.</li>'); return; }
    showResults('<li class="info">Recherche…</li>');
    try {
      const list = await geocode(q);
      if (!list.length) { showResults(`<li class="info">Aucun lieu trouvé pour « ${escapeHtml(q)} ». Essayez un nom de commune, ou placez le repère sur la carte.</li>`); return; }
      showResults(list.map((r, i) => {
        const title = r.name || r.display_name.split(",")[0];
        const rest = r.display_name.split(",").slice(1, 4).join(",").trim();
        return `<li><button type="button" data-i="${i}"><b>${escapeHtml(title)}</b><span>${escapeHtml(rest)}</span></button></li>`;
      }).join(""));
      results.onclick = (e) => {
        const b = e.target.closest("button[data-i]");
        if (!b) return;
        const r = list[+b.dataset.i];
        showResults("");
        search.blur();
        if (!name.value.trim()) name.value = (r.name || r.display_name.split(",")[0]).toUpperCase();
        setPoint(+r.lat, +r.lon);
      };
    } catch {
      showResults('<li class="info">La recherche n\'a pas abouti. Vérifiez le réseau, puis réessayez.</li>');
    }
  }

  function open() {
    $("#editorForm").reset();
    fillGroups();
    groupTouched = false;
    point = null;
    if (marker) { marker.remove(); marker = null; }
    showResults("");
    coords.style.borderColor = "";
    coordsMsg.className = "";
    coordsMsg.textContent = "Saisissez-les directement si vous les connaissez (ou un code Google).";
    $("#fSearchGo").disabled = false;
    validate();
    // L'éditeur remplace la liste (voir .editor dans styles.css) : on retient où elle en était
    listScroll = window.scrollY;
    dlg.show();
    window.scrollTo(0, 0);
    initMap();
    setTimeout(() => name.focus(), 300);
  }

  function close() { if (dlg.open) dlg.close(); }

  let listScroll = 0;
  dlg.addEventListener("close", () => {
    void document.body.offsetHeight;   // la liste est de nouveau dans la page
    measureTop();
    window.scrollTo(0, listScroll);
  });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  // Toucher le fond de l'éditeur ne ferme pas le clavier (fermeture par « ✓ » au-dessus du clavier).
  // Les champs, boutons et la carte restent normaux.
  dlg.addEventListener("mousedown", (e) => {
    if (!e.target.closest("input, select, textarea, button, a, label, .map-wrap, .results")) e.preventDefault();
  });

  // Événements
  name.addEventListener("input", validate);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });
  search.addEventListener("input", () => { if (!search.value) showResults(""); });
  $("#fSearchGo").addEventListener("click", runSearch);
  groupSel.addEventListener("change", () => { groupTouched = true; });
  // Un code Google court se lit quand on arrête de taper (il faut chercher la commune)
  let codeTimer = 0;
  coords.addEventListener("input", () => {
    clearTimeout(codeTimer);
    const text = coords.value;
    const c = parseCoords(text);
    if (c) { setPoint(c.lat, c.lon, { fromInput: true }); return; }
    const pc = parsePlusCode(text);
    if (pc && !pc.short) { showPlusCode(plusCodePoint(pc)); return; }
    point = null;
    if (marker) { marker.remove(); marker = null; }
    validate();
    if (pc) {
      coordsMsg.className = "";
      coordsMsg.textContent = "Lecture du code…";
      codeTimer = setTimeout(async () => {
        const r = await locatePlusCode(pc);
        if (coords.value === text) showPlusCode(r);
      }, 900);
    } else if (text.trim()) {
      coordsMsg.className = "error";
      coordsMsg.textContent = "Format attendu : 45.10453, 1.95359 ou code Google (XQ5R+9M Arrens-Marsous)";
    } else {
      coordsMsg.className = "";
      coordsMsg.textContent = "Saisissez-les directement si vous les connaissez (ou un code Google).";
    }
  });
  dlg.querySelectorAll(".map-layers button").forEach((b) => b.addEventListener("click", () => {
    if (!map) return;
    const key = b.dataset.layer;
    Object.entries(layers).forEach(([k, layer]) => (k === key ? layer.addTo(map) : layer.remove()));
    dlg.querySelectorAll(".map-layers button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  $("#editorCancel").addEventListener("click", close);
  $("#editorForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n || !point) return;
    const [up, geh = ""] = groupSel.value ? groupSel.value.split("|") : [];
    addPlant(n, point.lat, point.lon, up, geh);
    close();
    toast(`« ${n} » ajoutée`);
  });
  window.addEventListener("online", () => { if (dlg.open && !map) initMap(); });

  return { open };
})();

/* ===================== Version ===================== */

// À incrémenter avec VERSION dans sw.js (voir CHANGELOG.md).
const APP_VERSION = "1.12.1";

async function renderVersion() {
  let cache = "";
  try {
    const name = (await caches.keys()).find((k) => k.startsWith("centrales-"));
    if (name) cache = ` (cache ${name.slice("centrales-".length)})`;
  } catch { /* pas de cache disponible */ }
  $("#setVersion").textContent = `Version ${APP_VERSION}${cache}`;
}

const cmpVersion = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/* ===================== Nouveautés ===================== */

// Les fonctions nouvelles de chaque version et comment s'en servir (pas les corrections :
// elles restent dans CHANGELOG.md). Présentées une fois, juste après la mise à jour, puis
// retrouvables dans Réglages → À propos. Ajouter une entrée (la plus récente en tête)
// quand une version apporte quelque chose que l'utilisateur doit savoir utiliser.
// `art` : illustration dessinée par NEWS_ART. `editors: true` : présentée seulement aux téléphones
// qui ont le code d'édition (à sa première validation s'il est saisi plus tard).
const NEWS = [
  { v: "1.11.0", date: "14 octobre 2026", items: [
    { art: "pluscode", editors: true, title: "Les codes Google compris à l'ajout",
      text: "Pour ajouter une centrale, collez le code Google d'un lieu (par exemple « XQ5R+9M Arrens-Marsous ») : le point s'affiche sur la carte.",
      steps: [
        "Dans Google Maps, touchez le lieu, puis copiez son code (4 caractères, un « + », puis 2 ou 3 autres).",
        "Collez-le dans « Trouver sur la carte » ou dans « Coordonnées GPS », avec la commune.",
        "Les coordonnées GPS sont aussi comprises : 45.10453, 1.95359, degrés-minutes-secondes ou format des GPS (N 45° 6.272').",
      ],
      note: "Sans la commune, le code est complété d'après votre position." },
  ] },
  { v: "1.10.0", date: "13 octobre 2026", items: [
    { art: "favfile", title: "Vos favoris gardés dans un fichier",
      text: "Après une réinstallation ou sur un nouveau téléphone, rechargez ce fichier pour retrouver vos favoris.",
      steps: [
        "Au premier lancement, choisissez « Charger mon fichier » ou « Créer le fichier ».",
        isApple ? "Pour le créer : « Enregistrer dans Fichiers », dans iCloud Drive, dossier « NavigationCentrales »."
                : canLinkFile ? "Pour le créer : choisissez où l'enregistrer ; il est ensuite mis à jour à chaque changement."
                : "Le fichier est enregistré dans « Téléchargements ».",
        "Après avoir ajouté ou retiré un favori, touchez « Enregistrer » pour le mettre à jour.",
        "Tout se retrouve dans Réglages, rubrique « Favoris ».",
      ] },
  ] },
  { v: "1.8.0", date: "13 octobre 2026", items: [
    { art: "map", title: "La carte autour de vous",
      text: "Les centrales proches de vous, sur une carte, avec votre position.",
      steps: [
        "Touchez « Autour de moi », puis « Carte ».",
        "Touchez une icône pour lancer la navigation vers cette centrale.",
        "« Légende » : masquez les UP qui ne vous concernent pas.",
        "« Satellite » montre le terrain ; la flèche en bas vous recentre.",
      ],
      note: "Sans réseau, le fond de carte manque mais les centrales restent affichées." },
    { art: "icons", title: "Une icône pour chaque centrale",
      text: "Comme sur l'ancienne carte « Centrales EDF » : la forme indique le type, la couleur le GEH (ou le palier des CNPE).",
      steps: [
        "Visible dans « Autour de moi », en liste et sur la carte.",
        "Le détail des couleurs est dans « Légende », sur la carte.",
      ] },
  ] },
  { v: "1.7.0", date: "12 octobre 2026", items: [
    { art: "swipe", title: "Balayer une centrale récente",
      text: "Les « Récents » sont en haut de la liste A–Z.",
      steps: [
        "Balayez une ligne vers la gauche, à moitié : boutons « Favori » et « Supprimer ».",
        "Balayez-la à fond : elle quitte les récents (elle reste dans les favoris).",
        "Une erreur ? Touchez « Annuler » dans le message en bas.",
      ] },
  ] },
  { v: "1.6.0", date: "10 octobre 2026", items: [
    { art: "note", title: "Remarque sur une centrale",
      text: "Quand une position reste à vérifier, une remarque comme « Emplacement à confirmer » s'affiche dans la liste et sur la fiche de navigation." },
  ] },
  { v: "1.4.0", date: "5 octobre 2026", items: [
    { art: "update", title: "Mise à jour en un geste",
      text: "Quand une nouvelle version est prête, un bandeau bleu s'affiche en haut de la liste.",
      steps: [
        "Touchez « Mettre à jour » : plus besoin de réinstaller l'appli.",
        "Pour vérifier vous-même : Réglages → « Rechercher une mise à jour ».",
      ] },
  ] },
  { v: "1.0.0", date: "4 octobre 2026", items: [
    { art: "apps", title: "Lancer la navigation, même sans réseau",
      text: "Touchez une centrale, puis Waze, Google Maps ou Plans (sur iPhone).",
      steps: [
        "L'appli utilisée la dernière fois passe en premier.",
        "L'étoile ajoute la centrale aux « Favoris ».",
        "La recherche accepte « st » pour « saint » et ignore les accents.",
      ] },
  ] },
];

const ICON_FAVFILE = '<svg class="art-doc" viewBox="0 0 30 36" aria-hidden="true"><path d="M3 3h16l8 8v22H3z" class="doc"/><path d="M19 3v8h8" class="fold"/><path d="m15 14.5 2.1 4.3 4.7.6-3.4 3.3.8 4.7-4.2-2.3-4.2 2.3.8-4.7-3.4-3.3 4.7-.6z" class="st"/></svg>';

// Illustrations : de petites maquettes de l'interface, animées si le téléphone le permet.
const NEWS_ART = {
  swipe: () => `<p class="art-label">Récents</p><div class="art-card">
      <div class="art-swipe"><div class="art-actions">
        <span class="swipe-fav">${ICON_STAR_BIG}Favori</span><span class="swipe-del">${ICON_TRASH}Supprimer</span>
      </div><div class="art-row"><span><b>VILLEFRANCHE DE CONFLENT</b><small>12 km SE</small></span></div>
      <span class="art-finger"></span></div>
      <div class="art-row"><span><b>CHEYLAS</b><small>18 km NE</small></span></div>
    </div>`,
  map: () => {
    const at = (x, y, up, geh, type, tap = "") =>
      `<span class="art-pin${tap}" style="left:${x}%;top:${y}%">${plantIcon(type || "hydro", GROUP_COLOR.get(`${up}|${geh}`))}</span>`;
    return `<div class="art-views"><span>Liste</span><span class="on">Carte</span></div>
      <div class="art-map">
        <svg class="art-terrain" viewBox="0 0 300 120" preserveAspectRatio="none"><path class="river" d="M-5 92C60 70 80 104 140 80S230 30 305 44"/><path class="road" d="M30 -5 70 125M190 -5 250 125"/></svg>
        ${at(56, 26, "UP Alpes", "GEH Savoie Mont Blanc")}${at(48, 68, "UP Alpes", "GEH Ecrins Vercors", "", " tap")}
        ${at(82, 30, "CNPE", "CP1", "nucleaire")}${at(86, 74, "UP Alpes", "GEH Vallée de la Maurienne")}
        <span class="art-me" style="left:24%;top:62%"></span>
        <span class="art-chip">Légende</span>
      </div>`;
  },
  icons: () => {
    const fig = (type, color, label) => `<span class="art-fig">${plantIcon(type, COLOR[color])}<small>${label}</small></span>`;
    return `<div class="art-icons">${fig("hydro", "bleu", "Hydraulique")}${fig("nucleaire", "rouge", "Nucléaire")}${fig("thermique", "brun", "Thermique")}${fig("site", "violet", "Site EDF")}</div>
      <div class="art-colors">${["bleu", "orange", "noir", "vert", "violet", "orangeClair"].map((c) => plantIcon("hydro", COLOR[c])).join("")}</div>`;
  },
  note: () => `<div class="art-card"><div class="art-row"><span><b>GRAND'MAISON</b><small>12 km SE <em>Emplacement à confirmer</em></small></span></div></div>
    <p class="art-sheetnote">Emplacement à confirmer</p>`,
  favfile: () => `<p class="art-label">${isApple ? "iCloud Drive › NavigationCentrales" : "Téléchargements"}</p>
    <div class="art-card"><div class="art-row art-file">${ICON_FAVFILE}<span><b>NavigationCentrales-favoris.json</b><small>Vos favoris</small></span></div></div>
    <div class="art-banner"><span>Le fichier de favoris n'est plus à jour.</span><span class="art-btn">Enregistrer</span></div>`,
  pluscode: () => `<p class="art-label">Coordonnées GPS</p>
    <div class="art-card"><div class="art-row"><span><b>XQ5R+9M Arrens-Marsous</b><small>42.958438, -0.208313</small></span></div></div>`,
  update: () => `<div class="art-banner"><span>Une nouvelle version est disponible.</span><span class="art-btn">Mettre à jour</span></div>`,
  apps: () => `<div class="art-apps"><span class="app-waze">Waze</span><span class="app-gmaps">Google Maps</span>${isApple ? '<span class="app-plans">Plans</span>' : ""}</div>`,
};

// Espaces insécables de la typographie française : « mot », avant : ? !
const nbsp = (s) => s.replace(/« /g, "«\u00a0").replace(/ ([»:?!])/g, "\u00a0$1");

const News = (() => {
  const dlg = $("#news"), all = $("#newsAll");
  // mode : "update" (après une mise à jour), "welcome" (didacticiel du premier lancement)
  // ou "" (fiche ouverte depuis les Réglages)
  let cards = [], index = 0, mode = "";

  function show() {
    const c = cards[index], last = index === cards.length - 1;
    $("#newsKicker").textContent = mode === "welcome" ? "Bienvenue"
      : `${mode === "update" ? "Nouveau · " : ""}version ${c.v}`;
    $("#newsArt").innerHTML = NEWS_ART[c.art]?.() || "";
    $("#newsArt").className = `news-art is-${c.art}`;
    $("#newsTitle").textContent = c.title;
    $("#newsText").textContent = nbsp([c.text, c.note].filter(Boolean).join(" "));
    $("#newsSteps").innerHTML = (c.steps || []).map((s) => `<li>${escapeHtml(nbsp(s))}</li>`).join("");
    $("#newsSteps").hidden = !c.steps;
    $("#newsWhere").hidden = !(mode && last);
    $("#newsSkip").hidden = last;
    $("#newsPrev").style.visibility = index ? "visible" : "hidden";
    $("#newsDots").style.visibility = cards.length < 2 ? "hidden" : "visible";
    $("#newsDots").setAttribute("aria-label", `Page ${index + 1} sur ${cards.length}`);
    $("#newsDots").innerHTML = cards.map((_, i) => `<span${i === index ? ' class="on"' : ""}></span>`).join("");
    $("#newsNext").textContent = last ? "Compris" : "Suivant";
    dlg.querySelector(".sheet-body").scrollTop = 0;
  }

  function open(list, start = 0, how = "") {
    cards = list; index = start; mode = how;
    show();
    if (!dlg.open) dlg.showModal();
  }
  function go(step) {
    const i = index + step;
    if (i < 0) return;
    if (i >= cards.length) return dlg.close();
    index = i;
    show();
  }

  // Nouveautés des versions plus récentes que `v`, de la plus ancienne à la plus récente.
  const since = (v) => NEWS.filter((e) => cmpVersion(e.v, v) > 0).reverse()
    .flatMap((e) => e.items.map((it) => ({ ...it, v: e.v })));

  // Au lancement : présente une seule fois ce qui est arrivé depuis la dernière version vue.
  // Première installation : didacticiel (toutes les fiches, de la plus ancienne à la plus
  // récente), une seule fois ; pas dans Safari sur iPhone, l'appli installée a son propre
  // stockage et le présentera à son premier lancement. Utilisateur d'une version antérieure
  // à cet écran (aucune version vue mais des données sur le téléphone) : depuis la 1.6.
  // Les fiches `editors` (ajout de centrales) ne sont présentées qu'avec le code d'édition ;
  // sans lui, elles le seront à sa première validation (forEditors).
  function maybeShow(returning) {
    const first = !store.get("newsSeen", "") && !returning;
    if (first && isApple && !isStandalone) return store.set("newsSeen", APP_VERSION);
    const seen = store.get("newsSeen", "") || (returning ? "1.6.0" : "0");
    store.set("newsSeen", APP_VERSION);
    if (state.token) store.set("newsEditorsSeen", APP_VERSION);
    const list = since(seen).filter((it) => !it.editors || state.token);
    if (list.length && !document.querySelector("dialog[open]")) open(list, 0, first ? "welcome" : "update");
  }

  // Code d'édition validé : fiches réservées à l'édition pas encore vues sur ce téléphone
  function forEditors() {
    const list = since(store.get("newsEditorsSeen", "") || "0").filter((it) => it.editors);
    store.set("newsEditorsSeen", APP_VERSION);
    if (list.length) open(list, 0, "update");
  }

  function openAll() {
    $("#newsAllBody").innerHTML = NEWS.map((e, ei) => `<section class="nw">
      <h3>Version ${e.v} <small>${e.date}</small></h3>
      ${e.items.map((it, i) => `<button type="button" class="nw-item" data-e="${ei}" data-i="${i}">
        <span><b>${escapeHtml(it.title)}</b><small>${escapeHtml(nbsp(it.text))}</small></span>${ICON_CHEV}</button>`).join("")}
    </section>`).join("");
    all.showModal();
  }

  $("#newsNext").addEventListener("click", () => go(1));
  $("#newsPrev").addEventListener("click", () => go(-1));
  $("#newsSkip").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  // Balayer la fiche vers la gauche ou la droite : page suivante ou précédente
  let startX = null, startY = 0;
  dlg.addEventListener("pointerdown", (e) => { startX = e.clientX; startY = e.clientY; });
  dlg.addEventListener("pointercancel", () => { startX = null; });
  dlg.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });

  $("#newsAllClose").addEventListener("click", () => all.close());
  all.addEventListener("click", (e) => {
    if (e.target === all) return all.close();
    const b = e.target.closest(".nw-item");
    if (!b) return;
    const entry = NEWS[b.dataset.e];
    open(entry.items.map((it) => ({ ...it, v: entry.v })), Number(b.dataset.i));
  });

  return { maybeShow, forEditors, openAll };
})();

/* ===================== Fichier de favoris ===================== */

// Les favoris vivent dans le localStorage, effacé quand on supprime l'appli. Pour les retrouver
// après une réinstallation ou sur un autre téléphone, ils sont aussi enregistrés dans un fichier
// que l'utilisateur range lui-même : une appli web ne peut ni créer de dossier, ni écrire ou
// lire un fichier sans qu'il le choisisse. iPhone : menu Partager → « Enregistrer dans Fichiers » ;
// Android et ordinateur : téléchargement. Rechargement : sélecteur de fichier.
// `favFile` (localStorage) = favoris contenus dans le dernier fichier enregistré ou chargé.
// `favFileAsked` : la question « charger ou créer » n'est posée qu'une fois ; ensuite, Réglages → Favoris.
// Ordinateur (Chrome, Edge : `canLinkFile`) : le fichier créé ou chargé reste relié à l'appli
// (FileSystemFileHandle gardé dans IndexedDB) et il est réécrit sur place. Le navigateur demande
// l'autorisation de le modifier à la première écriture de chaque visite (« Autoriser lors de
// chaque visite » la donne pour de bon) ; ensuite chaque changement de favori le met à jour seul.
const FavFile = (() => {
  const NAME = "NavigationCentrales-favoris.json";
  const TYPES = [{ description: "Favoris Navigation Centrales", accept: { "application/json": [".json"] } }];
  const dlg = $("#favFile"), input = $("#favFileInput");
  let saved = store.get("favFile", null);   // { ids, at }
  let handle = null;                        // fichier relié (ordinateur)

  // IndexedDB : le seul stockage qui garde un FileSystemFileHandle d'une visite à l'autre.
  function idb(mode, fn) {
    return new Promise((ok, ko) => {
      const open = indexedDB.open("NavigationCentrales", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => ko(open.error);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction("kv", mode), req = fn(tx.objectStore("kv"));
          tx.oncomplete = () => { open.result.close(); ok(req.result); };
          tx.onerror = () => { open.result.close(); ko(tx.error); };
        } catch (e) {
          open.result.close();
          ko(e);
        }
      };
    });
  }
  function link(h) {
    handle = h;
    idb("readwrite", (s) => h ? s.put(h, "favHandle") : s.delete("favHandle")).catch(() => {});
  }
  if (canLinkFile) idb("readonly", (s) => s.get("favHandle")).then((h) => { handle = h || null; }).catch(() => {});

  const key = (ids) => [...ids].sort().join("\n");
  const dirty = () => !!saved && key(state.favs) !== key(saved.ids);
  const plural = (n) => `${n} favori${n > 1 ? "s" : ""}`;

  function remember(ids) {
    saved = { ids: [...ids], at: Date.now() };
    store.set("favFile", saved);
    renderFavCount();
    if (settingsDlg.open) renderSettings();
  }

  // Une centrale par ligne, comme data/centrales.json. L'identifiant `nom|lat|lon` suffit à
  // retrouver la centrale (même si elle a quitté la liste depuis).
  function content() {
    const favs = [...state.favs].map((id) => {
      const parts = id.split("|"), lon = Number(parts.pop()), lat = Number(parts.pop());
      return JSON.stringify({ n: parts.join("|"), lat, lon });
    });
    return `{"app": "Navigation Centrales", "type": "favoris", "version": 1, "date": "${new Date().toISOString()}",\n` +
           `"favoris": [\n${favs.join(",\n")}\n]}\n`;
  }

  // Appelée directement depuis un toucher : le menu Partager (et sur ordinateur, le choix de
  // l'emplacement ou l'autorisation de modifier le fichier) l'exige.
  async function save() {
    if (canLinkFile) return saveLinked();
    const ids = [...state.favs];
    const file = new File([content()], NAME, { type: "application/json" });
    if (dlg.open) dlg.close();
    if (isApple && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (e.name === "AbortError") { toast("Fichier de favoris non enregistré"); return false; }
        download(file);
      }
    } else {
      download(file);
    }
    remember(ids);
    toast(`Fichier enregistré (${plural(ids.length)})`);
    return true;
  }

  async function write(ids) {
    const w = await handle.createWritable();
    await w.write(content());
    await w.close();
    remember(ids);
  }

  async function saveLinked() {
    const ids = [...state.favs];
    if (dlg.open) dlg.close();
    try {
      if (handle) {
        if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") {
          toast("Fichier de favoris non enregistré : modification refusée");
          return false;
        }
      } else {
        link(await window.showSaveFilePicker({ suggestedName: NAME, types: TYPES }));
      }
      await write(ids);
    } catch (e) {
      if (e.name === "AbortError") { toast("Fichier de favoris non enregistré"); return false; }
      // Fichier déplacé ou supprimé : on choisira un nouvel emplacement
      link(null);
      toast("Fichier de favoris introuvable", save, "Choisir");
      return false;
    }
    toast(`Fichier enregistré (${plural(ids.length)})`);
    return true;
  }

  // Sans toucher (après un changement de favori) : seulement si le fichier est relié et que le
  // navigateur a déjà permis de le modifier pendant cette visite. Sinon le bouton « Enregistrer ».
  async function update() {
    if (!handle || !dirty()) return false;
    try {
      if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") return false;
      await write([...state.favs]);
      return true;
    } catch {
      return false;
    }
  }

  function download(file) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function pick() {
    if (!canLinkFile) {
      input.value = "";
      input.click();
      return;
    }
    let h;
    try {
      [h] = await window.showOpenFilePicker({ types: TYPES });
    } catch {
      return;   // annulé
    }
    if (await load(await h.getFile())) link(h);
  }

  // Les favoris du fichier s'ajoutent à ceux du téléphone (rien n'est perdu).
  async function load(file) {
    let list = null;
    try { list = JSON.parse(await file.text()).favoris; } catch { /* pas du JSON */ }
    if (!Array.isArray(list)) { toast("Ce fichier ne contient pas de favoris"); return false; }
    const ids = list.filter((x) => typeof x?.n === "string" && Number.isFinite(x.lat) && Number.isFinite(x.lon)).map(Sync.idOf);
    ids.forEach((id) => state.favs.add(id));
    store.set("favs", [...state.favs]);
    if (dlg.open) dlg.close();
    remember(ids);
    render();
    toast(`${plural(ids.length)} chargé${ids.length > 1 ? "s" : ""}`);
    return true;
  }

  function info() {
    const n = plural(state.favs.size);
    if (!saved) return `${n}. Pas encore de fichier de favoris : enregistrez-le pour les retrouver après une réinstallation.`;
    if (dirty()) return `${n}. Le fichier n'est plus à jour : enregistrez-le à nouveau.`;
    return `${n}. Fichier à jour (${timeAgo(saved.at)}).`;
  }

  // Une seule fois, au premier lancement (installation, ou mise à jour depuis une version sans
  // fichier), quelle que soit la réponse. Pas dans Safari sur iPhone : l'appli installée a son
  // propre stockage, c'est là qu'il faut le faire.
  function maybeAsk() {
    if (saved || store.get("favFileAsked", false) || (isApple && !isStandalone)) return;
    const other = document.querySelector("dialog[open]");
    if (other) return other.addEventListener("close", maybeAsk, { once: true });
    store.set("favFileAsked", true);
    dlg.showModal();
  }

  $("#favFileHelp").innerHTML = (isApple
    ? ["Pour le créer : touchez « Enregistrer dans Fichiers ».",
       "Choisissez iCloud Drive (il vous suit sur un nouveau téléphone), créez-y un dossier « NavigationCentrales » et touchez « Enregistrer ».",
       "Les fois suivantes, enregistrez au même endroit et touchez « Remplacer »."]
    : canLinkFile
    ? ["Pour le créer : choisissez où l'enregistrer.",
       "Il est ensuite mis à jour à chaque changement de favori (le navigateur demande une fois par visite l'autorisation de le modifier)."]
    : ["Le fichier est enregistré dans « Téléchargements ».",
       "Pour changer de téléphone, copiez-le sur le nouveau (Google Drive, câble…)."])
    .map((s) => `<li>${escapeHtml(nbsp(s))}</li>`).join("");
  $("#favFileLoad").addEventListener("click", pick);
  $("#favFileCreate").addEventListener("click", save);
  $("#favFileLater").addEventListener("click", () => {
    dlg.close();
    toast("À faire plus tard dans Réglages\u00a0→\u00a0Favoris", null, "", 4000);
  });
  input.addEventListener("change", () => { if (input.files?.[0]) load(input.files[0]); });

  return { dirty, save, update, pick, info, maybeAsk };
})();

/* ===================== Démarrage ===================== */

async function init() {
  // Demande un stockage « persistant » : sans cela, le navigateur peut vider le localStorage
  // (code d'édition, favoris, liste) quand le téléphone manque de place.
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* non pris en charge */ }
  // Des données déjà enregistrées : l'appli a été utilisée avant cette version (voir Nouveautés).
  const returning = ["list", "recents", "favs", "token"].some((k) => store.get(k, null) !== null);
  bind();
  renderFavCount();
  renderVersion();
  try {
    const stored = store.get("list", null);
    if (Array.isArray(stored) && stored.length) basePlants = stored;
    else basePlants = await (await fetch("data/centrales.json")).json();
    rebuild();
  } catch {
    $("#empty").hidden = false;
    $("#empty").textContent = "La liste des centrales n'a pas pu être chargée. Ouvrez l'appli une fois avec du réseau pour l'enregistrer sur le téléphone.";
    return;
  }
  render();
  renderStatus();
  syncNow();
  News.maybeShow(returning);
  FavFile.maybeAsk();   // après les nouveautés, qui l'expliquent

  // iPhone : pas d'installation automatique, on affiche les étapes (voir Installation).
  // Safari ne sait pas si l'appli est déjà sur l'écran d'accueil : la croix « Déjà installée »
  // masque le bandeau pour de bon dans ce navigateur.
  if (isApple && !isStandalone && !store.get("installDismissed", false)) {
    $("#install").hidden = false;
    $("#installNo").hidden = false;
  }
}

/* ===================== Installation ===================== */

// Android / ordinateur (Chrome, Edge) : le navigateur fournit une invite d'installation.
// iPhone : aucune API, on explique la marche à suivre.
let installEvent = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  if (!isStandalone) $("#install").hidden = false;
});
window.addEventListener("appinstalled", () => { installEvent = null; $("#install").hidden = true; });

$("#installGo").addEventListener("click", async () => {
  if (installEvent) {
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") $("#install").hidden = true;
    installEvent = null;
  } else {
    $("#installHelp").showModal();
  }
});
$("#installNo").addEventListener("click", () => {
  store.set("installDismissed", true);
  $("#install").hidden = true;
  toast("Bandeau d'installation masqué", () => {
    store.set("installDismissed", false);
    $("#install").hidden = false;
  });
});
$("#installHelpClose").addEventListener("click", () => $("#installHelp").close());
$("#installHelp").addEventListener("click", (e) => { if (e.target === $("#installHelp")) $("#installHelp").close(); });

/* ===================== Mise à jour de l'appli ===================== */

// Le service worker se remplace tout seul (skipWaiting), mais la page déjà
// ouverte garde l'ancien code : on propose de la recharger.
let swReg = null;

async function showUpdate() {
  $("#update").hidden = false;
  // Le nouveau service worker a déjà mis en cache le nouvel app.js : on y lit son numéro.
  try {
    const v = (await (await fetch("app.js")).text()).match(/APP_VERSION = "([\d.]+)"/)?.[1];
    if (v && v !== APP_VERSION) $("#updateVersion").textContent = ` (${v})`;
  } catch { /* numéro indisponible : le bandeau reste sans */ }
}

async function checkUpdate() {
  if (!swReg || !navigator.onLine) return false;
  try { await swReg.update(); return true; } catch { return false; }
}

if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) showUpdate(); });
  navigator.serviceWorker.register("sw.js").then((reg) => { swReg = reg; }).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(); });
}
$("#updateGo").addEventListener("click", () => location.reload());
$("#setCheckUpdate").addEventListener("click", async () => {
  const msg = $("#setUpdateMsg");
  msg.textContent = "Recherche…";
  const ok = await checkUpdate();
  // Une mise à jour trouvée fait apparaître le bandeau (controllerchange).
  setTimeout(() => {
    msg.textContent = !ok ? "Impossible de vérifier : réseau indisponible."
      : $("#update").hidden ? "Vous avez la dernière version." : "Une nouvelle version est prête : touchez « Mettre à jour ».";
  }, 1500);
});
init();
