// Refreshes the site's quest, boss and loot data from tarkov.dev, keeping every hand-checked
// fix on top. Run by GitHub Actions every day (.github/workflows/update-data.yml).
//
//   node tools/update-data.js                 download from json.tarkov.dev and update data/
//   node tools/update-data.js --from DIR      use files saved earlier (DIR/pve__tasks.json, ...)
//   node tools/update-data.js --check         do everything except write files
//
// What it refreshes: quest names, traders, levels, unlock order, Kappa/Lightkeeper flags,
// objectives (text, counts, items, keys, gear) and their coordinates, boss spawn chances,
// loot spawn points.
// What it keeps: story chapters, quests that only exist on the wiki, wiki photos and the
// photo links (tools/link-photos.js re-runs), hand-placed pins (anything not from tarkov.dev),
// hand classifications of pinless objectives, and the fixes in tools/data-fixes.json.
// It refuses to write if the new data looks broken (see sanityCheck).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const API = "https://json.tarkov.dev/";
const MODES = ["pve", "regular"];
const FILES = ["tasks", "tasks_en", "maps", "maps_en", "items", "items_en", "traders_en"];
const FIXES = JSON.parse(fs.readFileSync(path.join(__dirname, "data-fixes.json"), "utf8"));
const args = process.argv.slice(2);
const fromDir = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;
const checkOnly = args.includes("--check");

// Sources written on locations this script owns. Anything else was placed by hand and is kept.
const SRC = {
  zone: "Game objective coordinates via tarkov.dev",
  spawn: "Quest-item spawn coordinates via tarkov.dev",
  extract: "Named extraction zone via tarkov.dev",
  transit: "Transit coordinates via tarkov.dev",
};
const OWNED = new Set(Object.values(SRC));

// Objective types that never happen at a place in a raid.
const OFF_MAP = new Set([
  "giveItem",
  "giveQuestItem",
  "traderLevel",
  "traderStanding",
  "buildWeapon",
  "skill",
  "taskStatus",
  "globalVariable",
  "sellItem",
  "dialogue",
]);

// ---------------------------------------------------------------- loading
async function load() {
  const raw = {};
  for (const mode of MODES) {
    raw[mode] = {};
    for (const f of FILES) {
      if (fromDir) {
        raw[mode][f] = JSON.parse(fs.readFileSync(path.join(fromDir, `${mode}__${f}.json`), "utf8"));
      } else {
        const res = await fetch(API + mode + "/" + f, { headers: { "user-agent": "tarkov-atlas-updater" } });
        if (!res.ok) throw Error(`${mode}/${f}: HTTP ${res.status}`);
        raw[mode][f] = await res.json();
      }
    }
  }
  return raw;
}
const dict = (j) => (j && j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data : j);
function loadCatalog() {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(DATA, "catalog.js"), "utf8"), box);
  return box.window.TARKOV_CATALOG;
}

// ---------------------------------------------------------------- context
function context(raw, mode, catalog) {
  const r = raw[mode];
  const tEn = dict(r.tasks_en),
    mEn = dict(r.maps_en),
    iEn = dict(r.items_en),
    trEn = dict(r.traders_en);
  const items = r.items.data.items,
    questItems = r.tasks.data.questItems || {};
  const maps = Object.values(r.maps.data.maps);
  const ourMaps = new Set(catalog.maps.map((m) => m.id));
  // Game map id -> the site's map id (variants fold into their main map).
  const mapId = new Map();
  for (const m of maps) {
    const alias = FIXES.mapAliases[m.normalizedName] || m.normalizedName;
    if (ourMaps.has(alias)) mapId.set(m.id, alias);
  }
  const wikiItemUrl = (name) =>
    "https://escapefromtarkov.fandom.com/wiki/" + encodeURIComponent(name.replace(/ /g, "_")).replace(/%2F/g, "/");
  function item(id) {
    if (items[id])
      return {
        id,
        name: iEn[id + " Name"] || id,
        wiki: items[id].wikiLink || wikiItemUrl(iEn[id + " Name"] || id),
      };
    if (questItems[id]) return { id, name: tEn[id + " Name"] || iEn[id + " Name"] || id, wiki: null };
    return { id, name: iEn[id + " Name"] || tEn[id + " Name"] || id, wiki: null };
  }
  return { r, tEn, mEn, iEn, trEn, maps, mapId, item, items };
}

// ---------------------------------------------------------------- objectives
const round = (n) => Math.round(n * 100) / 100;
const pt = (p) => ({ x: round(p.x), y: round(p.y), z: round(p.z) });

