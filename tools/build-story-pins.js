// Adds map pins to story-chapter steps, checked step by step against the Fandom wiki.
//
// Usage:  node tools/build-story-pins.js           (rewrites data/catalog.js)
//         node tools/build-story-pins.js --check   (resolves everything, changes nothing)
//
// data/story-locations.json lists, per chapter and step ("12" = 13th objective), either
//   { "pins": [ref, ...] }      one or more places; several pins = selectable options
//   { "placement": "off-map" }  not done in a raid (hand-ins, skills, waiting)
//   { "placement": "mapwide" }  can be done anywhere on the map (kills, etc.)
// A ref points at a place whose coordinates come from game data:
//   lock     a locked door, by key name (n = which door, if the key opens several)
//   zone     a regular quest's objective zone at the same spot (quest name + objective text)
//   extract / transit / switch   by in-game name
//   spot     a coordinate read off the wiki's own marked map (calibrated against known
//            extract/door coordinates), optionally with a zone outline
//   area     a coordinate next to a named landmark; shown as approximate
// Any ref that can't be resolved stops the script, so a typo never becomes a wrong pin.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CATALOG = path.join(__dirname, "../data/catalog.js");
const STORY = path.join(__dirname, "../data/story-locations.json");
const PLACES = path.join(__dirname, "../data/map-places.json");

function loadCatalog() {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(CATALOG, "utf8"), box);
  return box.window.TARKOV_CATALOG;
}

const xyz = (x, y, z) => ({ x, y, z });

function resolver(data, places) {
  const mapOf = (m) => {
    const found = places.find((p) => p.map === m);
    if (!found) throw new Error("Unknown map " + m);
    return found;
  };
  const byName = (list, name, what, m) => {
    const hit = list.find((e) => e[0] === name);
    if (!hit) throw new Error(`No ${what} "${name}" on ${m}`);
    return hit;
  };
  return function resolve(ref) {
    const base = { label: ref.label };
    if (ref.anchor) base.anchor = ref.anchor;
    switch (ref.src) {
      case "lock": {
        const locks = mapOf(ref.map).locks.filter((l) => l[0] === ref.name);
        const l = locks[ref.n || 0];
        if (!l) throw new Error(`No lock #${ref.n || 0} for "${ref.name}" on ${ref.map}`);
        const area = ref.kind === "area";
        return [
          {
            map: ref.map,
            world: xyz(l[3], l[4], l[5]),
            kind: area ? "area" : "door",
            ...base,
            source: area
              ? `Approximate: next to the ${ref.name} door (tarkov.dev), placed from the Fandom wiki guide`
              : `${ref.name} door coordinates via tarkov.dev, matched to the Fandom wiki guide`,
          },
        ];
      }
      case "zone": {
        const q = data.quests.find((x) => x.name === ref.quest);
        if (!q) throw new Error(`No quest "${ref.quest}"`);
        const o = q.objectives.find((x) => x.description.includes(ref.desc));
        if (!o || !o.locations.length) throw new Error(`No located objective "${ref.desc}" in ${ref.quest}`);
        return o.locations.map((loc) => ({
          ...loc,
          kind: "zone",
          ...base,
          source: `Same spot as "${ref.quest}" (game objective zone via tarkov.dev), matched to the Fandom wiki guide`,
        }));
      }
      case "extract":
      case "transit":
      case "switch": {
        const list = mapOf(ref.map)[ref.src === "switch" ? "switches" : ref.src + "s"];
        const e = byName(list, ref.name, ref.src, ref.map);
        const c = ref.src === "extract" ? e.slice(2) : e.slice(1);
        return [
          {
            map: ref.map,
            world: xyz(...c),
            kind: ref.src,
            ...base,
            source: `${ref.name} ${ref.src} coordinates via tarkov.dev, matched to the Fandom wiki guide`,
          },
        ];
      }
      case "spot": {
        mapOf(ref.map);
        const loc = {
          map: ref.map,
          world: xyz(...ref.xyz),
          kind: "spot",
          ...base,
          source: `${ref.how}, converted to game coordinates and checked against the map`,
        };
        if (ref.outline) loc.outline = ref.outline.map(([x, z]) => xyz(x, ref.xyz[1], z));
        return [loc];
      }
      case "area":
        mapOf(ref.map);
        return [
          {
            map: ref.map,
            world: xyz(...ref.xyz),
            kind: "area",
            ...base,
            source: "Approximate: placed from the Fandom wiki guide next to a known landmark",
          },
        ];
      default:
        throw new Error("Unknown ref type " + ref.src);
    }
  };
}

function build(data, story, places) {
  const resolve = resolver(data, places);
  const summary = {};
  for (const [chapter, steps] of Object.entries(story)) {
    const q = data.quests.find((x) => x.name === chapter && x.kind === "story");
    if (!q) throw new Error("No story chapter " + chapter);
    const s = (summary[chapter] = { exact: 0, area: 0, offMap: 0, mapwide: 0 });
    for (const [idx, spec] of Object.entries(steps)) {
      const o = q.objectives[Number(idx)];
      if (!o) throw new Error(`${chapter} has no objective ${idx}`);
      if (spec.placement) {
        o.locations = [];
        o.placement = spec.placement;
        o.maps = spec.placement === "mapwide" ? o.maps : [];
        s[spec.placement === "off-map" ? "offMap" : "mapwide"]++;
        continue;
      }
      o.locations = spec.pins.flatMap(resolve);
      o.placement = "fixed";
      o.maps = [...new Set(o.locations.map((l) => l.map))];
      if (o.locations.every((l) => l.kind === "area")) s.area++;
      else s.exact++;
    }
    q.maps = [...new Set(q.objectives.flatMap((o) => o.maps))];
  }
  // Recount catalog stats.
  const all = data.quests.flatMap((q) => q.objectives);
  data.stats.objectives = all.length;
  data.stats.pinnedObjectives = all.filter((o) => o.locations.some((l) => l.world)).length;
  data.stats.coordinatePoints = all.reduce((n, o) => n + o.locations.filter((l) => l.world).length, 0);
  data.stats.unverified = all.filter((o) => o.placement === "unverified").length;
  return summary;
}

if (require.main === module) {
  const data = loadCatalog();
  const summary = build(
    data,
    JSON.parse(fs.readFileSync(STORY, "utf8")),
    JSON.parse(fs.readFileSync(PLACES, "utf8")),
  );
  console.table(summary);
  console.log(JSON.stringify(data.stats));
  if (!process.argv.includes("--check"))
    fs.writeFileSync(CATALOG, "window.TARKOV_CATALOG = " + JSON.stringify(data, null, 0) + ";\n");
}
module.exports = { build };
