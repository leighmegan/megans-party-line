"""Megan's Taboo regression suite. Builds nothing: run python3 build.py first, then  python3 tests/run.py [--slow]
Serves dist/site plus a local stand-in for the ntfy.sh relay, and drives phones in headless Chrome."""
import asyncio, json, os, queue, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SITE = os.path.join(ROOT, "dist/site"); PORT = 8802
URL = f"http://localhost:{PORT}/index.html"; RELAY = f"http://localhost:{PORT}/ntfy/"
DATA = json.load(open(os.path.join(SITE, "cards.json"))); CARDS = {c[0]: c for c in DATA["cards"]}; DECKS = DATA["decks"]
BYWORD = {}
for c in CARDS.values(): BYWORD.setdefault(c[4], []).append(c)

# ---------- stand-in relay (same API shape as ntfy.sh: POST /topic, GET /topic/sse) ----------
topics, lock, posts = {}, threading.Lock(), []
class H(SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(s, *a): pass
    def do_POST(s):
        topic = s.path.split("/")[2]; body = s.rfile.read(int(s.headers["Content-Length"])).decode(); posts.append(body)
        with lock:
            t = topics.setdefault(topic, {"msgs": [], "subs": []}); t["msgs"].append(body)
            for q in t["subs"]: q.put(body)
        s.send_response(200); s.send_header("Access-Control-Allow-Origin", "*"); s.end_headers(); s.wfile.write(b"{}")
    def do_GET(s):
        if not s.path.startswith("/ntfy/"): return super().do_GET()
        topic = s.path.split("/")[2]; q = queue.Queue()
        with lock: t = topics.setdefault(topic, {"msgs": [], "subs": []}); old = list(t["msgs"]); t["subs"].append(q)
        s.send_response(200); s.send_header("Access-Control-Allow-Origin", "*"); s.send_header("Content-Type", "text/event-stream"); s.end_headers()
        send = lambda m: (s.wfile.write(("data: " + json.dumps({"event": "message", "message": m}) + "\n\n").encode()), s.wfile.flush())
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
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

async def phone(b, vp=None, device=None, scheme="light"):
    ctx = await b.new_context(viewport=vp or {"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme)
    await ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://localhost:{PORT}")
    init = f"localStorage.setItem('mt:syncUrl',JSON.stringify('{RELAY}'));"
    if device: init += f"if(!localStorage.getItem('mt:v3'))localStorage.setItem('mt:v3',JSON.stringify({{name:'',sound:'on',current:null,games:{{}},defaults:{{deck:'c',time:60}},device:'{device}'}}));"
    await ctx.add_init_script(init)
    pg = await ctx.new_page(); pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.goto(URL); await pg.wait_for_selector("#s-setup.on, #s-home.on"); return ctx, pg

async def setup(pg, name, code, deck="Classic"):
    await pg.fill("#setup-name", name); await pg.click(f'#s-setup [data-field=deck] button:has-text("{deck}")')
    await pg.fill("#setup-code", code); await pg.click("#setup-go"); await pg.wait_for_timeout(300)
    if await pg.is_visible("#m-rules"): await pg.click("#m-rules [data-close]")

async def pick(pg, player):   # the manual fallback
    await pg.click("#to-settings"); await pg.click(f'#s-set [data-field=player] button:has-text("Player {player}")'); await pg.click("#s-set [data-back]")

async def settings_deck(pg, name):
    await pg.click("#to-settings"); await pg.click(f'#s-set [data-field=deck] button:has-text("{name}")')
    if await pg.is_visible("#m-confirm"): await pg.click("#cf-no")
    await pg.click("#s-set [data-back]")

async def play(pg, acts=None, n=10):
    await pg.wait_for_selector("#start:not([disabled])"); await pg.click("#start"); await pg.wait_for_timeout(2700); words = []
    for i in range(n):
        if not await pg.is_visible("#s-play"): break
        words.append(await pg.text_content("#p-word")); a = (acts or {}).get(i, "#b-ok")
        if a == "#b-skip" and await pg.is_disabled("#b-skip"): a = "#b-ok"
        await pg.click(a); await pg.wait_for_timeout(30)
    await pg.wait_for_timeout(150); return words

left = lambda pg: pg.text_content("#h-left")
state = lambda pg: pg.evaluate("(()=>{const s=JSON.parse(localStorage.getItem('mt:v3'));return {s,g:s.games[s.current]}})()")
card = lambda w, side=None: next(c for c in BYWORD[w] if side is None or c[2] == side)

async def main(slow):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome"); allerr = []
        # ---------- two phones: automatic players, names, badges ----------
        c1, me = await phone(b); c2, mom = await phone(b, scheme="dark")
        await setup(me, "Megan", "Pug42")
        check("before partner connects: waiting, can't start", await me.is_disabled("#start") and "Waiting" in await me.text_content("#start"))
        check("manual fallback offered", await me.is_visible("#h-manual"))
        await setup(mom, "Mom", "pug42 "); await me.wait_for_timeout(1500)
        g1 = (await state(me))["g"]; g2 = (await state(mom))["g"]
        check("players picked automatically and different", {g1["player"], g2["player"]} == {"1", "2"}, f"{g1['player']} {g2['player']}")
        check("partner's name fills in on my phone", await me.text_content("#h-game") == "Game with Mom", await me.text_content("#h-game"))
        check("my name fills in on partner's phone", await mom.text_content("#h-game") == "Game with Megan")
        check("start enabled once assigned", await me.is_enabled("#start") and await mom.is_enabled("#start"))
        check("badges match", await me.text_content("#h-badge") == await mom.text_content("#h-badge"))
        check("synced status", "Synced with Mom" in await me.text_content("#h-sync"), await me.text_content("#h-sync"))
        rules = await me.evaluate("document.querySelector('#rules-list').textContent")
        check("rules read from settings", "3 free skips" in rules and "up to 10 cards" in rules)
        side1, side2 = int(g1["player"]) - 1, int(g2["player"]) - 1
        # ---------- play ----------
        w1, w2 = [], []
        for r in range(3):
            w1 += await play(me, {2: "#b-buzz", 3: "#b-skip"})
            if r == 0: check("summary names partner", await me.text_content("#sum-next") == "Mom's turn to give clues.")
            await me.click("#sum-done"); w2 += await play(mom); await mom.click("#sum-done")
        check("no repeats per player", len(set(w1)) == len(w1) == 30 and len(set(w2)) == len(w2) == 30)
        check("players never share cards", not (set(w1) & set(w2)))
        check("each phone draws its own side", all(card(w)[2] == side1 for w in w1) and all(card(w)[2] == side2 for w in w2))
        leaks = [(a, x) for a in w1 for x in w2 if card(a)[3] == card(x)[3] and any(t.lower() == x.lower() for t in card(a)[5])]
        check("no family leaks", not leaks, str(leaks))
        await me.click("#start"); await me.wait_for_timeout(2700); await me.click("#b-ok"); await me.click("#b-undo")
        check("undo un-plays the card", len((await state(me))["g"]["seen"]) == 30)
        await me.click("#b-end"); await me.click("#cf-yes"); await me.wait_for_timeout(150)
        check("end early retires only the card on screen", await me.evaluate("document.querySelectorAll('#sum-list li').length") == 1 and "9 cards" in await me.text_content("#sum-back"))
        await me.click("#sum-done")
        # ---------- sync: round length, decks, clash, late joiner, other code ----------
        await me.click("#to-settings"); await me.click('#s-set [data-field=time] button:has-text("2:00")'); await me.click("#s-set [data-back]")
        await mom.wait_for_timeout(1200); await mom.click("#to-settings")
        check("round length syncs", await mom.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await mom.click('#s-set [data-field=deck] button:has-text("Adult")'); await mom.click("#s-set [data-back]"); await me.wait_for_timeout(600)
        check("decks stay individual", await me.text_content("#h-deck") == "Classic")
        await pick(mom, g1["player"]); await me.wait_for_timeout(1200)
        check("warns when both are the same player", f"both Player {g1['player']}" in await me.text_content("#h-sync"), await me.text_content("#h-sync"))
        await pick(mom, g2["player"])
        c3, late = await phone(b); await setup(late, "Mom", "pug42"); await late.wait_for_timeout(1500); await late.click("#to-settings")
        check("late joiner gets latest round length", await late.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await c3.close()
        c4, other = await phone(b); await setup(other, "Stranger", "different"); await other.wait_for_timeout(1200)
        check("different code word doesn't connect", await other.is_disabled("#start") and (await state(other))["g"]["player"] is None)
        allerr += other.errs; await c4.close()
        # a phone that already has a player keeps it; the newcomer takes the other, even with the lowest phone id
        c5, keep = await phone(b); await setup(keep, "Dana", "locked1"); await pick(keep, "1")
        c6, newc = await phone(b, device="0000"); await setup(newc, "Eli", "locked1"); await newc.wait_for_timeout(1500)
        check("existing player is respected", (await state(newc))["g"]["player"] == "2" and (await state(keep))["g"]["player"] == "1")
        allerr += keep.errs + newc.errs; await c5.close(); await c6.close()
        check("relay messages stay small", max(len(x) for x in posts) < 300)
        # ---------- shared cards and Mixed ----------
        c7, solo = await phone(b); await setup(solo, "Solo", "solo-code"); await pick(solo, "1")
        mixed_ids = {d["id"] for d in DECKS if d.get("mixed", True)}
        want = len({(c[6] if len(c) > 6 else c[0]) for c in CARDS.values() if c[2] == 0 and c[1] in mixed_ids})
        await settings_deck(solo, "Mixed")
        check("Mixed counts each shared word once", (await left(solo)).endswith(f"of {want}"), f"{await left(solo)} vs {want}")
        shared = [c for c in CARDS.values() if c[2] == 0 and c[1] == "c" and len(BYWORD[c[4]]) > 1]
        await settings_deck(solo, "Classic")
        keep_id = shared[0][0]; others = [c[0] for c in CARDS.values() if c[2] == 0 and c[1] == "c" and c[0] != keep_id]
        await solo.evaluate("ids=>{const s=JSON.parse(localStorage.getItem('mt:v3'));s.games[s.current].seen=ids;localStorage.setItem('mt:v3',JSON.stringify(s))}", others)
        await solo.reload(); await solo.wait_for_selector("#start:not([disabled])")
        w = await play(solo); await solo.click("#sum-done")
        seen = set((await state(solo))["g"]["seen"]); copies = [c[0] for c in BYWORD[shared[0][4]]]
        check(f"playing '{shared[0][4]}' marks every deck's copy played", w == [shared[0][4]] and all(i in seen for i in copies), f"{w} {copies}")
        # ---------- decks ----------
        await solo.click("#to-settings"); await solo.click('#s-set [data-field=time] button:has-text("1:00")')
        await solo.click('#s-set [data-field=deck] button:has-text("Hard mode")'); await solo.wait_for_timeout(150)
        check("hard mode suggests 2:00", await solo.is_visible("#m-confirm") and "2:00" in await solo.text_content("#cf-p"))
        await solo.click("#cf-yes"); await solo.wait_for_timeout(100)
        check("accepting sets 2:00", await solo.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await solo.click("#s-set [data-back]")
        for d in DECKS:
            await settings_deck(solo, d["name"]); w = await play(solo); await solo.click("#sum-done")
            check(f"{d['name']} deals its own cards", len(w) == 10 and all(any(c[1] == d["id"] and c[2] == 0 for c in BYWORD[x]) for x in w))
        # ---------- saved games ----------
        solo_left = await left(solo)
        await solo.click("#to-games"); await solo.click("#new-game"); await setup(solo, "Solo", "second-code"); await pick(solo, "2")
        check("new game starts fresh", (await left(solo)).split(" of ")[0] == (await left(solo)).split(" of ")[1])
        await solo.click("#to-games"); await solo.click('#games-list .pick >> nth=1'); await solo.wait_for_timeout(150)
        check("switching back keeps that game's played cards", await left(solo) == solo_left, await left(solo))
        await solo.click("#to-games"); await solo.click("#games-list [data-del]"); await solo.click("#cf-yes"); await solo.wait_for_timeout(150)
        check("deleting another game keeps you in yours", await solo.evaluate("document.querySelectorAll('#games-list li').length") == 1)
        await solo.click("#m-games [data-close]")
        await solo.click("#to-settings"); await solo.click("#bk-copy"); await solo.wait_for_timeout(200); code = await solo.evaluate("navigator.clipboard.readText()")
        check("backup code is short", code.startswith("MTB1.") and len(code) < 1500, len(code))
        await solo.evaluate("localStorage.removeItem('mt:v3')"); await solo.reload(); await solo.wait_for_selector("#s-setup.on")
        await solo.click("#setup-bk"); await solo.fill("#setup-bk-text", code); await solo.click("#setup-bk-go"); await solo.click("#cf-yes"); await solo.wait_for_timeout(200)
        check("restore from the setup screen", await left(solo) == solo_left)
        await solo.click("#to-settings"); await solo.click("#del-game"); await solo.click("#cf-yes"); await solo.wait_for_timeout(200)
        check("deleting current game opens a brand-new game", await solo.is_visible("#s-setup") and await solo.is_hidden("#setup-cancel"))
        allerr += solo.errs; await c7.close()
        # ---------- running out, time-up ----------
        pool = [c[0] for c in CARDS.values() if c[2] == side1 and c[1] == "c"]
        await me.evaluate("ids=>{const s=JSON.parse(localStorage.getItem('mt:v3'));s.games[s.current].seen=ids;localStorage.setItem('mt:v3',JSON.stringify(s))}", pool[3:])
        await me.reload(); w = await play(me); check("last few cards make a short round", len(w) <= 3 and len(w) > 0, len(w)); await me.click("#sum-done")
        await me.click("#start"); await me.wait_for_timeout(200); check("running out reshuffles with a message", "every card" in await me.text_content("#toast"))
        await me.wait_for_timeout(2600); await me.click("#b-end"); await me.click("#cf-yes"); await me.click("#sum-done")
        if slow:
            await mom.click("#to-settings"); await mom.click('#s-set [data-field=time] button:has-text("0:30")'); await mom.click("#s-set [data-back]")
            await mom.click("#start"); await mom.wait_for_timeout(2700); await mom.click("#b-ok"); await mom.wait_for_timeout(31000)
            items = await mom.evaluate("[...document.querySelectorAll('#sum-list li')].map(l=>l.textContent)")
            check("time-up retires the card on screen", len(items) == 2 and "Time's up" in items[1], str(items))
        allerr += me.errs + mom.errs
        # ---------- layout ----------
        for name, vp in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("small", {"width": 360, "height": 640})]:
            ctx, pg = await phone(b, vp=vp); await pg.screenshot(path=os.path.join(ROOT, f"shots/v4-{name}-setup.png"))
            await setup(pg, "Megan", f"lay-{name}")
            for scr in ("home", "settings"):
                if scr == "settings": await pg.click("#to-settings")
                await pg.screenshot(path=os.path.join(ROOT, f"shots/v4-{name}-{scr}.png"), full_page=True)
                check(f"{name} {scr}: no sideways scroll", await pg.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
            allerr += pg.errs; await ctx.close()
        check("no script errors", not allerr, str(allerr)); await b.close()
    print(f"\n{sum(results)}/{len(results)} passed"); return 0 if all(results) else 1

srv = ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.exit(asyncio.run(main("--slow" in sys.argv)))