function locationsFor(o, ctx) {
  const out = [];
  for (const z of o.zones || []) {
    const map = ctx.mapId.get(z.map);
    if (!map || !z.position) continue;
    const loc = { map, world: pt(z.position) };
    if (z.outline?.length) loc.outline = z.outline.map(pt);
    loc.zoneId = z.id;
    loc.kind = "zone";
    loc.source = SRC.zone;
    out.push(loc);
  }
  for (const pl of o.possibleLocations || []) {
    const map = ctx.mapId.get(pl.map);
    if (!map) continue;
    for (const p of pl.positions || []) out.push({ map, world: pt(p), kind: "spawn", source: SRC.spawn });
  }
  if (o.type === "extract" && o.exitName) {
    for (const gm of ctx.maps) {
      if (!o.maps.includes(gm.id) || !ctx.mapId.has(gm.id)) continue;
      const map = ctx.mapId.get(gm.id);
      for (const e of gm.extracts || [])
        if (e.name === o.exitName && e.position) {
          const loc = { map, world: pt(e.position) };
          if (e.outline?.length) loc.outline = e.outline.map(pt);
          loc.kind = "zone";
          loc.source = SRC.extract;
          out.push(loc);
        }
      const m = /^[A-Z]+_TRANSIT_(\d+)$/.exec(o.exitName);
      for (const t of m ? gm.transits || [] : [])
        if (String(t.id) === m[1] && t.position) {
          const loc = { map, world: pt(t.position) };
          if (t.outline?.length) loc.outline = t.outline.map(pt);
          loc.kind = "zone";
          loc.source = SRC.transit;
          out.push(loc);
        }
    }
  }
  return out;
}
function exitLabel(o, ctx) {
  if (!o.exitName) return undefined;
  if (ctx.mEn[o.exitName]) return ctx.mEn[o.exitName];
  const m = /^[A-Z]+_TRANSIT_(\d+)$/.exec(o.exitName);
  if (m) {
    for (const gm of ctx.maps)
      for (const t of gm.transits || [])
        if (String(t.id) === m[1] && o.maps.includes(gm.id)) return ctx.mEn[t.description] || o.exitName;
  }
  return o.exitName;
}
function buildObjective(o, ctx) {
  const items = (ids) => (ids || []).map((x) => ctx.item(typeof x === "object" ? x.id : x));
  const maps = [...new Set((o.maps || []).map((m) => ctx.mapId.get(m)).filter(Boolean))];
  const locations = locationsFor(o, ctx);
  const out = {
    id: o.id,
    type: o.type,
    description: ctx.tEn[o.description] || ctx.tEn[o.id] || o.description,
    count: o.count ?? 1,
    optional: Boolean(o.optional),
    maps,
    locations,
    placement: locations.length ? "fixed" : OFF_MAP.has(o.type) || !maps.length && o.type !== "shoot" && o.type !== "findItem" && o.type !== "extract" && o.type !== "experience" ? "off-map" : "mapwide",
    keys: (o.requiredKeys || []).map((alts) => items(alts)),
    bring: [],
    gear: [],
    keep: [],
    foundInRaid: Boolean(o.foundInRaid),
  };
  // A plain "visit" with nothing to locate (Arena wins etc.) is not a raid objective.
  if (o.type === "visit" && !locations.length && !maps.length) out.placement = "off-map";
  if (o.type === "plantItem" && o.items?.length)
    out.bring.push({ items: items(o.items), count: o.count ?? 1, kind: "consumable" });
  if (o.type === "mark" && o.markerItem)
    out.bring.push({ items: items([o.markerItem]), count: 1, kind: "consumable" });
  if (o.type === "useItem" && o.useAny?.length)
    out.bring.push({ items: items(o.useAny), count: o.count ?? 1, kind: "consumable" });
  if (o.type === "plantQuestItem" && o.questItem)
    out.bring.push({ items: items([o.questItem]), count: o.count ?? 1, kind: "quest-item" });
  if ((o.type === "giveItem" || o.type === "findItem") && o.items?.length)
    out.keep.push({ items: items(o.items), count: o.count ?? 1, kind: "consumable" });
  if (o.usingWeapon?.length)
    out.gear.push({ label: "Weapon", choices: items(o.usingWeapon).map((i) => [i]) });
  if (o.usingWeaponMods?.length)
    out.gear.push({ label: "Weapon attachments", choices: o.usingWeaponMods.map((set) => items(set)) });
  if (o.wearing?.length)
    out.gear.push({ label: "Wear one complete option", choices: o.wearing.map((set) => items(set)) });
  if (o.notWearing?.length) out.gear.push({ label: "Do not wear", choices: [items(o.notWearing)] });
  const exitName = exitLabel(o, ctx);
  if (exitName) out.exitName = exitName;
  // "QuestCondition/Elimination/Kill/BodyPart/LeftLeg" -> "left leg"
  if (o.bodyParts?.length)
    out.bodyParts = o.bodyParts.map((b) => {
      const part = String(b).split("/").pop().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      return part === "chest" ? "thorax" : part;
    });
  if (o.distance?.value) out.distance = o.distance;
  if (o.timeFromHour || o.timeUntilHour) out.time = [o.timeFromHour, o.timeUntilHour];
  return out;
}

