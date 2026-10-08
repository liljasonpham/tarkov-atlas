// Home page: a live slice of the Customs map, your saved progress, and a map picker.
(function () {
  "use strict";
  const data = window.TARKOV_CATALOG,
    C = window.AtlasCore;
  if (!data || !C) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const mapById = new Map(data.maps.map((m) => [m.id, m]));

  // ---- Saved progress from the planner (same browser) ----
  let profile = null;
  try {
    const state = C.validateState(
      JSON.parse(localStorage.getItem("tarkov-atlas-profiles-v2") || "null"),
      data,
    );
    profile = state.profiles.find((p) => p.id === state.activeProfile) || state.profiles[0];
  } catch {}
  const mode = profile?.mode === "regular" ? "regular" : "pve";
  const inMode = (q) => !q.modes?.length || q.modes.includes(mode);

  if (profile && (profile.selected.length || profile.completed.length)) {
    const done = new Set(profile.completed);
    const kappa = data.quests.filter((q) => q.kappa && inMode(q)),
      all = data.quests.filter((q) => q.kind !== "story" && q.kind !== "arena" && inMode(q)),
      picked = profile.selected.filter((id) => !done.has(id)).length;
    const box = $("your-run");
    const stats = el("div", undefined, "run-stats");
    for (const [label, list] of [
      ["Kappa", kappa],
      ["Quests", all],
    ]) {
      const n = list.filter((q) => done.has(q.id)).length;
      const s = el("div", undefined, "run-stat");
      s.append(el("strong", n + "/" + list.length), el("span", label + " done"));
      stats.append(s);
    }
    const s = el("div", undefined, "run-stat");
    s.append(el("strong", String(picked)), el("span", "picked for your raid"));
    stats.append(s);
    const go = el("a", "Continue " + profile.name, "button");
    go.href = "planner.html";
    box.append(stats, go);
    box.hidden = false;
  }

  // ---- Map picker ----
  const ORDER = [
    "customs",
    "woods",
    "factory",
    "interchange",
    "shoreline",
    "reserve",
    "lighthouse",
    "streets-of-tarkov",
    "ground-zero",
    "the-lab",
    "terminal",
    "the-labyrinth",
    "icebreaker",
  ];
  const questsOn = (id) =>
    data.quests.filter(
      (q) =>
        q.kind !== "arena" &&
        inMode(q) &&
        !profile?.completed.includes(q.id) &&
        C.objectives(q, mode).some((o) => o.locations.some((l) => l.map === id)),
    ).length;
  const grid = $("map-grid");
  for (const id of ORDER) {
    const m = mapById.get(id);
    if (!m) continue;
    const a = el("a", undefined, "map-tile");
    a.href = "planner.html#map=" + id;
    const im = el("img");
    im.src = m.floors[0].image;
    im.alt = "";
    im.loading = "lazy";
    const n = questsOn(id);
    const text = el("span", undefined, "map-text");
    text.append(
      el("span", m.name, "map-name"),
      el("span", n + (n === 1 ? " quest" : " quests") + " with pins here", "map-count"),
    );
    a.append(im, text);
    grid.append(a);
  }

  // ---- Hero: Golden Swag on Customs, with a few neighbouring objectives ----
  const customs = mapById.get("customs");
  const swag = data.quests.find((q) => q.name === "Golden Swag");
  const frame = $("hero-frame"),
    world = $("hero-world");
  if (!customs || !swag) return;
  const pct = (w) => {
    const p = C.project(w, customs);
    return { x: (p.x / customs.width) * 100, y: (p.y / customs.height) * 100 };
  };
  const target = swag.objectives[0].locations.find((l) => l.world);
  const focus = pct(target.world);
  // Neighbouring pins from other quests, so the map looks like a real raid plan.
  const near = [];
  for (const q of data.quests) {
    if (q === swag || q.kind === "arena") continue;
    for (const o of q.objectives)
      for (const l of o.locations) {
        if (l.map !== "customs" || !l.world || C.floorFor(l, customs) !== customs.floors[0].id)
          continue;
        const p = pct(l.world);
        if (Math.abs(p.x - focus.x) < 22 && Math.abs(p.y - focus.y) < 30) near.push({ q, o, p });
      }
  }
  near.sort((a, b) => a.q.name.localeCompare(b.q.name));
  const shown = near.filter((n, i) => i % Math.max(1, Math.floor(near.length / 9)) === 0).slice(0, 9);
  shown.forEach(({ q, o, p }, i) => {
    const pin = el("span", String(i + 1), "pin");
    pin.style.left = p.x + "%";
    pin.style.top = p.y + "%";
    pin.title = q.name + ": " + o.description;
    world.append(pin);
  });
  const main = el("span", "", "pin pin-main");
  main.style.left = focus.x + "%";
  main.style.top = focus.y + "%";
  main.title = "Golden Swag: " + swag.objectives[0].description;
  world.append(main);

  // The spot photo from the wiki, linked to this objective.
  const ref = (swag.objectives[0].photoRefs || []).map((i) => swag.photos[i]).find((p) => p.kind !== "map");
  const photo = $("hero-photo");
  if (ref) {
    photo.referrerPolicy = "no-referrer";
    photo.src = ref.thumb || ref.src;
    photo.onerror = () => (photo.hidden = true);
  } else photo.hidden = true;

  // Zoom the map so the dorms sit in the right part of the frame.
  const ZOOM = 3.1;
  function place() {
    const w = frame.clientWidth,
      h = frame.clientHeight;
    const ww = w * ZOOM,
      wh = ww * (customs.height / customs.width);
    world.style.width = ww + "px";
    world.style.height = wh + "px";
    const fx = (focus.x / 100) * ww,
      fy = (focus.y / 100) * wh;
    const ax = w * (w < 520 ? 0.5 : 0.46),
      ay = h * (w < 520 ? 0.36 : 0.66);
    world.style.transform = "translate(" + (ax - fx) + "px," + (ay - fy) + "px)";
  }
  new ResizeObserver(place).observe(frame);
  place();
})();
