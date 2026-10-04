// Service worker : met toute l'appli en cache pour qu'elle s'ouvre sans réseau.
// ➜ Changez VERSION à chaque modification (liste des centrales, design…)
//   pour que les téléphones téléchargent la nouvelle version.
const VERSION = "2026-10-04.7";
const CACHE = `centrales-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "sync.js",
  "data/centrales.json", // liste de secours embarquée (1er lancement hors ligne)
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "fonts/barlow-semi-condensed-latin-500-normal.woff2",
  "fonts/barlow-semi-condensed-latin-600-normal.woff2",
  "fonts/barlow-semi-condensed-latin-700-normal.woff2",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("centrales-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord : l'appli démarre instantanément, avec ou sans réseau.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() =>
        req.mode === "navigate" ? caches.match("index.html") : Response.error()
      );
    })
  );
});
