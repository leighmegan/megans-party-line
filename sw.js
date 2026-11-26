const C='mt-20261126-1412';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(["./", "./index.html", "./styles.css", "./app.js", "./cards.json", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./fonts/pagella-bold.woff2", "./fonts/pagella-italic.woff2", "./fonts/pagella-regular.woff2", "./fonts/rubik-latin-600-normal.woff2"])))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))))});
