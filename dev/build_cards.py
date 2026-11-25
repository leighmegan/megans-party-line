"""Megan's Taboo card builder.

Source   cards/decks.json   [{id, name, file}]  - the deck list; add a deck here and the app picks it up
         cards/<file>       family blocks:
                              == category type
                              Word | f1, f2, f3, f4, f5 [| other deck name]
Registry ids.json           {normalized word: {id, side}} - permanent; ids never reused, sides never change
Output   cards.json         {v, decks:[{id,name,count}], cards:[[id, deck, side, family, word, [forbidden]]]}

Every run checks the WHOLE collection (so new batches are cross-checked against everything):
  errors   duplicate main words (plural/punctuation-insensitive), not exactly 5 forbidden, repeated forbidden,
           giveaway forbidden words, a family member forbidden on a card owned by the other player
  warnings shared roots between main words, family forbidden overlap > 2, one-sided families
  report   crossover counts (--crossover lists them), side balance per deck
Flags: --write (write ids.json + cards.json), --crossover, --quiet
"""
import json, os, re, sys, unicodedata
from collections import defaultdict

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s.lower())).strip()

def sing(t):
    if len(t) > 4 and t.endswith("ies"): return t[:-3] + "y"
    if len(t) > 4 and re.search(r"(ss|sh|ch|x|z)es$", t): return t[:-2]
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"): return t[:-1]
    return t

def key(s): return " ".join(sing(t) for t in norm(s).split())

decks = json.load(open("cards/decks.json"))
deck_by_name = {d["name"].lower(): d["id"] for d in decks}
errors, warnings = [], []
cards, order, fams = {}, [], []

for d in decks:
    fam = None
    for n, raw in enumerate(open(os.path.join("cards", d["file"]), encoding="utf-8"), 1):
        line = raw.strip(); src = f"{d['file']}:{n}"
        if not line or line.startswith("#"): continue
        if line.startswith("=="):
            cat, _, typ = line[2:].strip().partition(" ")
            fam = {"cat": cat, "type": typ.strip(), "members": [], "deck": d["id"]}; fams.append(fam); continue
        if fam is None: errors.append(f"CARD BEFORE FAMILY HEADER {src}"); continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) not in (2, 3): errors.append(f"BAD LINE {src}: {line}"); continue
        deck = d["id"]
        if len(parts) == 3:
            if parts[2].lower() not in deck_by_name: errors.append(f"UNKNOWN DECK '{parts[2]}' {src}"); continue
            deck = deck_by_name[parts[2].lower()]
        k = key(parts[0])
        if k in cards: errors.append(f"DUPLICATE '{parts[0]}' {src} already '{cards[k]['w']}' {cards[k]['src']}"); continue
        cards[k] = {"w": parts[0], "t": [t.strip() for t in parts[1].split(",") if t.strip()], "deck": deck, "src": src, "k": k, "fam": fam}
        order.append(k); fam["members"].append(k)

for k in order:
    c = cards[k]
    if len(c["t"]) != 5: errors.append(f"COUNT {len(c['t'])} '{c['w']}' {c['src']}")
    if len({key(t) for t in c["t"]}) != len(c["t"]): errors.append(f"REPEATED FORBIDDEN '{c['w']}' {c['src']}")
    wt = [sing(t) for t in norm(c["w"]).split() if len(t) > 2]; wj = norm(c["w"]).replace(" ", "")
    for t in c["t"]:
        if any((len(sing(x)) >= 4 and (sing(x) in wj or any(w in sing(x) for w in wt if len(w) >= 4))) or sing(x) in wt for x in norm(t).split()):
            errors.append(f"GIVEAWAY '{c['w']}' -> '{t}' {c['src']}")

roots = defaultdict(list)
for k in order:
    tk = norm(cards[k]["w"]).split()
    if len(tk) == 1 and len(tk[0]) >= 6: roots[tk[0][:6]].append(cards[k]["w"])
warnings += [f"SHARED ROOT {ws}" for ws in roots.values() if len(ws) > 1]

