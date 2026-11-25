"""Regression suite for Megan's Taboo. Run after every build:  python3 tests/run.py [--slow]
--slow adds the 30-second time-up test."""
import asyncio, json, os, subprocess, sys, time, socket
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799; URL = f"http://localhost:{PORT}/index.html"
CARDS = {c[0]: c for c in json.load(open(os.path.join(ROOT, "dist/artifact/cards.json")))["cards"]}
BYWORD = {c[4]: c for c in CARDS.values()}
results = []
def check(name, ok, detail=""):
    results.append((name, ok)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

async def new_page(b, **kw):
    ctx = await b.new_context(viewport=kw.get("vp", {"width": 390, "height": 844}), is_mobile=True, has_touch=True,
                              color_scheme=kw.get("scheme", "light"))
    await ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://localhost:{PORT}")
    pg = await ctx.new_page(); pg.errs = []
    pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.goto(URL); await pg.wait_for_selector("#start:not([disabled]), #s-setup.on")
    return ctx, pg

async def setup(pg, name, partner, player, deck="Classic", code="Pug42"):
    await pg.fill("#setup-name", name); await pg.fill("#setup-partner", partner)
    await pg.click(f'#s-setup [data-field=player] button:has-text("Player {player}")')
    await pg.click(f'#s-setup [data-field=deck] button:has-text("{deck}")')
    await pg.fill("#setup-code", code); await pg.click("#setup-go"); await pg.wait_for_timeout(350)
    await pg.click("#m-rules [data-close]"); await pg.wait_for_selector("#start:not([disabled])")

async def play(pg, acts=None, n=10):
    await pg.click("#start"); await pg.wait_for_timeout(2700); words = []
    for i in range(n):
        if not await pg.is_visible("#s-play"): break
        words.append(await pg.text_content("#p-word"))
        a = (acts or {}).get(i, "#b-ok")
        if a == "#b-skip" and await pg.is_disabled("#b-skip"): a = "#b-ok"
        await pg.click(a); await pg.wait_for_timeout(30)
    await pg.wait_for_timeout(150); return words

left = lambda pg: pg.text_content("#h-left")

async def main(slow):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        # ---------- migration from version 2 ----------
        ctx, pg = await new_page(b)
        mom_seen = [c[0] for c in CARDS.values() if c[2] == 0 and c[1] == "c"][:37]
        await pg.evaluate("""s=>{localStorage.clear();localStorage.setItem('mt:prefs',JSON.stringify({player:'1',name:'Megan',partner:'Mom',code:'pug42',deck:'classic',time:90,sound:'on',rnd:'abc'}));
          localStorage.setItem('mt:seen:1',JSON.stringify(s))}""", mom_seen)
        await pg.reload(); await pg.wait_for_selector("#start:not([disabled])")
        check("migration: game with Mom created", (await pg.text_content("#h-game")) == "Game with Mom")
        check("migration: played cards kept", (await left(pg)).startswith("371 of 408"), await left(pg))
        badge = await pg.text_content("#h-badge")
        check("migration: badge has shape and color", "undefined" not in badge and len(badge.split()) == 2, badge)
        await pg.click("#to-settings")
        check("migration: round length kept", await pg.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "90")
        await pg.click("#s-set [data-back]"); await ctx.close()

        # ---------- two players, same code word ----------
        c1, p1 = await new_page(b); c2, p2 = await new_page(b, scheme="dark")
        await setup(p1, "Megan", "Sam", 1); await setup(p2, "Sam", "Megan", 2)
        check("badges match on both phones", await p1.text_content("#h-badge") == await p2.text_content("#h-badge"))
        rules = await p1.evaluate("document.querySelector('#rules-list').textContent")
        check("rules read from settings", "3 free skips" in rules and "up to 10 cards" in rules)
        w1, w2 = [], []
        for r in range(3):
            w1 += await play(p1, {2: "#b-buzz", 3: "#b-skip"})
            if r == 0:
                check("summary names partner", (await p1.text_content("#sum-next")) == "Sam's turn to give clues.")
            await p1.click("#sum-done")
            w2 += await play(p2); await p2.click("#sum-done")
        check("no repeats per player", len(set(w1)) == len(w1) == 30 and len(set(w2)) == len(w2) == 30)
        check("players never share cards", not (set(w1) & set(w2)))
        check("each player draws own side", {BYWORD[w][2] for w in w1} == {0} and {BYWORD[w][2] for w in w2} == {1})
        leaks = [(a, x) for a in w1 for x in w2 if BYWORD[a][3] == BYWORD[x][3] and any(t.lower() == x.lower() for t in BYWORD[a][5])]
        check("no family leaks", not leaks, str(leaks))
        # undo / end early
        await p1.click("#start"); await p1.wait_for_timeout(2700); await p1.click("#b-ok"); await p1.click("#b-undo")
        n = await p1.evaluate("JSON.parse(localStorage.getItem('mt:v3')).games[JSON.parse(localStorage.getItem('mt:v3')).current].seen.length")
        check("undo un-plays the card", n == 30, n)
        await p1.click("#b-end"); await p1.click("#cf-yes"); await p1.wait_for_timeout(150)
        check("end early retires only the card on screen", await p1.evaluate("document.querySelectorAll('#sum-list li').length") == 1
              and "9 cards" in await p1.text_content("#sum-back"))
        await p1.click("#sum-done")

        # ---------- saved games ----------
        mom_left = await left(p1)
        await p1.click("#to-games"); await p1.click("#new-game")
        check("new game hides cancel? (no: a game exists)", not await p1.is_hidden("#setup-cancel"))
        await setup(p1, "Megan", "Jess", 1, deck="Adult", code="")
        check("new game starts fresh", (await left(p1)).split(" of ")[0] == (await left(p1)).split(" of ")[1], await left(p1))
        await play(p1); await p1.click("#sum-done")
        await p1.click("#to-games"); await p1.click('#games-list .pick:has-text("Sam")'); await p1.wait_for_timeout(150)
        check("switching back keeps that game's played cards", await left(p1) == mom_left and await p1.text_content("#h-game") == "Game with Sam")
        await p1.click("#to-games")
        check("switcher lists both games", await p1.evaluate("document.querySelectorAll('#games-list li').length") == 2)
        await p1.click('#games-list [data-del]'); await p1.click("#cf-yes"); await p1.wait_for_timeout(150)
        check("deleting another game keeps you in yours", await p1.evaluate("document.querySelectorAll('#games-list li').length") == 1
              and await p1.text_content("#h-game") == "Game with Sam")
        await p1.click("#m-games [data-close]")

        # ---------- backup and restore ----------
        await p1.click("#to-settings"); await p1.click("#bk-copy"); await p1.wait_for_timeout(200)
        code = await p1.evaluate("navigator.clipboard.readText()")
        check("backup code is short", code.startswith("MTB1.") and len(code) < 1500, len(code))
        await p1.evaluate("localStorage.clear()"); await p1.reload(); await p1.wait_for_timeout(500)
        check("cleared phone shows setup", await p1.is_visible("#s-setup"))
        await setup(p1, "X", "Temp", 2)
        await p1.click("#to-settings"); await p1.click("#bk-open"); await p1.fill("#bk-text", code); await p1.click("#bk-restore"); await p1.click("#cf-yes")
        await p1.wait_for_timeout(200)
        check("restore brings games back", await p1.text_content("#h-game") == "Game with Sam" and await left(p1) == mom_left, await left(p1))

        # ---------- delete current game ----------
        await p1.click("#to-settings"); await p1.click("#del-game"); await p1.click("#cf-yes"); await p1.wait_for_timeout(200)
        check("deleting current game opens a brand-new game", await p1.is_visible("#s-setup") and await p1.is_hidden("#setup-cancel"))

        # ---------- running out ----------
        await setup(p1, "Megan", "Mom", 1)
        pool = [c[0] for c in CARDS.values() if c[2] == 0 and c[1] == "c"]
        await p1.evaluate("""ids=>{const s=JSON.parse(localStorage.getItem('mt:v3'));s.games[s.current].seen=ids;localStorage.setItem('mt:v3',JSON.stringify(s))}""", pool[3:])
        await p1.reload(); await p1.wait_for_selector("#start:not([disabled])")
        w = await play(p1); check("last few cards make a short round", len(w) == 3); await p1.click("#sum-done")
        await p1.click("#start"); await p1.wait_for_timeout(200)
        check("running out reshuffles with a message", "every card" in await p1.text_content("#toast"))
        await p1.wait_for_timeout(2600); await p1.click("#b-end"); await p1.click("#cf-yes"); await p1.click("#sum-done")

        # ---------- time-up ----------
        if slow:
            await p2.click("#to-settings"); await p2.click('#s-set [data-field=time] button:has-text("0:30")'); await p2.click("#s-set [data-back]")
            await p2.click("#start"); await p2.wait_for_timeout(2700); await p2.click("#b-ok"); await p2.wait_for_timeout(31000)
            items = await p2.evaluate("[...document.querySelectorAll('#sum-list li')].map(l=>l.textContent)")
            check("time-up retires the card on screen", len(items) == 2 and "Time's up" in items[1] and "8 cards" in await p2.text_content("#sum-back"), str(items))

        # ---------- new decks ----------
        ctx, pg = await new_page(b); await setup(pg, "Megan", "Mom", 1)
        await pg.click("#to-settings"); await pg.click('#s-set [data-field=time] button:has-text("1:00")')
        await pg.click('#s-set [data-field=deck] button:has-text("Hard mode")'); await pg.wait_for_timeout(150)
        check("hard mode suggests 2:00", await pg.is_visible("#m-confirm") and "2:00" in await pg.text_content("#cf-p"))
        await pg.click("#cf-yes"); await pg.wait_for_timeout(100)
        check("accepting sets 2:00", await pg.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await pg.click('#s-set [data-field=deck] button:has-text("Classic")'); await pg.click('#s-set [data-field=deck] button:has-text("Hard mode")')
        check("no suggestion when already 2:00", not await pg.is_visible("#m-confirm"))
        decks = json.load(open(os.path.join(ROOT, "dist/artifact/cards.json")))["decks"]
        mixed_ids = {d["id"] for d in decks if d.get("mixed", True)}
        await pg.click('#s-set [data-field=deck] button:has-text("Mixed")'); await pg.click("#s-set [data-back]")
        want = sum(1 for c in CARDS.values() if c[2] == 0 and c[1] in mixed_ids)
        check("mixed skips decks marked out of it (Kids)", (await left(pg)).endswith(f"of {want}"), await left(pg))
        for d in decks:
            await pg.click("#to-settings"); await pg.click(f'#s-set [data-field=deck] button:has-text("{d["name"]}")')
            if await pg.is_visible("#m-confirm"): await pg.click("#cf-no")
            await pg.click("#s-set [data-back]")
            w = await play(pg); await pg.click("#sum-done")
            check(f"{d['name']} deck deals its own cards", len(w) == 10 and all(BYWORD[x][1] == d["id"] and BYWORD[x][2] == 0 for x in w))
        await ctx.close()

        # ---------- layout at phone sizes ----------
        for name, vp in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("small", {"width": 360, "height": 640})]:
            ctx, pg = await new_page(b, vp=vp)
            await setup(pg, "Megan", "Mom", 1)
            for scr in ["home", "settings"]:
                if scr == "settings": await pg.click("#to-settings")
                await pg.screenshot(path=os.path.join(ROOT, f"shots/v3-{name}-{scr}.png"), full_page=True)
                ow = await pg.evaluate("document.documentElement.scrollWidth-innerWidth")
                check(f"{name} {scr}: no sideways scroll", ow <= 0, ow)
            await pg.click("#s-set [data-back]"); await pg.click("#to-games"); await pg.screenshot(path=os.path.join(ROOT, f"shots/v3-{name}-games.png"))
            await ctx.close()
        errs = p1.errs + p2.errs
        check("no script errors", not errs, str(errs))
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0

if __name__ == "__main__":
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)], cwd=os.path.join(ROOT, "dist/artifact"),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: socket.create_connection(("localhost", PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    try: code = asyncio.run(main("--slow" in sys.argv))
    finally: srv.terminate()
    sys.exit(code)
