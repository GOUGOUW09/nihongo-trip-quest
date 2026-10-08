const CACHE = "nihongo-trip-quest-v3";
const CORE = [
  "./", "index.html", "styles.css", "content.js", "app.js", "manifest.webmanifest", "assets/icon.svg",
  ...Array.from({length:14},(_,i)=>`assets/audio/a${String(i+1).padStart(2,"0")}.m4a`)
];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch", event => {
  if(event.request.method!=="GET")return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match("index.html"))));
});
