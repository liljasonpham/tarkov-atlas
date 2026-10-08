// Links each Fandom photo to the objective(s) it shows, so clicking an objective
// can show "this exact spot" instead of a whole quest gallery.
//
// Usage:  node tools/link-photos.js            (rewrites data/catalog.js)
//         node tools/link-photos.js --report   (prints matches to review, changes nothing)
//
// How it works:
//   1. Every photo gets words from its caption and file name ("Bank_case_location.png" -> bank, case).
//   2. Every objective that happens at a place (has a pin, or is waiting for one) gets words
//      from its description.
//   3. A photo goes to the objective(s) it shares the most meaningful words with.
//      Room/building numbers ("203", "0031") count extra.
//   4. If a quest has only one place-based objective, all its photos go there.
//   5. data/photo-overrides.json fixes matches a person has checked by hand. It always wins.
// Photos that match nothing stay in the quest's general gallery.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CATALOG = path.join(__dirname, "../data/catalog.js");
const OVERRIDES = path.join(__dirname, "../data/photo-overrides.json");

function loadCatalog() {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(CATALOG, "utf8"), box);
  return box.window.TARKOV_CATALOG;
}

// Words that appear everywhere and say nothing about *where* something is.
const STOP = new Set(
  (
    "a an the and or of on in at to for from with by into onto near next behind under over inside " +
    "outside this that its it is are be one any all your you locate obtain find found get gain access " +
    "hand handover item items quest marked map location locations spot place placed placement the png " +
    "jpg jpeg webp gif image picture photo screenshot view seen looking where needs need has have can " +
    "must should which part survive extract mark marker install stash plant leave hide hidden " +
    "customs factory woods shoreline interchange reserve lighthouse streets tarkov ground zero lab labs " +
    "laboratory labyrinth icebreaker terminal"
  ).split(" "),
);
const mapWords = /\b(map|marked)\b|map\.|_map|map_/i;
// Words that name a map, and the map they mean.
const MAP_NAMES = {
  customs: "customs",
  factory: "factory",
  woods: "woods",
  shoreline: "shoreline",
  shorline: "shoreline",
  interchange: "interchange",
  reserve: "reserve",
  lighthouse: "lighthouse",
  streets: "streets-of-tarkov",
  zero: "ground-zero",
  labyrinth: "the-labyrinth",
  icebreaker: "icebreaker",
  terminal: "terminal",
};
const mapsIn = (text) =>
  new Set(
    words(text)
      .map((w) => MAP_NAMES[w])
      .filter(Boolean),
  );

