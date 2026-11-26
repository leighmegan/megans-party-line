"""Megan's Taboo regression suite. Builds nothing: run python3 build.py first, then  python3 tests/run.py [--slow]
Serves dist/site plus a local stand-in for the ntfy.sh relay, and drives phones in headless Chrome."""
import asyncio, json, os, queue, sys, threading, time
from urllib.parse import urlparse, parse_qs
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SITE = os.path.join(ROOT, "dist/site"); PORT = 8802
URL = f"http://localhost:{PORT}/index.html"; RELAY = f"http://localhost:{PORT}/ntfy/"
DATA = json.load(open(os.path.join(SITE, "cards.json"))); CARDS = {c[0]: c for c in DATA["cards"]}; DECKS = DATA["decks"]
BYWORD = {}
for c in CARDS.values(): BYWORD.setdefault(c[4], []).append(c)

# ---------- stand-in relay (same API shape as ntfy.sh: POST /topic, GET /topic/sse) ----------
topics, lock, posts = {}, threading.Lock(), []
DROP = set(); SINCE = []   # message types the stand-in relay throws away, to test self-healing
class H(SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(s, *a): pass
    def do_POST(s):
        topic = s.path.split("/")[2]; body = s.rfile.read(int(s.headers["Content-Length"])).decode(); posts.append(body)
        if json.loads(body).get("type") in DROP:
            s.send_response(200); s.send_header("Access-Control-Allow-Origin", "*"); s.end_headers(); s.wfile.write(b"{}"); return
        with lock:
            t = topics.setdefault(topic, {"msgs": [], "subs": []}); msg = {"id": f"m{len(posts)}", "time": time.time(), "message": body}; t["msgs"].append(msg)
            for q in t["subs"]: q.put(msg)
        s.send_response(200); s.send_header("Access-Control-Allow-Origin", "*"); s.end_headers(); s.wfile.write(b"{}")
    def do_GET(s):
        if not s.path.startswith("/ntfy/"): return super().do_GET()
        topic = s.path.split("/")[2]; q = queue.Queue(); since = parse_qs(urlparse(s.path).query).get("since", ["all"])[0]; SINCE.append(since)
        with lock:
            t = topics.setdefault(topic, {"msgs": [], "subs": []}); old = list(t["msgs"]); t["subs"].append(q)
        if since.endswith("m") and since[:-1].isdigit(): old = [m for m in old if m["time"] >= time.time() - 60 * int(since[:-1])]
        elif since != "all":
            ids = [m["id"] for m in old]; old = old[ids.index(since) + 1:] if since in ids else old
        s.send_response(200); s.send_header("Access-Control-Allow-Origin", "*"); s.send_header("Content-Type", "text/event-stream"); s.end_headers()
        send = lambda m: (s.wfile.write(("data: " + json.dumps({"id": m["id"], "time": int(m["time"]), "event": "message", "message": m["message"]}) + "\n\n").encode()), s.wfile.flush())
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

async def phone(b, vp=None, device=None, scheme="light", clock=0, live=None):
    ctx = await b.new_context(viewport=vp or {"width": 390, "height": 844}, is_mobile=True, has_touch=True, color_scheme=scheme)
    await ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://localhost:{PORT}")
    init = f"localStorage.setItem('mt:syncUrl',JSON.stringify('{RELAY}'));"
    if clock: init += f"(()=>{{const n=Date.now;Date.now=()=>n()+({clock})}})();"
    if live: init += f"localStorage.setItem('mt:liveWindow','{live}');"
    if device: init += f"if(!localStorage.getItem('mt:v3'))localStorage.setItem('mt:v3',JSON.stringify({{name:'',sound:'on',current:null,games:{{}},defaults:{{deck:'c',time:60}},device:'{device}'}}));"
    await ctx.add_init_script(init)
    pg = await ctx.new_page(); pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.goto(URL); await pg.wait_for_selector("#s-setup.on, #s-home.on"); return ctx, pg

async def setup(pg, name, code, deck="Classic"):
    await pg.fill("#setup-name", name); await pg.click(f'#s-setup [data-field=deck] button:has-text("{deck}")')
    await pg.fill("#setup-code", code); await pg.click("#setup-go"); await pg.wait_for_timeout(300)
    if await pg.is_visible("#m-rules"): await pg.click("#m-rules [data-close]")

async def pick(pg, player):   # the manual fallback
    await dismiss(pg); await pg.click("#to-settings"); await pg.click(f'#s-set [data-field=player] button:has-text("Player {player}")')
    await pg.wait_for_timeout(100)
    if await pg.is_visible("#m-confirm"): pg.warned = "half of the cards" in await pg.text_content("#cf-p"); await pg.click("#cf-yes")
    await pg.click("#s-set [data-back]")

async def answer(pg, suggestion="#cf-no"):
    """Deck switches can ask two things: 'ends this game' (yes, then close the credits) and a round-length suggestion."""
    for _ in range(2):
        await pg.wait_for_timeout(150)
        if not await pg.is_visible("#m-confirm"): break
        if "ends this game" in await pg.text_content("#cf-p"):
            await pg.click("#cf-yes"); await pg.wait_for_timeout(150)
            if await pg.is_visible("#s-credits"): await pg.click("#cr-done")
        else: await pg.click(suggestion)

async def settings_deck(pg, name, suggestion="#cf-no"):
    await dismiss(pg); await pg.click("#to-settings"); await pg.click(f'#s-set [data-field=deck] button:has-text("{name}")')
    await answer(pg, suggestion)
    if await pg.is_visible("#s-set"): await pg.click("#s-set [data-back]")

async def dismiss(pg):
    if await pg.is_visible("#sp-ok"): await pg.click("#sp-ok"); await pg.wait_for_timeout(100)

async def play(pg, acts=None, n=10):
    await pg.wait_for_selector("#start:not([disabled])"); await dismiss(pg); await pg.click("#start"); await pg.wait_for_timeout(2700); words = []
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
        await setup(mom, "Mom", "pug42 "); await me.wait_for_timeout(2600)
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
        await dismiss(me); await me.click("#start"); await me.wait_for_timeout(2700); await me.click("#b-ok"); await me.click("#b-undo")
        check("undo un-plays the card", len((await state(me))["g"]["seen"]) == 30)
        await me.click("#b-end"); await me.click("#cf-yes"); await me.wait_for_timeout(150)
        check("end early retires only the card on screen", await me.evaluate("document.querySelectorAll('#sum-list li').length") == 1 and "9 cards" in await me.text_content("#sum-back"))
        await me.click("#sum-done")
        # ---------- sync: round length, decks, clash, late joiner, other code ----------
        await dismiss(me); await me.click("#to-settings"); await me.click('#s-set [data-field=time] button:has-text("2:00")'); await me.click("#s-set [data-back]")
        await mom.wait_for_timeout(1200); await dismiss(mom); await mom.click("#to-settings")
        check("round length syncs", await mom.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await mom.click('#s-set [data-field=deck] button:has-text("Adult")')
        if await mom.is_visible("#m-confirm"): await mom.click("#cf-yes")
        await me.wait_for_timeout(1200)
        for ph in (me, mom):
            if await ph.is_visible("#s-credits"): await ph.click("#cr-done")
        if await mom.is_visible("#s-set"): await mom.click("#s-set [data-back]")
        check("decks stay individual", await me.text_content("#h-deck") == "Classic")
        await pick(mom, g1["player"]); await me.wait_for_timeout(1200)
        check("warns when both are the same player", f"both Player {g1['player']}" in await me.text_content("#h-sync"), await me.text_content("#h-sync"))
        await pick(mom, g2["player"]); check("switching players after playing asks first", getattr(mom, "warned", False))
        c3, late = await phone(b); await setup(late, "Mom", "pug42"); await late.wait_for_timeout(1500); await dismiss(late)
        await late.click("#to-settings")
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
        check("relay messages stay under the relay's 4 KB limit", max(len(x) for x in posts) < 3500, max(len(x) for x in posts))
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
        seen = set((await state(solo))["g"]["seen"]); copies = [c for c in BYWORD[shared[0][4]]]
        check(f"playing '{shared[0][4]}' in Classic marks only the Classic copy", w == [shared[0][4]] and shared[0][0] in seen and not any(c[0] in seen for c in copies if c[1] != "c"), f"{w}")
        before = await left(solo); await settings_deck(solo, "Mixed")
        groups = {}
        for c in CARDS.values():
            if c[2] == 0 and c[1] in mixed_ids: groups.setdefault(c[6] if len(c) > 6 else c[0], []).append(c[0])
        expect = sum(1 for ids in groups.values() if not any(i in seen for i in ids))
        check("Mixed counts that word as played", int((await left(solo)).split(" of ")[0]) == expect, f"{await left(solo)} vs {expect}")
        await settings_deck(solo, "Classic")
        # ---------- decks ----------
        await dismiss(solo); await solo.click("#to-settings"); await solo.click('#s-set [data-field=time] button:has-text("1:00")'); await solo.click("#s-set [data-back]")
        await settings_deck(solo, "Classic"); await dismiss(solo); await solo.click("#to-settings")
        await solo.click('#s-set [data-field=deck] button:has-text("Hard mode")'); await solo.wait_for_timeout(150)
        if "ends this game" in await solo.text_content("#cf-p"):
            await solo.click("#cf-yes"); await solo.wait_for_timeout(150); await solo.click("#cr-done"); await solo.wait_for_timeout(150)
        check("hard mode suggests 2:00", await solo.is_visible("#m-confirm") and "2:00" in await solo.text_content("#cf-p"), await solo.text_content("#cf-p"))
        await solo.click("#cf-yes"); await solo.wait_for_timeout(100)
        if not await solo.is_visible("#s-set"): await dismiss(solo); await solo.click("#to-settings")
        check("accepting sets 2:00", await solo.get_attribute('#s-set [data-field=time] button[aria-pressed=true]', "data-v") == "120")
        await solo.click("#s-set [data-back]")
        for d in DECKS:
            await settings_deck(solo, d["name"]); w = await play(solo); await solo.click("#sum-done")
            check(f"{d['name']} deals its own cards", len(w) == 10 and all(any(c[1] == d["id"] and c[2] == 0 for c in BYWORD[x]) for x in w))
        # ---------- turn flow: splash, turns, final round, credits ----------
        c8, a = await phone(b, device="1111"); c9, z = await phone(b, device="9999")
        await setup(a, "Megan", "turns"); await setup(z, "Mom", "turns"); await a.wait_for_timeout(1500)
        check("turn line before anyone plays", "Either of you can start" in await a.text_content("#h-turn"))
        check("no scores in fun mode", await a.text_content(".score small") == "Guessed")
        await dismiss(a); await a.click("#start"); await z.wait_for_timeout(1200)
        check("guesser sees splash with partner's name", await z.is_visible("#splash") and "Megan" in await z.text_content("#sp-name"))
        t1 = await z.text_content("#sp-timer"); await z.wait_for_timeout(2600); t2 = await z.text_content("#sp-timer")
        check("splash timer counts down", t1 != t2, f"{t1} {t2}")
        check("guesser can't start during partner's round", await z.is_disabled("#start"))
        check("splash offers Final round", await z.is_visible("#sp-final"))
        await a.wait_for_timeout(1500); await a.click("#b-pause"); await z.wait_for_timeout(1000)
        p1 = await z.text_content("#sp-timer"); await z.wait_for_timeout(1600)
        check("pause shows on the guesser's splash", "Paused" in await z.text_content("#sp-sub") and p1 == await z.text_content("#sp-timer"))
        await a.click("#resume")
        for k in ["#b-ok", "#b-ok", "#b-skip", "#b-buzz"]: await a.click(k); await a.wait_for_timeout(40)
        await a.click("#b-end"); await a.click("#cf-yes"); await z.wait_for_timeout(1200)
        check("splash shows round counts only", "2 guessed · 1 skipped · 1 buzzed" in await z.text_content("#sp-line"), await z.text_content("#sp-line"))
        await z.click("#sp-ok")
        check("home says it's my turn", "Your turn" in await z.text_content("#h-turn"))
        await a.click("#sum-done"); check("partner's phone says it's Mom's turn", "Mom's turn" in await a.text_content("#h-turn"))
        # collision: both start at once; the higher phone id backs off
        await dismiss(a); await dismiss(z)
        await asyncio.gather(a.evaluate("document.getElementById('start').click()"), z.evaluate("document.getElementById('start').click()")); await a.wait_for_timeout(2500)
        check("both pressing Start: one backs off", await a.is_visible("#s-play") and not await z.is_visible("#s-play") and await z.is_visible("#splash"))
        await a.click("#b-ok"); await a.click("#b-end"); await a.click("#cf-yes"); await a.click("#sum-done"); await z.wait_for_timeout(900)
        await dismiss(z)
        # a lost 'end' message heals from the next check-in
        DROP.add("end"); await dismiss(z); await z.click("#start"); await z.wait_for_timeout(2800); await z.click("#b-ok"); await z.click("#b-end"); await z.click("#cf-yes")
        DROP.discard("end"); await z.click("#sum-done"); await a.wait_for_timeout(1500)
        await z.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await a.wait_for_timeout(3500)
        sa = (await state(a))["g"]["session"]
        check("lost end message heals", len([r for r in sa["rounds"] if r["who"] == "them"]) == 1 and not await a.is_visible("#sp-timer:visible"), str([r["who"] for r in sa["rounds"]]))
        await dismiss(a)
        # final round with uneven counts: Megan 2, Mom 1 -> Mom catches up and both play one more (Megan 1, Mom 2)
        await dismiss(a); await a.click("#final-btn"); await a.click("#cf-yes"); await z.wait_for_timeout(1200)
        check("final round evens out uneven rounds", "Mom has 2 rounds left, you have 1 round left" in await a.text_content("#h-final") and "you have 2 rounds left" in await z.text_content("#h-final"), await a.text_content("#h-final") + " | " + await z.text_content("#h-final"))
        await dismiss(a); await a.click("#start"); await a.wait_for_timeout(2800); await a.click("#b-ok"); await a.click("#b-end"); await a.click("#cf-yes"); await a.click("#sum-done")
        check("after my final round I wait for partner's", await a.is_disabled("#start") and "final round" in await a.text_content("#start"))
        check("turn line agrees with the Start button", "final round" in await a.text_content("#h-turn") and "Your turn" not in await a.text_content("#h-turn"), await a.text_content("#h-turn"))
        await z.wait_for_timeout(900)
        await dismiss(z)
        for _ in range(2):
            await dismiss(z); await z.click("#start"); await z.wait_for_timeout(2800); await z.click("#b-ok"); await z.click("#b-end"); await z.click("#cf-yes"); await z.click("#sum-done")
            await a.wait_for_timeout(1500)
            if not await z.is_visible("#s-credits"): check("partner still owes a round", "1 round left" in await z.text_content("#h-final") or await z.is_visible("#s-credits"))
        await dismiss(a)
        await a.wait_for_timeout(300)
        check("credits roll on both phones", await a.is_visible("#s-credits") and await z.is_visible("#s-credits"))
        cr = await a.text_content("#cr-in")
        check("credits name both players and partner's guessed cards", "Megan & Mom" in cr and "You guessed" in cr, cr[:200])
        await a.click("#cr-done"); await z.click("#cr-done")
        check("new game after credits", len((await state(a))["g"]["session"]["rounds"]) == 0 and "Either of you" in await a.text_content("#h-turn"))
        # deck switch while the partner is mid-round: their round doesn't leak into the new game
        await play(z); await z.click("#sum-done"); await a.wait_for_timeout(900)
        await dismiss(a); await a.click("#start"); await a.wait_for_timeout(2800); await a.click("#b-ok")
        await dismiss(z); await z.evaluate("document.getElementById('splash').classList.remove('on')")
        await z.click("#to-settings"); await z.click('#s-set [data-field=deck] button:has-text("Kids")'); await z.wait_for_timeout(150)
        if await z.is_visible("#m-confirm"): await z.click("#cf-yes")
        await z.wait_for_timeout(300)
        if await z.is_visible("#s-credits"): await z.click("#cr-done")
        await a.click("#b-end"); await a.click("#cf-yes"); await a.wait_for_timeout(300); await a.click("#sum-done"); await z.wait_for_timeout(1500)
        check("a round from the old game stays out of the new one", len((await state(z))["g"]["session"]["rounds"]) == 0, str((await state(z))["g"]["session"]["rounds"]))
        for ph in (a, z):
            if await ph.is_visible("#s-credits"): await ph.click("#cr-done")
        await settings_deck(z, "Classic"); await settings_deck(a, "Classic")
        # deck switch ends the game for both
        await dismiss(a); await a.click("#start"); await a.wait_for_timeout(2800); await a.click("#b-ok"); await a.click("#b-end"); await a.click("#cf-yes"); await a.click("#sum-done")
        await z.wait_for_timeout(900)
        await dismiss(z)
        await dismiss(z); await z.click("#to-settings"); await z.click('#s-set [data-field=deck] button:has-text("Holidays")')
        check("switching decks asks first", "ends this game" in await z.text_content("#cf-p")); await z.click("#cf-yes"); await a.wait_for_timeout(1500)
        check("deck switch shows credits on both, with who switched", await z.is_visible("#s-credits") and await a.is_visible("#s-credits") and "Mom switched decks" in await a.text_content("#cr-why"), await a.text_content("#cr-why"))
        allerr += a.errs + z.errs; await c8.close(); await c9.close()
        # play as: a team name for a room game, separate from your usual name
        c10, r1 = await phone(b); c11, r2 = await phone(b)
        await setup(r1, "Megan", "solo-x"); await dismiss(r1); await r1.click("#to-games"); await r1.click("#new-game")
        check("play as starts with your usual name", await r1.input_value("#setup-name") == "Megan")
        await setup(r1, "Red team", "party"); await setup(r2, "Blue team", "party"); await r1.wait_for_timeout(1500)
        check("team names show on the other phone", await r1.text_content("#h-game") == "Game with Blue team" and await r2.text_content("#h-game") == "Game with Red team")
        check("usual name unchanged", (await state(r1))["s"]["name"] == "Megan")
        allerr += r1.errs + r2.errs; await c10.close(); await c11.close()
        # relay unreachable: solo play, final round still ends
        c12, off = await phone(b); await off.add_init_script("localStorage.setItem('mt:syncUrl',JSON.stringify('http://localhost:1/'))")
        await off.reload(); await off.wait_for_selector("#s-setup.on"); await setup(off, "Solo", "nobody"); await pick(off, "1"); await off.wait_for_timeout(1500)
        check("unreachable relay says playing solo", "solo" in await off.text_content("#h-sync") or "Connecting" in await off.text_content("#h-sync"), await off.text_content("#h-sync"))
        await dismiss(off); await off.click("#start"); await off.wait_for_timeout(2800); await off.click("#b-ok"); await off.click("#b-end"); await off.click("#cf-yes"); await off.click("#sum-done")
        await dismiss(off); await off.click("#final-btn"); await off.click("#cf-yes")
        await dismiss(off); await off.click("#start"); await off.wait_for_timeout(2800); await off.click("#b-ok"); await off.click("#b-end"); await off.click("#cf-yes"); await off.click("#sum-done"); await off.wait_for_timeout(300)
        check("solo final round ends with credits", await off.is_visible("#s-credits"))
        allerr += off.errs; await c12.close()

        # ---------- review fixes ----------
        c20, x = await phone(b, device="2222", live=4000); c21, y = await phone(b, device="8888", live=4000)
        await setup(x, "Xena", "fixes"); await setup(y, "Yuri", "fixes", deck="Adult"); await x.wait_for_timeout(2600)
        check("badge depends on the code word only (decks differ)", await x.text_content("#h-badge") == await y.text_content("#h-badge"))
        # typing in Settings survives partner messages
        await dismiss(x); await x.click("#to-settings"); await x.click("#set-partner"); await x.keyboard.type("Typing")
        await y.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await x.wait_for_timeout(1200)
        check("typing in Settings isn't wiped by sync", (await x.input_value("#set-partner")).endswith("Typing"), await x.input_value("#set-partner"))
        await x.fill("#set-partner", "Yuri"); await x.click("#s-set [data-back]")
        # clock skew doesn't shorten the guesser's timer
        c22, skew = await phone(b, device="3333", clock=-20000); await setup(skew, "Sky", "skewed"); c23, giver = await phone(b, device="7777"); await setup(giver, "Gus", "skewed"); await giver.wait_for_timeout(2600)
        await dismiss(giver); await giver.click("#start"); await skew.wait_for_timeout(4000)
        st_ = await skew.text_content("#sp-timer"); check("splash timer ignores a 20-second clock difference", st_ in ("0:57", "0:58", "0:59", "1:00"), st_)
        # the clue-giver reloads mid-round: the guesser's splash clears and it's still their turn
        n_before = len(posts); await giver.reload(); await giver.wait_for_selector("#s-home.on"); await skew.wait_for_timeout(3500)
        check("reopening the app reconnects on its own", any(json.loads(x)["type"] == "hi" and json.loads(x)["d"] == "7777" for x in posts[n_before:]))
        check("reconnecting fetches only new messages", SINCE[-1].startswith("m") and SINCE[-1][1:].isdigit(), SINCE[-1])
        check("abandoned round clears the guesser's splash", not await skew.is_visible("#splash"))
        check("abandoned round doesn't count", len((await state(skew))["g"]["session"]["rounds"]) == 0)
        # a stranger with the same code word is ignored once players are set
        c24, stranger = await phone(b); await setup(stranger, "Stranger", "skewed"); await skew.wait_for_timeout(2000)
        check("stranger on the same code word is ignored", await skew.text_content("#h-game") == "Game with Gus", await skew.text_content("#h-game"))
        allerr += skew.errs + giver.errs; await c22.close(); await c23.close(); await c24.close()
        # final round when the partner's phone went quiet: their rounds still count
        await play(x); await x.click("#sum-done"); await y.wait_for_timeout(800); await play(y); await y.click("#sum-done"); await play(y); await y.click("#sum-done")
        await x.wait_for_timeout(1000); await c21.close(); await x.wait_for_timeout(5000); await x.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await x.wait_for_timeout(300)
        check("status stops saying Synced when the partner goes quiet", "Synced" not in await x.text_content("#h-sync"), await x.text_content("#h-sync"))
        await dismiss(x); await x.click("#final-btn"); await x.click("#cf-yes"); await x.wait_for_timeout(200)
        check("final round counts a quiet partner's rounds (2 vs 1 -> 3)", "you have 2 rounds left" in await x.text_content("#h-final"), await x.text_content("#h-final"))
        allerr += x.errs; await c20.close()
        # Hard mode suggestion accepted at setup is a real choice
        c25, p1 = await phone(b, device="4444"); await setup(p1, "Pam", "choice"); await p1.click("#to-settings"); await p1.click('#s-set [data-field=time] button:has-text("1:30")'); await p1.click("#s-set [data-back]")
        c26, p2 = await phone(b, device="6666")
        await p2.fill("#setup-name", "Pat"); await p2.click('#s-setup [data-field=deck] button:has-text("Hard mode")'); await p2.wait_for_timeout(150)
        if await p2.is_visible("#m-confirm"): await p2.click("#cf-yes")
        await p2.fill("#setup-code", "choice"); await p2.click("#setup-go"); await p2.wait_for_timeout(400)
        if await p2.is_visible("#m-rules"): await p2.click("#m-rules [data-close]")
        await p1.wait_for_timeout(2600)
        check("Hard mode 2:00 picked at setup wins over older choice", (await state(p2))["g"]["time"] == 120 and (await state(p1))["g"]["time"] == 120, f'{(await state(p2))["g"]["time"]} {(await state(p1))["g"]["time"]}')
        allerr += p1.errs + p2.errs; await c25.close(); await c26.close()
        # first-ever game with a team name, and rules only once
        c27, t1 = await phone(b); await setup(t1, "Red team", "teamcode")
        check("a team name in the first game isn't saved as your usual name", (await state(t1))["s"]["name"] == "" and (await state(t1))["g"]["playAs"] == "Red team")
        await t1.click("#to-games"); await t1.click("#new-game"); await t1.fill("#setup-name", "Megan"); await t1.fill("#setup-code", "another"); await t1.click("#setup-go"); await t1.wait_for_timeout(500)
        check("rules pop up only for the first game", not await t1.is_visible("#m-rules"))
        allerr += t1.errs; await c27.close()

        # ---------- saved games ----------
        solo_left = await left(solo)
        await dismiss(solo); await solo.click("#to-games"); await solo.click("#new-game"); await setup(solo, "Solo", "second-code"); await pick(solo, "2")
        check("new game starts fresh", (await left(solo)).split(" of ")[0] == (await left(solo)).split(" of ")[1])
        await dismiss(solo); await solo.click("#to-games"); await solo.click('#games-list .pick >> nth=1'); await solo.wait_for_timeout(150)
        check("switching back keeps that game's played cards", await left(solo) == solo_left, await left(solo))
        await dismiss(solo); await solo.click("#to-games"); await solo.click("#games-list [data-del]"); await solo.click("#cf-yes"); await solo.wait_for_timeout(150)
        check("deleting another game keeps you in yours", await solo.evaluate("document.querySelectorAll('#games-list li').length") == 1)
        await solo.click("#m-games [data-close]")
        await dismiss(solo); await solo.click("#to-settings")
        check("backup buttons are hidden for now", await solo.is_hidden("#bk-copy")); await solo.click("#s-set [data-back]")
        await dismiss(solo); await solo.click("#to-settings"); await solo.click("#del-game"); await solo.click("#cf-yes"); await solo.wait_for_timeout(200)
        check("deleting current game opens a brand-new game", await solo.is_visible("#s-setup") and await solo.is_hidden("#setup-cancel"))
        allerr += solo.errs; await c7.close()
        # ---------- running out, time-up ----------
        pool = [c[0] for c in CARDS.values() if c[2] == side1 and c[1] == "c"]
        await me.evaluate("ids=>{const s=JSON.parse(localStorage.getItem('mt:v3'));s.games[s.current].seen=ids;localStorage.setItem('mt:v3',JSON.stringify(s))}", pool[3:])
        await me.reload(); w = await play(me); check("last few cards make a short round", len(w) <= 3 and len(w) > 0, len(w)); await me.click("#sum-done")
        await dismiss(me); await me.click("#start"); await me.wait_for_timeout(200); check("running out reshuffles with a message", "every card" in await me.text_content("#toast"))
        await me.wait_for_timeout(2600); await me.click("#b-end"); await me.click("#cf-yes"); await me.click("#sum-done")
        if slow:
            await dismiss(mom); await mom.click("#to-settings"); await mom.click('#s-set [data-field=time] button:has-text("1:00")'); await mom.click("#s-set [data-back]")
            await dismiss(mom); await mom.click("#start"); await mom.wait_for_timeout(2700); await mom.click("#b-ok"); await mom.wait_for_timeout(61000)
            items = await mom.evaluate("[...document.querySelectorAll('#sum-list li')].map(l=>l.textContent)")
            check("time-up retires the card on screen", len(items) == 2 and "Time's up" in items[1], str(items))
        allerr += me.errs + mom.errs
        # ---------- v6: first screen ----------
        c30, fs = await phone(b)
        check("first screen shows the Taboo card", await fs.is_visible("#s-setup .hero .mini"))
        check("first screen has Rules and a gear", await fs.is_visible('#s-setup [data-open=rules]') and await fs.is_visible("#setup-set"))
        check("no backup button on the first screen", await fs.is_hidden("#setup-bk"))
        await fs.fill("#setup-code", "pug42"); check("badge shows while typing the code word", await fs.evaluate("!!document.querySelector('#setup-badge svg')"))
        await fs.click("#setup-set"); check("gear opens settings with only the everything section", await fs.is_visible("#s-set") and await fs.is_hidden("#set-game") and await fs.is_visible("#set-name"))
        await fs.click("#s-set [data-back]"); check("settings goes back to the first screen, keeping what you typed", await fs.is_visible("#s-setup") and await fs.input_value("#setup-code") == "pug42")
        await fs.click('#s-setup [data-open=rules]'); rl = await fs.evaluate("[...document.querySelectorAll('#rules-list li')].length")
        check("rules are short", rl <= 9, rl); await fs.click("#m-rules [data-close]"); allerr += fs.errs; await c30.close()
        # ---------- v6: keep score ----------
        ca, ann = await phone(b, device="1111"); cb, bea = await phone(b, device="2222", scheme="dark")
        await setup(ann, "Ann", "match-one"); await setup(bea, "Bea", "match-one"); await ann.wait_for_timeout(2500)
        times = await ann.evaluate("(()=>{document.querySelector('#to-settings').click();return [...document.querySelectorAll('#s-set [data-field=time] button')].map(b=>b.textContent)})()")
        check("round lengths are 1:00, 1:30, 2:00, Unlimited", times == ["1:00", "1:30", "2:00", "Unlimited"], str(times))
        await ann.click('#s-set [data-field=time] button:has-text("Unlimited")'); await ann.click("#s-set [data-back]"); await bea.wait_for_timeout(1200)
        await ann.click("#h-score"); check("Keep score needs a timer", "needs a timer" in await ann.text_content("#toast") and await ann.is_visible("#s-home"))
        await ann.click("#start"); await ann.wait_for_timeout(2700)
        check("unlimited round shows No timer", await ann.text_content("#timer") == "No timer")
        await bea.wait_for_timeout(600); check("guesser's splash shows No timer", await bea.text_content("#sp-timer") == "No timer")
        await ann.wait_for_timeout(1500); check("no timer never runs out", await ann.is_visible("#s-play"))
        await ann.click("#b-ok"); await ann.click("#b-end"); await ann.click("#cf-yes"); await ann.click("#sum-done"); await bea.wait_for_timeout(800); await dismiss(bea)
        await ann.click("#to-settings"); await ann.click('#s-set [data-field=time] button:has-text("1:00")'); await ann.click("#s-set [data-back]"); await bea.wait_for_timeout(1200)
        await play(bea, n=1); await bea.click("#b-end"); await bea.click("#cf-yes"); await bea.click("#sum-done"); await ann.wait_for_timeout(800); await dismiss(ann)   # even rounds
        await ann.click("#h-score"); await ann.wait_for_selector("#s-score.on")
        firsts = await ann.evaluate("[...document.querySelectorAll('#s-score .seg')].map(s=>s.querySelector('button').getAttribute('aria-pressed'))")
        check("Keep score defaults are the left option, already picked", firsts == ["true"] * 4, str(firsts))
        lines = await ann.evaluate("[...document.querySelectorAll('#s-score .seg')].map(s=>new Set([...s.children].map(b=>b.getBoundingClientRect().top)).size)")
        check("each Keep score row is on one line", lines == [1, 1, 1, 1], str(lines))
        labels = await ann.evaluate("[...document.querySelectorAll('#s-score .seg')].map(s=>[...s.children].map(b=>b.textContent).join(' · '))")
        check("Keep score options read in order", labels == ["Team · Head-to-head", "20 cards · 5 rounds each", "−1 · −0.5 · 0", "Weighted · Equal"], str(labels))
        await ann.click('#s-score [data-field=type] button:has-text("Head-to-head")')
        check("head-to-head says First to 20", "First to 20" in await ann.text_content('#s-score [data-field=win]'))
        check("weights read from the deck list", "Kids ½" in await ann.text_content("#val-note") and "Hard mode 1½" in await ann.text_content("#val-note"), await ann.text_content("#val-note"))
        await ann.click("#score-go"); await ann.wait_for_timeout(100); check("inviter waits for partner", "Waiting for Bea" in await ann.text_content("#score-wait"))
        await bea.wait_for_selector("#m-invite.on", timeout=4000); check("partner gets the invite", "Head-to-head" in await bea.text_content("#iv-p"))
        await bea.click("#iv-yes"); await ann.wait_for_timeout(1200)
        check("both phones are in the match", await ann.is_visible("#h-match") and await bea.is_visible("#h-match"),
              f'{(await state(ann))["g"].get("match")} {(await state(bea))["g"].get("match")} {await ann.evaluate("document.querySelector(\'.screen.on\').id")}')
        await ann.click("#to-settings"); dis = await ann.evaluate("[...document.querySelectorAll('#s-set [data-field=deck] button')].filter(b=>b.disabled).length")
        check("deck is locked during a match", dis == len(DECKS)); await ann.click("#s-set [data-back]")
        check("Final round is hidden during a match", await ann.is_hidden("#final-btn"))
        async def rnd(pg, other, acts=None):
            await play(pg, acts); txt = await pg.text_content("#sum-pts-t"); await pg.click("#sum-done"); await other.wait_for_timeout(900); return txt
        t = await rnd(ann, bea); check("perfect round is 10 + 1 bonus", t == "This round: +11 points", t)
        sp = await bea.text_content("#sp-line"); check("guesser sees the points after the round", "+11" in sp, sp); await dismiss(bea)
        await rnd(bea, ann); await dismiss(ann)
        await rnd(ann, bea); await dismiss(bea)
        hm = await bea.text_content("#h-match"); check("first to 20 waits for the matching round", "22" in hm and await bea.is_visible("#h-match"), hm)
        await play(bea); await bea.click("#adj-up"); check("clue-giver can adjust by 1", "(adjusted)" in await bea.text_content("#sum-pts-t") and await bea.is_disabled("#adj-up"))
        await ann.wait_for_timeout(900); check("adjustment syncs", "23" in await ann.text_content("#h-match") if await ann.is_visible("#h-match") else False, await ann.text_content("#h-match"))
        await bea.click("#adj-down"); await bea.click("#sum-done"); await ann.wait_for_timeout(900); await dismiss(ann)
        check("tie at 22 plays one more round each", "tiebreak" in await ann.text_content("#h-match") and "22" in await ann.text_content("#h-match"), await ann.text_content("#h-match"))
        await rnd(ann, bea, {0: "#b-buzz"}); await dismiss(bea)
        hm = await bea.text_content("#h-match"); check("a buzz gives the guesser a steal", "30" in hm and "23" in hm, hm)
        await play(bea); await bea.click("#sum-done"); await ann.wait_for_timeout(900); await dismiss(ann); await ann.wait_for_timeout(300)
        check("match ends with the winner on both phones", await ann.text_content("#mr-h") == "Bea wins!" and await bea.text_content("#mr-h") == "Bea wins!",
              f"{await ann.text_content('#mr-h')} / {await bea.text_content('#mr-h')}")
        check("final score 30 to 34", "30" in await ann.text_content("#mr-tot") and "34" in await ann.text_content("#mr-tot"))
        await ann.click("#mr-brag"); bt = await ann.text_content("#br-body")
        check("Bragging Rights: record, streak, perfect rounds", "0 – 1" in bt and "Perfect rounds" in bt and "Lost 30–34" in bt, bt[:200])
        await ann.click("#s-brag [data-back]"); await bea.click("#mr-done")
        check("each phone stores the match once", len((await state(ann))["s"]["hist"]) == 1 and len((await state(bea))["s"]["hist"]) == 1)
        # history heals: one phone loses its record
        await ann.evaluate("(()=>{const s=JSON.parse(localStorage.getItem('mt:v3'));s.hist=[];localStorage.setItem('mt:v3',JSON.stringify(s))})()"); await ann.reload()
        await ann.wait_for_timeout(4000); h = (await state(ann))["s"]["hist"]
        check("a lost match record comes back from the partner's phone", len(h) == 1 and h[0]["r"] == "l" and h[0]["me"] == "Ann", str(h)[:200])
        # decline
        await dismiss(ann); await ann.click("#h-score"); await ann.click("#score-go"); await bea.wait_for_selector("#m-invite.on", timeout=4000); await bea.click("#iv-no"); await ann.wait_for_timeout(1200)
        check("Not now cancels the invite", "not now" in await ann.text_content("#toast") and (await state(ann))["g"].get("match") is None)
        # team, first to 20 cards
        await ann.click("#h-score"); await ann.click("#score-go"); await bea.wait_for_selector("#m-invite.on", timeout=4000); await bea.click("#iv-yes"); await ann.wait_for_timeout(1000)
        t = await rnd(ann, bea); check("team round counts cards", t == "Team cards: 10", t); await dismiss(bea)
        await play(bea, {0: "#b-skip"}); await bea.click("#sum-done"); await ann.wait_for_timeout(900); await dismiss(ann)
        check("team match goes on below 20 cards (a skip costs 1)", await ann.is_visible("#h-match") and "18 of 20" in await ann.text_content("#h-match"), await ann.text_content("#h-match"))
        await rnd(ann, bea); await dismiss(bea); await bea.wait_for_timeout(300)
        check("team match ends at 20 cards with a speed", await bea.text_content("#mr-h") == "Nice teamwork!" and "seconds a card" in await bea.text_content("#mr-tot"))
        await bea.click("#mr-brag"); check("Bragging Rights shows team speed", "Best speed" in await bea.text_content("#br-body")); await bea.click("#s-brag [data-back]")
        await ann.wait_for_timeout(300); await ann.click("#mr-done")
        # end early: don't count the last round
        await ann.click("#h-score"); await ann.click('#s-score [data-field=type] button:has-text("Head-to-head")'); await ann.click("#score-go")
        await bea.wait_for_selector("#m-invite.on", timeout=4000); await bea.click("#iv-yes"); await ann.wait_for_timeout(1000)
        await rnd(ann, bea); await dismiss(bea); await ann.click("#h-mend")
        check("ending with uneven rounds offers both choices", await ann.is_visible("#me-more") and await ann.is_visible("#me-drop") and await ann.is_hidden("#me-now"))
        await ann.click("#me-drop"); await ann.wait_for_timeout(300); await bea.wait_for_timeout(900)
        check("don't count the last round: 0–0 tie on both phones", await ann.text_content("#mr-h") == "It's a tie!" and await bea.text_content("#mr-h") == "It's a tie!")
        await ann.click("#mr-done"); await bea.click("#mr-done")
        # merge with an old record after a name change
        await ann.click("#to-settings"); await ann.fill("#set-playas", "Annie"); await ann.press("#set-playas", "Enter"); await ann.click("#s-set [data-back]")
        await ann.click("#to-brag"); check("a new name starts a new record", "No matches yet" in await ann.text_content("#br-body") and await ann.is_visible("#br-merge"))
        await ann.click("#br-merge"); await ann.click("#mg-list [data-merge]"); check("merge brings the old record in", "Head-to-head" in await ann.text_content("#br-body"))
        await ann.click("[data-unmerge]"); check("merge can be undone", "No matches yet" in await ann.text_content("#br-body")); await ann.click("#s-brag [data-back]")
        check("match messages stay under 3.5 KB", max(len(x) for x in posts) < 3500, max(len(x) for x in posts))
        for nm, vp in [("tiny", {"width": 320, "height": 568}), ("iphone", {"width": 390, "height": 844})]:
            await ann.set_viewport_size(vp)
            for scr, go in [("home", None), ("score", "#h-score"), ("brag", "#to-brag")]:
                if go: await ann.click(go); await ann.wait_for_timeout(150)
                await ann.screenshot(path=os.path.join(ROOT, f"shots/v6-{nm}-{scr}.png"), full_page=True)
                check(f"{nm} {scr}: no sideways scroll", await ann.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
                if go == "#h-score": await ann.click("#score-back")
                if go == "#to-brag": await ann.click("#s-brag [data-back]")
        allerr += ann.errs + bea.errs; await ca.close(); await cb.close()
        # ---------- layout ----------
        for name, vp in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("small", {"width": 360, "height": 640})]:
            ctx, pg = await phone(b, vp=vp); await pg.screenshot(path=os.path.join(ROOT, f"shots/v6-{name}-setup.png"))
            await setup(pg, "Megan", f"lay-{name}")
            for scr in ("home", "settings"):
                if scr == "settings": await dismiss(pg); await pg.click("#to-settings")
                await pg.screenshot(path=os.path.join(ROOT, f"shots/v6-{name}-{scr}.png"), full_page=True)
                check(f"{name} {scr}: no sideways scroll", await pg.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
            allerr += pg.errs; await ctx.close()
        check("no script errors", not allerr, str(allerr)); await b.close()
    print(f"\n{sum(results)}/{len(results)} passed"); return 0 if all(results) else 1

srv = ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.exit(asyncio.run(main("--slow" in sys.argv)))