// ---------------------------------------------------------------- quests
function buildQuest(t, ctx, modes, kappaFlags) {
  const trader = ctx.trEn[t.trader + " Nickname"] || ctx.trEn[t.trader + " Name"] || t.trader;
  const name = ctx.tEn[t.name] || ctx.tEn[t.id + " name"] || t.name;
  const q = {
    id: t.id,
    name,
    kind: "side",
    wiki: t.wikiLink || "https://escapefromtarkov.fandom.com/wiki/" + encodeURIComponent(name.replace(/ /g, "_")),
    trader,
    minLevel: t.minPlayerLevel || 0,
    modes,
    kappa: Boolean(kappaFlags.kappa),
    lightkeeper: Boolean(kappaFlags.lightkeeper),
    faction: t.factionName || "Any",
    requirements: (t.taskRequirements || []).map((r) => ({
      task: typeof r.task === "object" ? r.task.id : r.task,
      status: r.status || ["complete"],
    })),
    objectives: (t.objectives || []).map((o) => buildObjective(o, ctx)),
    source: "tarkov.dev",
    experience: t.experience || 0,
  };
  q.maps = [...new Set(q.objectives.flatMap((o) => o.maps))];
  // Ref's Arena quests ("[PVP ZONE]", "win a match in Arena") are listed separately.
  if (trader === "Ref" && (/\[(PVP|PVE) ZONE\]/.test(name) || q.objectives.some((o) => /\bArena\b/.test(o.description))))
    q.kind = "arena";
  return q;
}

// Carry hand-made work from the old objective onto the rebuilt one.
function mergeObjective(next, prev) {
  if (!prev) return next;
  const handPlaced = prev.locations.some((l) => !OWNED.has(l.source));
  // Some pins were matched by hand to a transit or zone that tarkov.dev doesn't link to the
  // objective; if the new data has no location, keep the old pins rather than losing them.
  if (handPlaced || (!next.locations.length && prev.locations.length)) {
    next.locations = prev.locations;
    next.placement = prev.placement;
    next.maps = prev.maps;
  } else if (!next.locations.length && !prev.locations.length) {
    // Pinless objectives were sorted by hand into mapwide / off-map / unverified.
    next.placement = prev.placement;
  }
  if (prev.photoRefs) next.photoRefs = prev.photoRefs;
  if (!next.bodyParts && prev.bodyParts) next.bodyParts = prev.bodyParts;
  if (prev.failure) next.failure = true; // shown as a failure condition, not a task
  // Extraction names: tarkov.dev's English names are sometimes missing ("V-Ex_light").
  if (prev.exitName && (!next.exitName || /_|^\s/.test(next.exitName))) next.exitName = prev.exitName;
  return next;
}
const KEEP_QUEST_FIELDS = ["photos", "wikiTitle", "photoCoverage", "wikiRequirements", "extraPhotoRefs", "kind"];