function words(text) {
  return (text || "")
    .replace(/\.(png|jpe?g|webp|gif)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.()/,:"'’]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}
function meaningful(text, questWords) {
  return new Set(words(text).filter((w) => !STOP.has(w) && !questWords.has(w) && w.length > 2));
}

// Objectives that happen at a specific place in a raid.
const PLACE_TYPES = new Set([
  "visit",
  "findQuestItem",
  "plantItem",
  "plantQuestItem",
  "mark",
  "useItem",
  "shoot",
  "wiki",
]);
const isPlace = (o) =>
  o.locations.length > 0 || o.placement === "unverified" || PLACE_TYPES.has(o.type);

function link(data, overrides = {}) {
  const report = [];
  for (const q of data.quests) {
    const photos = q.photos || [];
    const lists = [q.objectives, q.regularObjectives || []];
    for (const list of lists) for (const o of list) delete o.photoRefs;
    if (!photos.length) continue;
    const questWords = new Set(words(q.name));
    const spots = q.objectives.filter(isPlace);
    const assigned = new Map(spots.map((o) => [o.id, []]));
    const leftovers = [];
    const over = overrides[q.id];
    // Story chapters have huge galleries covering dozens of steps; only hand-checked links apply.
    const manualOnly = q.kind === "story";

    photos.forEach((p, i) => {
      p.kind = mapWords.test(p.caption + " " + p.file) ? "map" : "spot";
      if (over && over[p.file]) {
        // Overrides name objectives by position ("O2" = third objective) or by ID; [] = quest-wide.
        for (const ref of over[p.file]) {
          const id = /^O\d+$/.test(ref) ? q.objectives[Number(ref.slice(1))]?.id : ref;
          if (!assigned.has(id)) {
            const o = q.objectives.find((x) => x.id === id);
            if (o) (spots.push(o), assigned.set(id, []));
          }
          assigned.get(id)?.push(i);
        }
        if (!over[p.file].length) leftovers.push(i);
        return;
      }
      if (manualOnly || !spots.length) return leftovers.push(i);
      if (spots.length === 1) return assigned.get(spots[0].id).push(i);
      const pw = meaningful(p.caption + " " + p.file, questWords),
        pm = mapsIn(p.caption + " " + p.file);
      // A photo that names a map can only belong to objectives on that map.
      let candidates = pm.size ? spots.filter((o) => o.maps.some((m) => pm.has(m))) : spots;
      if (!candidates.length) candidates = spots;
      if (pm.size && candidates.length === 1) return assigned.get(candidates[0].id).push(i);
      let best = 0,
        winners = [];
      for (const o of candidates) {
        const ow = meaningful(o.description, questWords);
        let score = 0;
        for (const w of pw) if (ow.has(w)) score += /^\d+$/.test(w) ? 3 : 1;
        if (score > best) ((best = score), (winners = [o]));
        else if (score === best && score > 0) winners.push(o);
      }
      if (!best) return leftovers.push(i);
      for (const o of winners) assigned.get(o.id).push(i);
    });

    // Wiki galleries follow objective order: an unmatched photo sitting between photos of the
    // same objective (or right after them) almost always shows that objective too.
    const owners = (i) => spots.filter((o) => assigned.get(o.id).includes(i));
    let changed = !manualOnly;
    while (changed) {
      changed = false;
      for (const i of [...leftovers]) {
        if (over && over[photos[i].file]) continue;
        const before = i > 0 ? owners(i - 1) : [],
          after = i < photos.length - 1 ? owners(i + 1) : [];
        const pick = before.length ? before : after;
        if (!pick.length) continue;
        for (const o of pick) assigned.get(o.id).push(i);
        leftovers.splice(leftovers.indexOf(i), 1);
        changed = true;
      }
    }
    // Location-wide photos: in a quest on a single map, the marked map belongs to every objective.
    const questMaps = new Set(spots.flatMap((o) => o.maps));
    if (questMaps.size === 1 && !manualOnly)
      photos.forEach((p, i) => {
        if (p.kind !== "map" || (over && over[p.file])) return;
        for (const o of spots) if (!assigned.get(o.id).includes(i)) assigned.get(o.id).push(i);
        if (leftovers.includes(i)) leftovers.splice(leftovers.indexOf(i), 1);
      });
    // Nothing matched at all: the gallery shows the quest's one location, so share it.
    if (!manualOnly && spots.length && questMaps.size === 1 && leftovers.length === photos.length) {
      for (const o of spots) assigned.get(o.id).push(...leftovers);
      leftovers.length = 0;
    }
    for (const o of spots) {
      const refs = [...new Set(assigned.get(o.id))].sort((a, b) => a - b);
      if (refs.length) o.photoRefs = refs;
    }
    // Keep PvP objective variants in step when they share an ID.
    for (const o of q.regularObjectives || []) {
      const twin = q.objectives.find((x) => x.id === o.id);
      if (twin?.photoRefs) o.photoRefs = twin.photoRefs;
    }
    q.extraPhotoRefs = leftovers;
    report.push({ q, spots, assigned, leftovers });
  }
  return report;
}

let reviewed = new Set();
function printReport(report, details = true) {
  let linked = 0,
    total = 0,
    spotsWithPhotos = 0,
    spotsTotal = 0;
  for (const { q, spots, assigned, leftovers } of report) {
    total += q.photos.length;
    linked += q.photos.length - leftovers.length;
    spotsTotal += spots.length;
    spotsWithPhotos += spots.filter((o) => assigned.get(o.id).length).length;
    if (!details || (spots.length < 2 && !leftovers.length)) continue;
    if (process.argv.includes("--todo") && reviewed.has(q.id)) continue;
    console.log("\n## " + q.name + "  [" + q.id + "]");
    for (const o of spots)
      console.log(
        "  O" +
          q.objectives.indexOf(o) +
          " " +
          o.type +
          " | " +
          o.description +
          " | maps:" +
          o.maps.join(",") +
          "  <-  " +
          (assigned
            .get(o.id)
            .map((i) => "P" + i)
            .join(" ") || "(none)"),
      );
    q.photos.forEach((p, i) =>
      console.log(
        "    P" +
          i +
          " " +
          p.file +
          " | " +
          p.caption +
          (leftovers.includes(i) ? "   ** UNMATCHED" : ""),
      ),
    );
  }
  console.log(
    `\nPhotos linked to an objective: ${linked}/${total}. ` +
      `Place-based objectives with at least one photo: ${spotsWithPhotos}/${spotsTotal}.`,
  );
}

if (require.main === module) {
  const data = loadCatalog();
  const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, "utf8")) : {};
  reviewed = new Set(Object.keys(overrides));
  const report = link(data, overrides);
  if (process.argv.includes("--report")) printReport(report);
  else {
    fs.writeFileSync(CATALOG, "window.TARKOV_CATALOG = " + JSON.stringify(data, null, 0) + ";\n");
    printReport(report, false);
  }
}
module.exports = { link, words, meaningful };
