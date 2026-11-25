"""Sync tests for the GitHub build, against a local stand-in for ntfy.sh (SSE + POST).  python3 tests/sync.py"""
import asyncio, json, os, sys, threading, time, queue
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SITE = os.path.join(ROOT, "dist/gh"); PORT = 8801
topics = {}; lock = threading.Lock(); posts = []
class H(SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(s, *a): pass
    def cors(s): s.send_header("Access-Control-Allow-Origin", "*")
    def do_POST(s):
        topic = s.path.split("/")[2]; body = s.rfile.read(int(s.headers["Content-Length"])).decode()
        posts.append((topic, body))
        with lock:
            t = topics.setdefault(topic, {"msgs": [], "subs": []}); t["msgs"].append(body)
            for q in t["subs"]: q.put(body)
        s.send_response(200); s.cors(); s.end_headers(); s.wfile.write(b"{}")
    def do_GET(s):
        if not s.path.startswith("/ntfy/"): return super().do_GET()
        topic = s.path.split("/")[2]; q = queue.Queue()
        with lock:
            t = topics.setdefault(topic, {"msgs": [], "subs": []}); old = list(t["msgs"]); t["subs"].append(q)
        s.send_response(200); s.cors(); s.send_header("Content-Type", "text/event-stream"); s.send_header("Cache-Control", "no-cache"); s.end_headers()
        def send(m): s.wfile.write(("data: " + json.dumps({"event": "message", "message": m}) + "\n\n").encode()); s.wfile.flush()
        try:
            s.wfile.write(b": open\n\n"); s.wfile.flush()
            for m in old: send(m)
            while True:
                try: send(q.get(timeout=1))
                except queue.Empty: s.wfile.write(b": k\n\n"); s.wfile.flush()
        except Exception: pass
        finally:
            with lock: t["subs"].remove(q)
results = []
def check(n, ok, d=""): results.append(ok); print(("PASS " if ok else "FAIL ") + n + (f"  [{d}]" if d and not ok else ""))
URL = f"http://localhost:{PORT}/index.html"
async def phone(b):
    ctx = await b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    await ctx.add_init_script(f"localStorage.setItem('mt:syncUrl',JSON.stringify('http://localhost:{PORT}/ntfy/'))")
    pg = await ctx.new_page(); pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.goto(URL); await pg.wait_for_selector("#s-setup.on"); return ctx, pg
async def setup(pg, name, partner, player, code):
    await pg.fill("#setup-name", name); await pg.fill("#setup-partner", partner)
    await pg.click(f'#s-setup [data-field=player] button:has-text("Player {player}")'); await pg.fill("#setup-code", code)
    await pg.click("#setup-go"); await pg.wait_for_timeout(300); await pg.click("#m-rules [data-close]")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        c1, me = await phone(b); c2, mom = await phone(b)
        await setup(me, "Megan", "Partner", 1, "Pug42")
        check("waiting line before partner joins", "Waiting" in (await me.text_content("#h-sync") or "") or "Connecting" in (await me.text_content("#h-sync") or ""))
        await setup(mom, "Mom", "Meg", 2, "pug42 ")
        await me.wait_for_timeout(1500)
        check("partner's own name shows on my phone", await me.text_content("#h-game") == "Game with Mom", await me.text_content("#h-game"))
        check("my name shows on partner's phone", await mom.text_content("#h-game") == "Game with Megan", await mom.text_content("#h-game"))
        check("synced status", "Synced with Mom" in await me.text_content("#h-sync"), await me.text_content("#h-sync"))
        await me.click("#to-settings"); await me.click('#s-set [data-field=time] button:has-text("2:00")'); await me.click("#s-set [data-back]")
        await mom.wait_for_timeout(1200)
        await mom.click("#to-settings")
        check("round length syncs to partner", await mom.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await mom.click('#s-set [data-field=deck] button:has-text("Adult")'); await mom.click("#s-set [data-back]"); await me.wait_for_timeout(800)
        check("decks stay individual", await me.text_content("#h-deck") == "Classic")
        await mom.click("#to-settings"); await mom.click('#s-set [data-field=player] button:has-text("Player 1")'); await mom.click("#s-set [data-back]")
        await me.wait_for_timeout(1200); await me.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await me.wait_for_timeout(600)
        check("warns when both are the same player", "both Player 1" in await me.text_content("#h-sync"), await me.text_content("#h-sync"))
        await mom.click("#to-settings"); await mom.click('#s-set [data-field=player] button:has-text("Player 2")'); await mom.click("#s-set [data-back]")
        # late joiner: a third phone opening later still learns the latest round length
        c3, late = await phone(b); await setup(late, "Mom", "Meg", 2, "pug42"); await late.wait_for_timeout(1500)
        await late.click("#to-settings")
        check("late joiner gets the latest round length", await late.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        # different code word: no sync
        c4, other = await phone(b); await setup(other, "Stranger", "X", 2, "different"); await other.wait_for_timeout(1200)
        check("different code word doesn't connect", await other.text_content("#h-game") == "Game with X")
        check("only small messages sent", all(len(bd) < 300 for _, bd in posts), max(len(bd) for _, bd in posts))
        errs = me.errs + mom.errs + late.errs + other.errs; check("no script errors", not errs, str(errs))
        await b.close()
    print(f"\n{sum(results)}/{len(results)} passed"); return 0 if all(results) else 1
srv = ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.exit(asyncio.run(main()))