def mentions(a, b):
    ot = {t for t in b["k"].split() if len(t) >= 4}
    return any(key(t) == b["k"] or key(t) in ot for t in a["t"])

reg = json.load(open("ids.json")) if os.path.exists("ids.json") else {}
nid = max([v["id"] for v in reg.values()], default=0) + 1
for k in order:
    if k not in reg: reg[k] = {"id": nid, "side": None}; nid += 1

count = defaultdict(lambda: [0, 0])
for k in order:
    if reg[k]["side"] is not None: count[cards[k]["deck"]][reg[k]["side"]] += 1

for fam in fams:
    ms = fam["members"]
    if len(ms) < 2: warnings.append(f"NO TWIN {[cards[m]['w'] for m in ms]}")
    lp = {m: m for m in ms}
    def lf(m):
        while lp[m] != m: m = lp[m]
        return m
    for a in ms:
        for b in ms:
            if a != b and mentions(cards[a], cards[b]): lp[lf(a)] = lf(b)
    groups = defaultdict(list)
    for m in ms: groups[lf(m)].append(m)
    fs = [0, 0]
    for m in ms:
        if reg[m]["side"] is not None: fs[reg[m]["side"]] += 1
    for g in sorted(groups.values(), key=lambda g: (-len(g), min(reg[m]["id"] for m in g))):
        fixed = {reg[m]["side"] for m in g if reg[m]["side"] is not None}
        if len(fixed) > 1: errors.append(f"LEAK: linked cards owned by different players {[cards[m]['w'] for m in g]}"); continue
        gs = count[cards[g[0]]["deck"]]
        s = fixed.pop() if fixed else (0 if (fs[0], gs[0]) <= (fs[1], gs[1]) else 1)
        for m in g:
            if reg[m]["side"] is None: reg[m]["side"] = s; count[cards[m]["deck"]][s] += 1; fs[s] += 1
    if len(ms) > 1 and min(fs) == 0: warnings.append(f"ONE-SIDED FAMILY {[cards[m]['w'] for m in ms]}")
    for i, a in enumerate(ms):
        for b in ms[i + 1:]:
            ov = {key(t) for t in cards[a]["t"]} & {key(t) for t in cards[b]["t"]}
            if len(ov) > 2: warnings.append(f"OVERLAP {len(ov)} '{cards[a]['w']}' / '{cards[b]['w']}'")

side_mains = defaultdict(set)
for k in order: side_mains[reg[k]["side"]].add(k)
cross = [f"'{t}' on {cards[k]['w']}" for k in order for t in cards[k]["t"]
         if key(t) in side_mains[1 - reg[k]["side"]] and cards[key(t)]["fam"] is not cards[k]["fam"]]

if "--quiet" not in sys.argv:
    print(f"cards {len(order)}  families {len(fams)}  crossover {len(cross)}")
    for d in decks: print(f"  {d['name']}: player 1 {count[d['id']][0]}, player 2 {count[d['id']][1]}")
    if "--crossover" in sys.argv: print("\n".join("   " + x for x in cross))
    for w in warnings: print("WARN", w)
for e in errors: print("ERROR", e)
if errors: print(f"{len(errors)} errors: nothing written"); sys.exit(1)

if "--write" in sys.argv:
    json.dump(reg, open("ids.json", "w"), indent=0)
    out = []
    for fam in fams:
        fid = min(reg[m]["id"] for m in fam["members"])
        out += [[reg[m]["id"], cards[m]["deck"], reg[m]["side"], fid, cards[m]["w"], cards[m]["t"]] for m in fam["members"]]
    out.sort()
    meta = [{"id": d["id"], "name": d["name"], "count": sum(1 for c in out if c[1] == d["id"]),
             "mixed": d.get("mixed", True), **({"suggestTime": d["suggestTime"]} if d.get("suggestTime") else {})} for d in decks]
    json.dump({"v": 3, "decks": meta, "cards": out}, open("cards.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote cards.json ({len(out)} cards)")
