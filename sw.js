// Inject reminder UI into the app's HTML navigation response. GitHub Pages is static,
// so reminders can fire while the app/browser is active, but cannot be guaranteed
// while the browser has fully stopped the app without a push-notification backend.
const CACHE = "payday-planner-v8";
const BASE = self.registration.scope;
const ASSETS = [
  BASE,
  new URL("manifest.webmanifest", BASE).href,
  new URL("reminders.js", BASE).href,
  new URL("icons/icon-192.png", BASE).href,
  new URL("icons/icon-512.png", BASE).href,
  new URL("icons/maskable-512.png", BASE).href,
  new URL("icons/apple-touch-icon.png", BASE).href
];

async function addReminderScript(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/html")) return response;
  const html = await response.text();
  if (html.includes("reminders.js")) return new Response(html, response);
  const updated = html.replace(/<\/body\s*>/i, '<script src="./reminders.js" defer></script></body>');
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(updated, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("payday-planner-") && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      let response = await fetch(request, { cache: "no-store" });
      if (request.mode === "navigate") response = await addReminderScript(response);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") return (await caches.match(BASE)) || Response.error();
      return Response.error();
    }
  })());
});
