"""Build: check cards, stamp the build, write dist/artifact (Claude link) and dist/gh (GitHub Pages, installable)."""
import json, os, shutil, subprocess, time
subprocess.run(["python3", "build_cards.py", "--write", "--quiet"], check=True)
stamp = time.strftime("%Y%m%d-%H%M")
def stamped(name): return open(os.path.join("src", name), encoding="utf-8").read().replace("__BUILD__", stamp)
sync = lambda js, on: js.replace("__SYNC__", "on" if on else "off")
html, css, js = stamped("index.html"), stamped("styles.css"), stamped("app.js")

def write(folder, files):
    os.makedirs(folder, exist_ok=True)
    for name, text in files.items(): open(os.path.join(folder, name), "w", encoding="utf-8").write(text)
    shutil.copy("cards.json", os.path.join(folder, "cards.json"))

write("dist/artifact", {"index.html": html.replace("<!--PWA-->", ""), "styles.css": css, "app.js": sync(js.replace("/*SW*/", ""), False)})

pwa = ('<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon-192.png">'
       '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Megan\'s Taboo">')
sw_reg = "try{if('serviceWorker' in navigator&&location.protocol==='https:'&&window.top===window)navigator.serviceWorker.register('sw.js')}catch(e){}"
files = ["./", "./index.html", "./styles.css", "./app.js", "./cards.json", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"]
sw = f"""const C='mt-{stamp}';
self.addEventListener('install',e=>{{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll({json.dumps(files)})))}});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{{if(e.request.method!=='GET')return;
 e.respondWith(fetch(e.request).then(r=>{{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}}).catch(()=>caches.match(e.request,{{ignoreSearch:true}}).then(r=>r||caches.match('./index.html'))))}});
"""
manifest = json.dumps({"name": "Megan's Taboo", "short_name": "Taboo", "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#2b0d3f", "theme_color": "#2b0d3f",
    "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]}, indent=1)
write("dist/gh", {"index.html": html.replace("<!--PWA-->", pwa), "styles.css": css, "app.js": sync(js.replace("/*SW*/", sw_reg), True), "sw.js": sw, "manifest.webmanifest": manifest})
print("build", stamp, "ok")
