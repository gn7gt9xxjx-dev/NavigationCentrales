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
  if (p.pending) meta += `<span class="tag pending">En attente d'envoi</span>`;
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
const rawOf = (p) => { const o = { n: p.n, lat: p.lat, lon: p.lon }; if (p.r) o.r = p.r; return o; };

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

function addPlant(name, lat, lon) {
  const item = { n: name, lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
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
  $("#setTokenForm").addEventListener("submit", (e) => { e.preventDefault(); activateToken(); });
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
  let L = null, map = null, marker = null, layers = {}, point = null, loading = null;

  const PIN = '<svg viewBox="0 0 34 44" aria-hidden="true"><path fill="currentColor" d="M17 1C8.2 1 1 7.9 1 16.4 1 27.6 13.4 37.6 15.8 39.4a2 2 0 0 0 2.4 0C20.6 37.6 33 27.6 33 16.4 33 7.9 25.8 1 17 1z"/><circle cx="17" cy="16" r="6" fill="#fff"/></svg>';

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "vendor/leaflet/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => { loading = null; reject(new Error("leaflet")); };
      document.head.appendChild(js);
    });
    return loading;
  }

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
      layers.plan = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap",
      });
      layers.sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "Esri, Maxar",
      });
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
    placeMarker();
    if (map && pan) map.setView([lat, lon], Math.max(map.getZoom(), zoom));
    validate();
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
    addPlant(n, point.lat, point.lon);
    close();
    toast(`« ${n} » ajoutée`);
  });
  window.addEventListener("online", () => { if (dlg.open && !map) initMap(); });

  return { open };
})();

/* ===================== Version ===================== */

// À incrémenter avec VERSION dans sw.js (voir CHANGELOG.md).
const APP_VERSION = "1.5.2";

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

function showUpdate() { $("#update").hidden = false; }

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