function update(catalog, raw) {
  const ctx = { pve: context(raw, "pve", catalog), regular: context(raw, "regular", catalog) };
  const tasks = { pve: raw.pve.tasks.data.tasks, regular: raw.regular.tasks.data.tasks };
  const ids = [...new Set([...Object.keys(tasks.pve), ...Object.keys(tasks.regular)])];
  const prevById = new Map(catalog.quests.map((q) => [q.id, q]));
  const report = { added: [], removed: [], changed: [], kept: 0 };
  const rebuilt = new Map();
  for (const id of ids) {
    if (FIXES.skipQuests.includes(id)) continue;
    const inPve = tasks.pve[id] && !tasks.pve[id]._slim,
      t = inPve ? tasks.pve[id] : tasks.regular[id];
    if (!t || t._slim) continue;
    const modes = MODES.filter((m) => tasks[m][id]);
    const flags = tasks.pve[id] || tasks.regular[id];
    const next = buildQuest(t, inPve ? ctx.pve : ctx.regular, modes, {
      kappa: flags.kappaRequired,
      lightkeeper: flags.lightkeeperRequired,
    });
    const prev = prevById.get(id);
    if (prev?.kind === "story") continue;
    if (prev) {
      const prevObj = new Map(prev.objectives.map((o) => [o.id, o]));
      next.objectives = next.objectives.map((o) => mergeObjective(o, prevObj.get(o.id)));
      next.maps = [...new Set(next.objectives.flatMap((o) => o.maps))];
      for (const k of KEEP_QUEST_FIELDS) if (prev[k] !== undefined) next[k] = prev[k];
      // Hand-written notes on a requirement ("either one unlocks it") survive the refresh.
      for (const r of next.requirements) {
        const old = prev.requirements?.find((x) => x.task === r.task);
        if (old?.notes) r.notes = old.notes;
      }
      if (JSON.stringify(strip(prev)) !== JSON.stringify(strip(next))) report.changed.push(next.name);
    } else {
      next.photos = [];
      next.wikiTitle = next.name;
      next.photoCoverage = "none";
      next.wikiRequirements = [];
      report.added.push(next.name);
    }
    rebuilt.set(id, next);
  }
  // Rebuild the list in the old order; new quests go at the end. Keep story chapters and
  // wiki-only quests as they are. Quests tarkov.dev dropped are removed.
  const quests = [];
  for (const q of catalog.quests) {
    if (rebuilt.has(q.id)) quests.push(rebuilt.get(q.id));
    else if (q.kind === "story" || q.source !== "tarkov.dev") (quests.push(q), report.kept++);
    else report.removed.push(q.name);
  }
  for (const [id, q] of rebuilt) if (!prevById.has(id)) quests.push(q);
  catalog.quests = quests;
  refreshTransits(catalog, ctx.pve);
  return { catalog, report, ctx };
}
// Transits (walk to another map) for the map's Extracts layer. Night Factory and the other
// alias maps share the main map's entry, so take the first raw map with transits.
function refreshTransits(catalog, ctx) {
  for (const m of catalog.maps) {
    const raws = ctx.maps.filter((gm) => ctx.mapId.get(gm.id) === m.id && gm.transits?.length);
    const seen = new Set();
    m.transits = [];
    for (const t of raws[0]?.transits || []) {
      if (!t.position) continue;
      const name = (ctx.mEn[t.description] || "Transit").replace(/\?+$/, "");
      const key = name + Math.round(t.position.x) + Math.round(t.position.z);
      if (seen.has(key)) continue;
      seen.add(key);
      m.transits.push({ id: String(t.id), name, to: ctx.mapId.get(t.map) || null, position: pt(t.position) });
    }
  }
}
const strip = (q) => ({ ...q, photos: 0, extraPhotoRefs: 0, objectives: q.objectives.map((o) => ({ ...o, photoRefs: 0 })) });

