(function (root, factory) {
  const api = factory();
  if (typeof module === "object") module.exports = api;
  else root.AtlasCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const unique = (a) => [...new Set(a)];
  const objectives = (q, mode) =>
    mode === "regular" && q.regularObjectives ? q.regularObjectives : q.objectives;
  const progress = (p, o) => p.objectives[o.id] || {};
  const remaining = (p, o) =>
    progress(p, o).done ? 0 : Math.max(0, (o.count || 1) - (Number(progress(p, o).count) || 0));
  const active = (p, q) => p.selected.includes(q.id) && !p.completed.includes(q.id);
  const relevant = (o, map) => !o.maps.length || o.maps.includes(map);
  function entries(data, p, map) {
    return data.quests
      .filter((q) => active(p, q))
      .flatMap((q) =>
        objectives(q, p.mode)
          .filter(
            (o) => !o.failure && remaining(p, o) > 0 && !progress(p, o).hidden && relevant(o, map),
          )
          .map((o) => ({ q, o })),
      );
  }
  function packing(data, p, map) {
    const bins = new Map(),
      keep = new Map();
    function add(target, key, row, context, sum = false) {
      if (!row.items?.length) return;
      let old = target.get(key);
      if (old) {
        old.count = sum ? old.count + row.count : Math.max(old.count, row.count);
        old.context.push(context);
      } else target.set(key, { ...row, context: [context] });
    }
    for (const { q, o } of entries(data, p, map)) {
      const context = { quest: q.name, questId: q.id, objectiveId: o.id, text: o.description };
      for (const b of o.bring || []) {
        let count = Math.min(b.count || 1, remaining(p, o));
        add(
          bins,
          "bring:" +
            b.items
              .map((i) => i.id)
              .sort()
              .join("|"),
          { ...b, count },
          context,
          true,
        );
      }
      for (const keys of o.keys || []) {
        add(
          bins,
          "key:" +
            keys
              .map((k) => k.id)
              .sort()
              .join("|"),
          { items: keys, count: 1, kind: "key" },
          context,
        );
      }
      for (const g of o.gear || []) {
        let key = "gear:" + g.label + JSON.stringify(g.choices.map((c) => c.map((i) => i.id)));
        add(
          bins,
          key,
          { items: g.choices.flat(), choices: g.choices, count: 1, kind: "gear", label: g.label },
          context,
        );
      }
      // Find and hand-over steps often describe the same items. Count the hand-over once.
      for (const k of o.keep || []) {
        add(
          keep,
          "keep:" +
            q.id +
            ":" +
            k.items
              .map((i) => i.id)
              .sort()
              .join("|"),
          { ...k, count: Math.min(k.count || 1, remaining(p, o)), foundInRaid: o.foundInRaid },
          context,
        );
      }
    }
    return { bring: [...bins.values()], keep: [...keep.values()] };
  }
  function project(world, map) {
    const a = (map.coordinateRotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a),
      t = map.transform,
      b = map.projectionBox;
    return {
      x: (((world.x * c - world.z * s) * t[0] + t[1] - b.x) / b.w) * map.width,
      y: ((-(world.x * s + world.z * c) * t[2] + t[3] - b.y) / b.h) * map.height,
    };
  }
  function floorFor(loc, map) {
    if (!loc.world) return null;
    let p = loc.world;
    for (const floor of [...map.floors].reverse()) {
      for (const e of floor.extents || []) {
        if (p.y < e.height[0] || p.y >= e.height[1]) continue;
        if (
          e.bounds?.length &&
          !e.bounds.some(
            (b) =>
              p.x >= Math.min(b[0][0], b[1][0]) &&
              p.x <= Math.max(b[0][0], b[1][0]) &&
              p.z >= Math.min(b[0][1], b[1][1]) &&
              p.z <= Math.max(b[0][1], b[1][1]),
          )
        )
          continue;
        return floor.id;
      }
    }
    return map.floors[0]?.id;
  }
  function markers(data, p, map, view = "survey", floor = "all") {
    let out = [];
    for (const { q, o } of entries(data, p, map.id)) {
      for (const [n, l] of o.locations.entries()) {
        if (l.map !== map.id) continue;
        if (!l.world) continue;
        const fl = floorFor(l, map);
        if (floor !== "all" && fl !== floor) continue;
        let point = project(l.world, map);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        out.push({ q, o, l, n, floor: fl, ...point });
      }
    }
    return out;
  }
  function newProfile(name, mode = "pve") {
    return {
      id: "run-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      name: name || "My run",
      mode,
      selected: [],
      completed: [],
      objectives: {},
      created: new Date().toISOString(),
    };
  }
  function initialState(data) {
    let current = newProfile("My run");
    return { version: 2, activeProfile: current.id, profiles: [current] };
  }
  function validateState(value, data) {
    if (
      !value ||
      value.version !== 2 ||
      !Array.isArray(value.profiles) ||
      !value.profiles.length ||
      value.profiles.length > 100
    )
      throw Error("This is not a valid atlas backup.");
    const qs = new Set(data.quests.map((q) => q.id)),
      os = new Map(
        data.quests.flatMap((q) =>
          [...q.objectives, ...(q.regularObjectives || [])].map((o) => [o.id, o]),
        ),
      );
    let profiles = value.profiles.map((p, i) => {
      if (
        !p ||
        typeof p.name !== "string" ||
        !Array.isArray(p.selected) ||
        !Array.isArray(p.completed)
      )
        throw Error("A profile is incomplete.");
      let states = {};
      for (const [id, s] of Object.entries(p.objectives || {})) {
        if (!os.has(id) || !s || typeof s !== "object") continue;
        states[id] = {
          done: s.done === true,
          hidden: s.hidden === true,
          count: Math.max(0, Math.min(os.get(id).count || 1, Number(s.count) || 0)),
        };
      }
      return {
        id: typeof p.id === "string" && /^[\w-]+$/.test(p.id) ? p.id : "import-" + i,
        name: p.name.slice(0, 80),
        mode: p.mode === "regular" ? "regular" : "pve",
        selected: unique(p.selected.filter((id) => qs.has(id))),
        completed: unique(p.completed.filter((id) => qs.has(id))),
        objectives: states,
        created: typeof p.created === "string" ? p.created : "",
      };
    });
    if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
      throw Error("Duplicate profile IDs in backup.");
    return {
      version: 2,
      profiles,
      activeProfile: profiles.some((p) => p.id === value.activeProfile)
        ? value.activeProfile
        : profiles[0].id,
    };
  }
  return {
    objectives,
    progress,
    remaining,
    active,
    relevant,
    entries,
    packing,
    project,
    floorFor,
    markers,
    newProfile,
    initialState,
    validateState,
  };
});
