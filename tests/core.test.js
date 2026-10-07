// Run with: node --test
// Note: items to bring are capped by how many times the objective is still left to do.
// Unit tests for the pure logic in js/atlas-core.js (no browser needed).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const C = require("../js/atlas-core.js");

// Load the real catalog the same way the browser does (it assigns window.TARKOV_CATALOG).
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../data/catalog.js"), "utf8"), sandbox);
const catalog = sandbox.window.TARKOV_CATALOG;

// A tiny hand-made catalog so packing rules are easy to reason about.
const key = { id: "key-1", name: "Dorm room 114 key" };
const water = { id: "water", name: "Bottle of water" };
const tiny = {
  quests: [
    {
      id: "q1",
      name: "Quest one",
      objectives: [
        {
          id: "o1",
          count: 2,
          maps: ["customs"],
          locations: [],
          keys: [[key]],
          bring: [{ items: [water], count: 2 }],
          gear: [],
          keep: [],
        },
      ],
    },
    {
      id: "q2",
      name: "Quest two",
      objectives: [
        {
          id: "o2",
          count: 1,
          maps: ["customs"],
          locations: [],
          keys: [[key]],
          bring: [{ items: [water], count: 1 }],
          gear: [],
          keep: [],
        },
        {
          id: "o3",
          count: 1,
          maps: ["woods"],
          locations: [],
          keys: [],
          bring: [{ items: [water], count: 5 }],
          gear: [],
          keep: [],
        },
      ],
    },
  ],
};
const profileWith = (selected) => ({ ...C.newProfile("test"), selected });

test("a fresh install starts with one empty profile", () => {
  const state = C.initialState(catalog);
  assert.strictEqual(state.profiles.length, 1);
  assert.deepStrictEqual(state.profiles[0].selected, []);
});

test("the public catalog contains no personal progress data", () => {
  for (const field of ["defaults", "reminders", "hideout"]) assert.ok(!(field in catalog), field);
  for (const q of catalog.quests) {
    assert.ok(!("personalNotes" in q) && !("previousProgress" in q), q.name);
  }
});

test("a shared key is packed once, but consumables add up", () => {
  const { bring } = C.packing(tiny, profileWith(["q1", "q2"]), "customs");
  const keys = bring.filter((b) => b.kind === "key");
  const waterRow = bring.find((b) => b.items[0].id === "water");
  assert.strictEqual(keys.length, 1);
  assert.strictEqual(waterRow.count, 3); // 2 + 1; the Woods objective is not included
});

test("completed objectives drop out of the packing list", () => {
  const p = profileWith(["q1"]);
  p.objectives = { o1: { done: true } };
  assert.strictEqual(C.packing(tiny, p, "customs").bring.length, 0);
});

test("Sisyphus shows Lighthouse pins until its objectives are done", () => {
  const sisyphus = catalog.quests.find((q) => q.name === "Sisyphus");
  const lighthouse = catalog.maps.find((m) => m.id === "lighthouse");
  const p = profileWith([sisyphus.id]);
  assert.ok(C.markers(catalog, p, lighthouse).length > 0);
  for (const o of sisyphus.objectives) p.objectives[o.id] = { done: true };
  assert.strictEqual(C.markers(catalog, p, lighthouse).length, 0);
});

test("every pin projects inside its map image (with a small margin)", () => {
  const p = profileWith(catalog.quests.map((q) => q.id));
  let checked = 0;
  for (const map of catalog.maps) {
    for (const m of C.markers(catalog, p, map)) {
      checked++;
      assert.ok(m.x > -0.1 * map.width && m.x < 1.1 * map.width, `${m.q.name} x on ${map.id}`);
      assert.ok(m.y > -0.1 * map.height && m.y < 1.1 * map.height, `${m.q.name} y on ${map.id}`);
    }
  }
  assert.ok(checked > 500);
});
