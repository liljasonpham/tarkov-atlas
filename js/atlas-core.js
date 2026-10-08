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
  // ---- Quest progression (unlock order and availability) ----
  // A requirement is { task: questId, status: ["complete" | "active" | "failed"] }.
  const reqId = (r) => (typeof r.task === "object" && r.task ? r.task.id : r.task);
  function progression(data) {
    const byId = new Map(data.quests.map((q) => [q.id, q])),
      depth = new Map(),
      level = new Map();
    // depth = how many quests deep in its chain; level = highest level needed along the chain.
    function walk(q, seen = new Set()) {
      if (depth.has(q.id)) return;
      if (seen.has(q.id)) {
        depth.set(q.id, 0);
        level.set(q.id, q.minLevel || 0);
        return;
      }
      seen.add(q.id);
      let d = 0,
        l = q.minLevel || 0;
      for (const r of q.requirements || []) {
        const parent = byId.get(reqId(r));
        if (!parent) continue;
        walk(parent, seen);
        d = Math.max(d, depth.get(parent.id) + 1);
        l = Math.max(l, level.get(parent.id));
      }
      depth.set(q.id, d);
      level.set(q.id, l);
    }
    data.quests.forEach((q) => walk(q));
    const order = (a, b) =>
      level.get(a.id) - level.get(b.id) ||
      depth.get(a.id) - depth.get(b.id) ||
      a.name.localeCompare(b.name);
    return { byId, depth, level, order };
  }
  // Prerequisites that still block a quest for this profile (empty list = unlocked).
  function blockers(prog, p, q) {
    const done = new Set(p.completed),
      out = [];
    for (const r of q.requirements || []) {
      const parent = prog.byId.get(reqId(r)),
        status = r.status || ["complete"];
      if (!parent || done.has(parent.id)) continue;
      if (status.includes("complete")) out.push(parent);
      else if (status.includes("active") && blockers(prog, p, parent).length) out.push(parent);
      // "failed"-only requirements belong to branching story choices; they never block here.
    }
    return out;
  }
  function available(prog, p, q) {
    if (p.completed.includes(q.id)) return false;
    if (p.level && (q.minLevel || 0) > p.level) return false;
    return blockers(prog, p, q).length === 0;
  }
  // Quests you are about to unlock that ask for found-in-raid hand-ins, so you can start
  // keeping those items now. A quest counts as "coming up" when at most `steps` quests stand
  // between you and it and at least one of them is available to you right now (so the chain
  // is actually in progress), or when only a few levels stand between you and it.
  function upcomingHandIns(data, prog, p, steps = 3, levels = 3) {
    const done = new Set(p.completed),
      out = [];
    for (const q of data.quests) {
      if (done.has(q.id) || q.kind === "arena") continue;
      const mode = p.mode === "pve" ? "pve" : "regular";
      if (q.modes?.length && !q.modes.includes(mode)) continue;
      const need = objectives(q, p.mode).filter(
        (o) =>
          o.type === "giveItem" &&
          o.foundInRaid &&
          !o.optional &&
          !(p.objectives[o.id] || {}).done,
      );
      if (!need.length) continue;
      const missing = [...ancestors(prog, q)].filter((id) => !done.has(id)).map((id) => prog.byId.get(id));
      let reason = null;
      if (missing.length >= 1 && missing.length <= steps) {
        const now = missing.filter((m) => available(prog, p, m));
        if (now.length) reason = { kind: "chain", steps: missing.length, via: now };
      } else if (!missing.length && p.level && q.minLevel > p.level && q.minLevel - p.level <= levels)
        reason = { kind: "level", steps: q.minLevel - p.level, via: [] };
      if (reason) out.push({ q, need, ...reason });
    }
    return out.sort((a, b) => a.steps - b.steps || a.q.name.localeCompare(b.q.name));
  }
  // "I'm on this step": everything before it in the chapter counts as done, it and everything
  // after it is reopened. Optional side steps before it are left as they were.
  function setStoryStep(p, q, objectiveId) {
    const list = objectives(q, p.mode),
      at = list.findIndex((o) => o.id === objectiveId);
    if (at < 0) return;
    list.forEach((o, i) => {
      if (i < at) {
        if (!o.optional) p.objectives[o.id] = { ...(p.objectives[o.id] || {}), done: true, count: o.count || 1 };
      } else delete p.objectives[o.id];
    });
    p.story = { ...(p.story || {}), [q.id]: objectiveId };
    p.completed = p.completed.filter((id) => id !== q.id);
  }
  // Every quest that has to be finished before q (used by "mark done").
  function ancestors(prog, q, out = new Set()) {
    for (const r of q.requirements || []) {
      const parent = prog.byId.get(reqId(r));
      if (!parent || out.has(parent.id) || !(r.status || ["complete"]).includes("complete"))
        continue;
      out.add(parent.id);
      ancestors(prog, parent, out);
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
      level: null,
      story: {},
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
        level: Number.isInteger(p.level) && p.level >= 1 && p.level <= 79 ? p.level : null,
        // Story chapter -> the step the player last said they are on.
        story: Object.fromEntries(
          Object.entries(p.story && typeof p.story === "object" ? p.story : {}).filter(
            ([q, o]) => qs.has(q) && os.has(o),
          ),
        ),
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
    progression,
    blockers,
    available,
    ancestors,
    upcomingHandIns,
    setStoryStep,
    newProfile,
    initialState,
    validateState,
  };
});
