"""Build the site: check every card, stamp the build, write dist/site, and copy site + sources into the GitHub checkout.
   python3 build.py            build only
   python3 build.py --repo DIR  also copy into a clone of leighmegan/megans-taboo (site at the top, sources in dev/)"""
import json, os, shutil, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
subprocess.run([sys.executable, "build_cards.py", "--write", "--quiet"], check=True)
stamp = time.strftime("%Y%m%d-%H%M")
def stamped(name): return open(os.path.join("src", name), encoding="utf-8").read().replace("__BUILD__", stamp)
pwa = ('<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon-192.png">'
       '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Megan\'s Taboo">')
sw_reg = "try{if('serviceWorker' in navigator&&location.protocol==='https:'&&window.top===window)navigator.serviceWorker.register('sw.js')}catch(e){}"
cache = ["./", "./index.html", "./styles.css", "./app.js", "./cards.json", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"]
sw = f"""const C='mt-{stamp}';
self.addEventListener('install',e=>{{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll({json.dumps(cache)})))}});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}}).catch(()=>caches.match(e.request,{{ignoreSearch:true}}).then(r=>r||caches.match('./index.html'))))}});
"""
manifest = json.dumps({"name": "Megan's Taboo", "short_name": "Taboo", "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#2b0d3f", "theme_color": "#2b0d3f",
    "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]}, indent=1)
site = "dist/site"; os.makedirs(site, exist_ok=True)
for name, text in {"index.html": stamped("index.html").replace("<!--PWA-->", pwa), "styles.css": stamped("styles.css"),
                   "app.js": stamped("app.js").replace("/*SW*/", sw_reg), "sw.js": sw, "manifest.webmanifest": manifest}.items():
    open(os.path.join(site, name), "w", encoding="utf-8").write(text)
shutil.copy("cards.json", site)
for icon in ("icon-192.png", "icon-512.png"):
    if os.path.exists(os.path.join("src", icon)): shutil.copy(os.path.join("src", icon), site)
if "--repo" in sys.argv:
    repo = sys.argv[sys.argv.index("--repo") + 1]
    for f in os.listdir(site): shutil.copy(os.path.join(site, f), repo)
    dev = os.path.join(repo, "dev"); shutil.rmtree(dev, ignore_errors=True); os.makedirs(dev)
    for d in ("src", "cards", "tests"): shutil.copytree(d, os.path.join(dev, d), ignore=shutil.ignore_patterns("__pycache__"))
    for f in ("build.py", "build_cards.py", "ids.json"): shutil.copy(f, dev)
    open(os.path.join(repo, ".nojekyll"), "w").close()
print("build", stamp, "ok")
