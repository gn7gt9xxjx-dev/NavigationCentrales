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
const COLOR = {
  bleu: "#1F6FD1", orange: "#F4511E", noir: "#222222", vert: "#43A047", violet: "#8E24AA",
  jaune: "#FBD000", rouge: "#E53935", lime: "#B5C200", ambre: "#FB8C00", turquoise: "#00897B", brun: "#6D4C41",
};
const GREY = "#8C98A5";
const GROUPS = [
  { up: "CNPE", type: "nucleaire", geh: [["P'4", "lime"], ["CP1", "rouge"], ["P4", "vert"], ["CP0", "jaune"], ["CP2", "ambre"], ["CP1/CP2", "orange"], ["N4", "turquoise"]] },
  { up: "UP Centre", geh: [["GEH Dordogne", "bleu"], ["GEH Loire-Ardèche", "orange"], ["GEH Limoges", "noir"], ["GEH BERGERAC", "vert"], ["GEH Lot Truyère", "ambre"], ["GEH Ouest", "violet"], ["GEH Inconnu", "jaune"]] },
  { up: "UP Méditerranée", geh: [["GEH Durance", "violet"], ["GEH Var Roya", "bleu"]] },
  { up: "UP Sud-Ouest", geh: [["GEH Inconnu", "jaune"], ["GEH Adour et Gaves", "bleu"], ["GEH Aude Ariège", "orange"], ["GEH Garonne", "noir"], ["GEH Tarn Agout", "violet"]] },
  { up: "SEI / PEI", geh: [["SEI", "bleu"], ["PEI", "orange"]] },
  { up: "UP Alpes", geh: [["GEH Savoie Mont Blanc", "bleu"], ["GEH Ecrins Vercors", "vert"], ["GEH Vallée de la Maurienne", "noir"]] },
  { up: "UP Est", geh: [["GEH Jura-Bourgogne", "bleu"], ["GEH Rhin", "orange"], ["GEH Revin-St-Nicolas", "vert"], ["GEH Inconnu", "jaune"]] },
  { up: "Thermique", type: "thermique", geh: [["CPT", "brun"]] },
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
const FLAME = "M16 2.5c.8 4.6 7.5 8 7.5 15.5a7.5 7.5 0 0 1-15 0c0-3.9 1.9-6.4 3.6-8.4.2 2.6 1.3 4.2 2.9 4.8-.6-4.8.3-8.4 1-11.9z";

// Icône d'une centrale (ou d'un groupe) : turbine sur l'eau, tour de refroidissement ou flamme.
function plantIcon(type, color) {
  const ink = inkOn(color);
  const shape = (d) => `<path d="${d}" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="3" stroke-linejoin="round"/>` +
                       `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`;
  let body;
  if (type === "nucleaire") {
    body = shape(TOWER) + `<path d="M14.2 8.4c0-2.4 1.8-3.2 3.6-3.2s3.4-.8 3.4-3" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="4.4" stroke-linecap="round"/>` +
           `<path d="M14.2 8.4c0-2.4 1.8-3.2 3.6-3.2s3.4-.8 3.4-3" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>`;
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
  toast(fav ? "Ajoutée aux favoris" : "Retirée des favoris");
  return fav;
}

let toastTimer, toastUndo = null;
function toast(msg, undo = null) {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  toastUndo = undo;
  $("#toastAction").hidden = !undo;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); toastUndo = null; }, undo ? 5000 : 1800);
}

/* ===================== Carte « Autour de moi » ===================== */

// Mêmes centrales que la liste (recherche comprise), à leur position GPS, avec l'icône
// et la couleur de leur groupe. Toucher une centrale ouvre la feuille de lancement.
// Hors ligne : le fond de carte manque, mais les centrales et la position restent affichées.
function measureTop() {
  document.documentElement.style.setProperty("--top-h", `${$(".top").offsetHeight}px`);
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

// Comprend « 45.10453, 1.95359 », « 45,10453 1,95359 », le format degrés-minutes-secondes
// (45°06'16.3"N 1°57'12.9"E) et les liens Google Maps / Waze contenant des coordonnées.
function parseCoords(text) {
  const t = text.trim();
  if (!t) return null;
  const ok = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null);

  let m = t.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);                  // lien
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);          // 45.1, 1.9
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/^(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/);                      // 45,1 1,9
  if (m) return ok(+m[1].replace(",", "."), +m[2].replace(",", "."));
  const dms = /(\d{1,3})°\s*(?:(\d{1,2})['′’]\s*)?(?:([\d.,]+)["″”]\s*)?([NSEOW])/gi;
  const parts = [...t.matchAll(dms)];
  if (parts.length === 2) {
    const val = (p) => {
      const v = +p[1] + (+p[2] || 0) / 60 + (+(p[3] || "0").replace(",", ".")) / 3600;
      return /[SOW]/i.test(p[4]) ? -v : v;
    };
    const [a, b] = parts;
    return /[NS]/i.test(a[4]) ? ok(val(a), val(b)) : ok(val(b), val(a));
  }
  return null;
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
    if (!navigator.onLine) { showResults('<li class="info">La recherche par nom nécessite du réseau.</li>'); return; }
    showResults('<li class="info">Recherche…</li>');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=fr&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(res.status);
      const list = await res.json();
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
    coordsMsg.textContent = "Saisissez-les directement si vous les connaissez.";
    $("#fSearchGo").disabled = false;
    validate();
    dlg.showModal();
    initMap();
    setTimeout(() => name.focus(), 300);
  }

  function close() { if (dlg.open) dlg.close(); }

  // Événements
  name.addEventListener("input", validate);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });
  search.addEventListener("input", () => { if (!search.value) showResults(""); });
  $("#fSearchGo").addEventListener("click", runSearch);
  groupSel.addEventListener("change", () => { groupTouched = true; });
  coords.addEventListener("input", () => {
    const c = parseCoords(coords.value);
    if (c) { setPoint(c.lat, c.lon, { fromInput: true }); return; }
    point = null;
    if (marker) { marker.remove(); marker = null; }
    validate();
    if (coords.value.trim()) {
      coordsMsg.className = "error";
      coordsMsg.textContent = "Format attendu : 45.10453, 1.95359";
    } else {
      coordsMsg.className = "";
      coordsMsg.textContent = "Saisissez-les directement si vous les connaissez.";
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
const APP_VERSION = "1.8.0";

async function renderVersion() {
  let cache = "";
  try {
    const name = (await caches.keys()).find((k) => k.startsWith("centrales-"));
    if (name) cache = ` (cache ${name.slice("centrales-".length)})`;
  } catch { /* pas de cache disponible */ }
  $("#setVersion").textContent = `Version ${APP_VERSION}${cache}`;
}

/* ===================== Démarrage ===================== */

async function init() {
  // Demande un stockage « persistant » : sans cela, le navigateur peut vider le localStorage
  // (code d'édition, favoris, liste) quand le téléphone manque de place.
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* non pris en charge */ }
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

  // iPhone : pas d'installation automatique, on affiche les étapes (voir Installation)
  if (isApple && !isStandalone) $("#install").hidden = false;
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