// ---------------------------------------------------------------- bosses & loot
function buildBosses(raw, catalog) {
  const out = { updated: today(), names: FIXES.bossNames };
  for (const mode of MODES) {
    const per = {};
    for (const gm of Object.values(raw[mode].maps.data.maps)) {
      const variant = FIXES.bossVariants[gm.normalizedName];
      const id = FIXES.mapAliases[gm.normalizedName] || gm.normalizedName;
      if (!catalog.maps.some((m) => m.id === id)) continue;
      per[id] = per[id] || [];
      const groups = new Map();
      for (const b of gm.bosses || []) {
        if (!out.names[b.mob]) continue; // named bosses and cultists only
        const g = groups.get(b.mob) || [];
        if (!g.includes(b.spawnChance)) g.push(b.spawnChance); // one entry per distinct chance
        groups.set(b.mob, g);
      }
      for (const [mob, chances] of groups) per[id].push(variant ? [mob, chances, variant] : [mob, chances]);
    }
    // Wiki says which map a boss is on; move misfiled entries (e.g. Glukhar).
    for (const [mob, from, to] of FIXES.bossMoves) {
      const i = (per[from] || []).findIndex((e) => e[0] === mob);
      if (i >= 0) (per[to] = per[to] || []).push(...per[from].splice(i, 1));
    }
    out[mode] = per;
  }
  return (
    "// Boss and cultist spawn chances per map, from tarkov.dev (json.tarkov.dev/{pve,regular}/maps).\n" +
    "// Generated by tools/update-data.js; map fixes live in tools/data-fixes.json.\n" +
    "window.TARKOV_BOSSES = " +
    JSON.stringify(out) +
    ";\n"
  );
}
function buildLoot(raw, catalog) {
  const r = raw.pve,
    items = r.items.data.items,
    iEn = dict(r.items_en);
  const value = (i) => Math.max(i?.basePrice || 0, i?.avg24hPrice || 0);
  const skipTypes = ["gun", "preset", "armor", "rig", "backpack", "helmet", "wearable", "container", "keys"];
  const rare = (id) => items[id] && value(items[id]) >= 150000 && !(items[id].types || []).some((t) => skipTypes.includes(t));
  const containers = Object.fromEntries(Object.values(r.maps.data.lootContainers || {}).map((c) => [c.id, c.normalizedName]));
  const cat = FIXES.lootContainers;
  const out = {};
  for (const gm of Object.values(r.maps.data.maps)) {
    const id = gm.normalizedName;
    if (!catalog.maps.some((m) => m.id === id)) continue;
    const o = { safe: [], tech: [], meds: [], rare: [] };
    const r1 = (n) => Math.round(n * 10) / 10;
    for (const c of gm.lootContainers || []) {
      const kind = cat[containers[c.lootContainer]];
      if (kind) o[kind].push([r1(c.position.x), r1(c.position.y), r1(c.position.z), containers[c.lootContainer]]);
    }
    for (const l of gm.lootLoose || []) {
      const hits = l.items.filter(rare).sort((a, b) => value(items[b]) - value(items[a]));
      if (hits.length)
        o.rare.push([r1(l.position.x), r1(l.position.y), r1(l.position.z), hits.slice(0, 4).map((i) => iEn[i + " ShortName"] || i).join(", ")]);
    }
    out[id] = o;
  }
  return (
    "// Loot spawn points per map from tarkov.dev, generated by tools/update-data.js.\n" +
    "// Each point: [x, y, z, label]. rare = loose-loot spots that can roll an item worth 150k+.\n" +
    "window.TARKOV_LOOT = " +
    JSON.stringify(out) +
    ";\n"
  );
}

// ---------------------------------------------------------------- safety
function sanityCheck(before, after, report) {
  const problems = [];
  const sideBefore = before.filter((q) => q.source === "tarkov.dev").length;
  const sideAfter = after.quests.filter((q) => q.source === "tarkov.dev").length;
  if (sideAfter < sideBefore * 0.9) problems.push(`quest count fell from ${sideBefore} to ${sideAfter}`);
  if (report.removed.length > 15) problems.push(`${report.removed.length} quests would be removed`);
  const pinned = after.quests.flatMap((q) => q.objectives).filter((o) => o.locations.some((l) => l.world)).length;
  if (pinned < 500) problems.push(`only ${pinned} objectives have pins`);
  const unnamed = after.quests.filter((q) => /^[0-9a-f]{24}/.test(q.name));
  if (unnamed.length) problems.push(`${unnamed.length} quests have no English name`);
  return problems;
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- main
async function main() {
  const catalog = loadCatalog();
  const before = catalog.quests.slice();
  const raw = await load();
  const { report } = update(catalog, raw);
  const problems = sanityCheck(before, catalog, report);
  console.log(
    `Quests: ${report.changed.length} changed, ${report.added.length} added, ${report.removed.length} removed, ${report.kept} kept as-is (story/wiki).`,
  );
  if (report.added.length) console.log("  Added: " + report.added.join(", "));
  if (report.removed.length) console.log("  Removed: " + report.removed.join(", "));
  if (report.changed.length) console.log("  Changed: " + report.changed.slice(0, 40).join(", ") + (report.changed.length > 40 ? " …" : ""));
  if (problems.length) {
    console.error("Not updating, the new data looks wrong:\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
  if (checkOnly) return;
  catalog.snapshotDate = today();
  catalog.updated = today();
  fs.writeFileSync(path.join(DATA, "catalog.js"), "window.TARKOV_CATALOG = " + JSON.stringify(catalog, null, 0) + ";\n");
  fs.writeFileSync(path.join(DATA, "bosses.js"), buildBosses(raw, catalog));
  fs.writeFileSync(path.join(DATA, "loot.js"), buildLoot(raw, catalog));
  console.log("Wrote data/catalog.js, data/bosses.js, data/loot.js. Next: link-photos and build-story-pins.");
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.stack || e);
    process.exit(1);
  });
module.exports = { update, buildObjective };
