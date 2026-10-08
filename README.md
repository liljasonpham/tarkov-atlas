# Tarkov Atlas

A raid planner for Escape from Tarkov. Pick the quests you want to work on, and the map shows exactly where each objective is, while a packing list builds itself from what those objectives need.

Most Tarkov trackers show you *everything* you've unlocked. Tarkov Atlas is built around one question instead: **"I'm loading into this map with these quests — where do I go, and what do I bring?"**

## Features

- **Quest library** — 607 quests and story chapters, searchable by name, item or objective, and filterable by trader, map and progress.
- **Interactive map** — pan/zoom canvas map with a pin for every objective that has a fixed location, plus floor selection for multi-level buildings. Mapwide objectives (e.g. "kill 15 Scavs on Customs") deliberately get no pin.
- **Automatic packing list** — keys, quest items and gear for the selected quests on the current map. Shared keys are counted once; consumables are added up.
- **Objective tracking** — tick objectives off, enter partial counts, or skip an objective for this raid. Pins and the packing list update instantly.
- **Profiles** — separate runs for each character, prestige or playthrough, with export/import backups. Progress is saved in your browser.
- **Spot photos on every objective** — click a pin or objective and its Fandom wiki photos open right there: the exact spot first, then the marked map. Click a photo for full size.

## Running it

It's a static site — no build step and no server code.

- **Quickest:** open `index.html` in a browser.
- **Local server (recommended):** `npx serve .` then open the address it prints.
- **Tests:** `node --test` (requires [Node.js](https://nodejs.org/) 18+).

## Project structure

```
index.html            Page layout
css/atlas.css         Styles
js/atlas-core.js      Pure logic: packing lists, map projection, markers, profile validation (unit-tested)
js/atlas-app.js       UI: library, map canvas, details panel, profiles
data/catalog.js       Quest, objective and map data (generated snapshot)
assets/maps/          Map floor images
tests/                Unit tests (node --test)
tools/                Data scripts (photo linking)
licenses/             Third-party licenses
```

## How it works

- **Data:** quests, objectives and in-game objective coordinates come from [tarkov.dev](https://tarkov.dev/)'s public data; story chapters come from the [TarkovTracker data overlay](https://github.com/tarkovtracker-org/tarkov-data-overlay). These are combined into one catalog file.
- **Map pins:** each objective location is stored as an in-game world coordinate (x, y, z). `project()` in `atlas-core.js` rotates and scales that coordinate onto the map image, and the y (height) value decides which floor a pin belongs to.
- **Photos:** `tools/link-photos.js` links each wiki photo to the objective it shows, using caption/file-name words, map names and gallery order. Every quest with more than one location was then checked by hand; those corrections live in `data/photo-overrides.json` and always win.
- **Packing:** `packing()` walks every unfinished objective for the selected quests on the current map and merges what they need: keys by identity (so one key covers several quests), consumables by sum.

## Known limitations

- **271 objectives have no verified location yet** (mostly story steps). They are listed in the app as "awaiting verification" rather than given a guessed pin.
- The catalog is a **snapshot from October 2026**, not a live feed, so it goes out of date after game patches.
- Packing only knows what the objective data says; normal combat supplies aren't inferred.
- Reference photos are loaded from the Fandom wiki, so they need an internet connection.

## Roadmap

- [ ] Script that rebuilds `data/catalog.js` from tarkov.dev automatically
- [ ] Host publicly (GitHub Pages / Cloudflare Pages)
- [ ] Verify the remaining 271 objective locations
- [ ] Original map artwork
- [ ] Let players report wrong pins

## Credits and licenses

- Map images: derived from [the-hideout/tarkov-dev](https://github.com/the-hideout/tarkov-dev) map sources by their listed authors — **CC BY-NC-SA 4.0** (`licenses/maps-CC-BY-NC-SA-4.0.md`). Non-commercial use only; changes to them must keep the same license.
- Story data: TarkovTracker.org — **MIT** (`licenses/tarkovtracker-data-MIT.txt`).
- Quest data and coordinates: [tarkov.dev](https://tarkov.dev/).
- Quest guides and photos: [Escape from Tarkov Wiki on Fandom](https://escapefromtarkov.fandom.com/) (linked, not copied).
- Escape from Tarkov is a trademark of Battlestate Games. This is an unofficial fan project and is not affiliated with Battlestate Games.

The project's own code (everything outside `assets/`, `data/` and `licenses/`) is released under the MIT License — see `LICENSE`.

Built with AI coding assistants (ChatGPT/Codex, Claude).
