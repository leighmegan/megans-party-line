# Megan's Taboo

A two-player Taboo game for playing over the phone. Live site: https://leighmegan.github.io/megans-taboo/

- The site files are in the top folder (index.html, app.js, styles.css, cards.json, sw.js).
- `dev/` holds the sources: `src/` (page, styles, app code), `cards/` (decks as family blocks plus `decks.json`),
  `ids.json` (permanent card IDs and player sides, never edit by hand), `build_cards.py` (checks every card),
  `build.py` (builds the site), and `tests/` (browser tests).
- Partner sync uses the free ntfy.sh relay. Phones with the same code word share names, round length, and pick Player 1 and Player 2 on first contact.
- A word can appear in more than one deck: every copy belongs to the same player, Mixed shows it once, and playing it marks every copy played.
- Build: `cd dev && python3 build.py --repo ..` then `python3 tests/run.py` (needs Playwright and Chrome).
