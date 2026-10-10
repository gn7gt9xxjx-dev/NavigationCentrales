"use strict";

// Synchronisation de la liste partagée avec le dépôt de données (DataNavigationCentrales).
// - Lecture : tout le monde, sans code (fichier brut du dépôt de données).
// - Écriture : uniquement avec un « code d'édition » (jeton GitHub limité au dépôt de données,
//   sans accès au dépôt de l'appli), saisi une fois dans les réglages de l'appli.
const Sync = (() => {
  const OWNER = "gn7gt9xxjx-dev";
  const REPO = "DataNavigationCentrales";
  const BRANCH = "main";
  const FILE = "data/centrales.json";
  const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
  const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${FILE}`;

  const idOf = (p) => `${p.n}|${p.lat}|${p.lon}`;

  class SyncError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  function headers(token) {
    const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  function validate(list) {
    if (!Array.isArray(list) || !list.length ||
        !list.every((p) => p && typeof p.n === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon))) {
      throw new SyncError("format", "La liste reçue est illisible.");
    }
    return list;
  }

  // Même mise en forme que tools/extract.py : une centrale par ligne (historique Git lisible).
  function serialize(list) {
    return "[\n" + list.map((p) =>
      `{"n": ${JSON.stringify(p.n)}, "lat": ${p.lat}, "lon": ${p.lon}${p.r ? `, "r": ${JSON.stringify(p.r)}` : ""}${p.note ? `, "note": ${JSON.stringify(p.note)}` : ""}}`
    ).join(",\n") + "\n]\n";
  }

  function toBase64(str) {
    let bin = "";
    for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  function fromBase64(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  // Applique les modifications en attente sur une liste (opérations idempotentes).
  function applyOps(list, ops) {
    let out = list.slice();
    for (const op of ops) {
      if (op.op === "add" && !out.some((p) => idOf(p) === idOf(op.item))) out.push(op.item);
      if (op.op === "remove") out = out.filter((p) => idOf(p) !== op.id);
    }
    return out;
  }

  async function request(url, opts = {}, token) {
    let res;
    try {
      res = await fetch(url, { cache: "no-store", ...opts, headers: { ...headers(token), ...(opts.headers || {}) } });
    } catch {
      throw new SyncError("network", "Pas de connexion au serveur.");
    }
    if (res.status === 401) throw new SyncError("auth", "Le code d'édition est refusé (expiré ou supprimé).");
    if (res.status === 403 || res.status === 404) {
      throw new SyncError(token ? "auth" : "http", token
        ? "Le code d'édition n'a pas le droit de modifier la liste."
        : `Liste indisponible (erreur ${res.status}).`);
    }
    return res;
  }

  // Dernière version de la liste partagée.
  async function fetchList(token) {
    if (token) {
      const res = await request(`${API}?ref=${BRANCH}`, {}, token);
      if (!res.ok) throw new SyncError("http", `Erreur ${res.status} en lisant la liste.`);
      const json = await res.json();
      return { list: validate(JSON.parse(fromBase64(json.content))), sha: json.sha };
    }
    // Fichier brut du dépôt de données (public). Sans réseau, l'appli garde la dernière liste reçue.
    try {
      const res = await fetch(`${RAW}?t=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (res.ok) return { list: validate(await res.json()), sha: null };
    } catch { /* injoignable */ }
    throw new SyncError("http", "La liste partagée est injoignable pour le moment.");
  }

  function commitMessage(ops, author) {
    const adds = ops.filter((o) => o.op === "add"), dels = ops.filter((o) => o.op === "remove");
    let title;
    if (ops.length === 1) {
      title = adds.length ? `Ajout de ${adds[0].item.n}` : `Suppression de ${dels[0].id.split("|")[0]}`;
    } else {
      const parts = [];
      if (adds.length) parts.push(`${adds.length} ajout${adds.length > 1 ? "s" : ""}`);
      if (dels.length) parts.push(`${dels.length} suppression${dels.length > 1 ? "s" : ""}`);
      title = `Centrales : ${parts.join(" et ")}`;
    }
    const lines = [
      ...adds.map((o) => `+ ${o.item.n} (${o.item.lat}, ${o.item.lon})`),
      ...dels.map((o) => `- ${o.id.split("|")[0]}`),
    ];
    return `${title}\n\n${lines.join("\n")}\n\nDepuis l'appli Centrales${author ? ` (par ${author})` : ""}`;
  }

  // Envoie les modifications : relit la liste à jour, applique, enregistre.
  // En cas de modification simultanée par quelqu'un d'autre, recommence.
  async function push(ops, token, author) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { list, sha } = await fetchList(token);
      const next = applyOps(list, ops);
      if (serialize(next) === serialize(list)) return next; // déjà à jour
      const res = await request(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: commitMessage(ops, author), content: toBase64(serialize(next)), sha, branch: BRANCH }),
      }, token);
      if (res.ok) return next;
      if (res.status === 409 || res.status === 422) continue; // conflit : on relit et on réessaie
      throw new SyncError("http", `Erreur ${res.status} à l'enregistrement.`);
    }
    throw new SyncError("conflict", "La liste a changé pendant l'envoi. Réessayez.");
  }

  // Vérifie qu'un code permet au moins de lire la liste via l'API.
  async function checkToken(token) {
    await fetchList(token);
  }

  return { idOf, applyOps, fetchList, push, checkToken, serialize, SyncError };
})();
