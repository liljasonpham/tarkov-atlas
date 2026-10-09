(() => {
  "use strict";
  const data = window.TARKOV_CATALOG,
    C = window.AtlasCore,
    $ = (id) => document.getElementById(id),
    KEY = "tarkov-atlas-profiles-v2";
  const qById = new Map(data.quests.map((q) => [q.id, q])),
    mById = new Map(data.maps.map((m) => [m.id, m]));
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const button = (text, action, cls) => {
    let b = el("button", text, cls);
    b.type = "button";
    b.onclick = action;
    return b;
  };
  const link = (text, url) => {
    let a = el("a", text);
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    return a;
  };
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let state,
    storageFailed = false;
  try {
    const s = localStorage.getItem(KEY);
    state = s ? C.validateState(JSON.parse(s), data) : C.initialState(data);
  } catch {
    state = C.initialState(data);
    storageFailed = true;
  }
  let profile = state.profiles.find((p) => p.id === state.activeProfile),
    selectedQuest = null,
    selectedObjective = null,
    selectionOnly = false,
    libView = "traders", // "traders" | "all" | "selected"
    trader = null, // trader whose quests are open, or null for the trader grid
    availableOnly = false,
    storyChapter = null, // story chapter open on the story page
    storyFilter = "incomplete",
    listLimit = 150,
    undoState = null,
    toastTimer;
  let hash = new URLSearchParams(location.hash.slice(1)),
    map = mById.get(hash.get("map")) || mById.get("ground-zero"),
    view = "survey",
    floor = "all";
  let tipDismissed = false;
  // Map layers the player has switched on (saved per browser).
  const LAYER_KEY = "tarkov-atlas-layers";
  const LAYERS = [
    ["extracts", "Extracts", "#72b3a5"],
    ["rooms", "Loot rooms", "#ebbc73"],
    ["rare", "Rare loot", "#f0c75e"],
    ["tech", "Tech", "#6fa8dc"],
    ["meds", "Meds", "#e06666"],
    ["safe", "Safes", "#b7b7b7"],
  ];
  let layers = { extracts: true, rooms: true };
  try {
    layers = { ...layers, ...JSON.parse(localStorage.getItem(LAYER_KEY) || "{}") };
  } catch {}
  let overlayMin = {};
  try {
    overlayMin = JSON.parse(localStorage.getItem("tarkov-atlas-overlays") || "{}");
  } catch {}
  let drawnLoot = [];
  try {
    tipDismissed = localStorage.getItem("tarkov-atlas-tip-dismissed") === "1";
  } catch {}
  let scale = 1,
    offset = { x: 0, y: 0 },
    width = 1,
    height = 1,
    img = null,
    ready = false,
    loadSerial = 0,
    drag = null,
    drawnPins = [],
    hoverPin = null;
  const prog = C.progression(data);
  const TRADER_ORDER = [
    "Prapor",
    "Therapist",
    "Fence",
    "Skier",
    "Peacekeeper",
    "Mechanic",
    "Ragman",
    "Jaeger",
    "Ref",
    "Lightkeeper",
    "BTR Driver",
    "Story",
  ];
  // Trader portraits served by tarkov.dev (keyed by in-game trader ID). Tiles fall back to initials.
  const PORTRAIT = {
    Prapor: "54cb50c76803fa8b248b4571",
    Therapist: "54cb57776803fa99248b456e",
    Fence: "579dc571d53a0658a154fbec",
    Skier: "58330581ace78e27b8b10cee",
    Peacekeeper: "5935c25fb3acc3127c3d8cd9",
    Mechanic: "5a7c2eca46aef81a7ca2145d",
    Ragman: "5ac3b934156ae10c4430e83c",
    Jaeger: "5c0647fdd443bc2504c2d371",
    Lightkeeper: "638f541a29ffd1183d187f57",
    "BTR Driver": "656f0f98d80a697f855d34b1",
    Ref: "6617beeaa9cfa777ca915b7c",
  };
  function portrait(name, cls) {
    const box = el("span", undefined, cls);
    box.append(el("span", name === "BTR Driver" ? "BTR" : name.slice(0, 2), "trader-mono"));
    if (PORTRAIT[name]) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = "https://assets.tarkov.dev/" + PORTRAIT[name] + ".webp";
      img.onerror = () => img.remove();
      box.append(img);
    }
    return box;
  }
  const traders = [
    ...TRADER_ORDER.filter((t) => data.quests.some((q) => q.trader === t)),
    ...[...new Set(data.quests.map((q) => q.trader))]
      .filter((t) => !TRADER_ORDER.includes(t))
      .sort(),
  ];
  const canvas = $("map-canvas"),
    ctx = canvas.getContext("2d"),
    viewport = $("map-viewport"),
    imageCache = new Map();
  function toast(message, undo = false) {
    clearTimeout(toastTimer);
    $("toast-message").textContent = message;
    $("undo-button").hidden = !undo;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 10000 : 6500);
  }
  function persist() {
    state.activeProfile = profile.id;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageFailed = false;
    } catch {
      storageFailed = true;
      toast("Browser storage is unavailable. Export a backup to keep this run.");
    }
  }
  function change(fn, message) {
    undoState = JSON.stringify(state);
    fn();
    persist();
    renderAll();
    if (message) toast(message, true);
  }
  function updateHash() {
    let h = new URLSearchParams({ map: map.id });
    if (selectedQuest) h.set("quest", selectedQuest.id);
    if (selectedObjective) h.set("objective", selectedObjective);
    history.replaceState(null, "", "#" + h);
  }
  function chooseQuest(qid, oid) {
    selectedQuest = qid ? qById.get(qid) || null : null;
    selectedObjective = selectedQuest ? oid || null : null;
    placeLists();
    renderDetail();
    renderLibrary();
    draw();
    updateHash();
    if (oid)
      requestAnimationFrame(() =>
        $("selected-detail")
          .querySelector('[data-objective="' + oid + '"]')
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
  }
  function setSelected(q, value) {
    change(
      () => {
        profile.selected = profile.selected.filter((id) => id !== q.id);
        if (value) {
          profile.selected.push(q.id);
          profile.completed = profile.completed.filter((id) => id !== q.id);
        }
      },
      value ? "Selected " + q.name : "Removed " + q.name + " from this raid",
    );
  }
  function renderProfiles() {
    const s = $("profile-select");
    s.replaceChildren(...state.profiles.map((p) => new Option(p.name, p.id)));
    s.value = profile.id;
    const target = $("profiles-list");
    target.replaceChildren();
    for (const p of state.profiles) {
      let row = el("div", undefined, "profile-row"),
        title = el("div");
      title.append(
        el("strong", p.name),
        el(
          "small",
          (p.mode === "pve" ? "PvE" : "PvP") +
            " · " +
            p.selected.filter((id) => !p.completed.includes(id)).length +
            " selected · " +
            p.completed.length +
            " complete",
        ),
      );
      row.append(title);
      let b = button(p.id === profile.id ? "Current run" : "Use this run", () =>
        switchProfile(p.id),
      );
      b.disabled = p.id === profile.id;
      row.append(b);
      target.append(row);
    }
  }
  function switchProfile(id) {
    profile = state.profiles.find((p) => p.id === id) || profile;
    selectedQuest = null;
    selectedObjective = null;
    persist();
    renderAll();
    updateHash();
    toast("Using " + profile.name);
  }
  function matches(q) {
    let search = normalize($("quest-search").value);
    if (
      search &&
      !normalize(
        q.name +
          " " +
          q.trader +
          " " +
          C.objectives(q, profile.mode)
            .map((o) => o.description)
            .join(" "),
      ).includes(search)
    )
      return false;
    if ($("trader-filter").value && q.trader !== $("trader-filter").value) return false;
    if ($("kind-filter").value && q.kind !== $("kind-filter").value) return false;
    if (
      $("map-filter").value === "current" &&
      !C.objectives(q, profile.mode).some((o) => !o.maps.length || o.maps.includes(map.id))
    )
      return false;
    let completed = profile.completed.includes(q.id),
      f = $("progress-filter").value;
    if (
      (f === "completed" && !completed) ||
      (f === "unfinished" && completed) ||
      (f === "unverified" &&
        !C.objectives(q, profile.mode).some((o) => o.placement === "unverified"))
    )
      return false;
    return !selectionOnly || C.active(profile, q);
  }
  // ---- Trader browsing ----
  function traderQuests(name) {
    return data.quests
      .filter((q) => q.trader === name)
      .sort((a, b) => Number(a.kind === "arena") - Number(b.kind === "arena") || prog.order(a, b));
  }
  function renderTraderGrid(list) {
    $("quest-count").textContent = "Choose a trader to see their quests in unlock order";
    const grid = el("div", undefined, "trader-grid");
    for (const name of traders) {
      const qs = traderQuests(name),
        done = qs.filter((q) => profile.completed.includes(q.id)).length,
        picked = qs.filter((q) => C.active(profile, q)).length,
        tile = button("", () => openTrader(name), "trader-tile");
      const meter = el("span", undefined, "meter");
      meter.append(el("i"));
      meter.firstChild.style.width = (qs.length ? (done / qs.length) * 100 : 0) + "%";
      const text = el("span", undefined, "trader-text");
      text.append(
        el("span", name === "Imported quest" ? "Other" : name, "trader-name"),
        el("span", done + "/" + qs.length + " done", "trader-progress"),
        meter,
      );
      if (picked) text.append(el("span", picked + " in raid", "trader-picked"));
      tile.append(portrait(name, "trader-portrait"), text);
      tile.setAttribute("aria-pressed", String(trader === name));
      tile.setAttribute("aria-label", name + ", " + done + " of " + qs.length + " quests done");
      grid.append(tile);
    }
    list.append(grid);
  }
  function openTrader(name) {
    trader = name;
    renderLibrary();
    renderTraderPanel(true);
    $("trader-panel").querySelector(".trader-title")?.focus();
  }
  function closeTrader() {
    const was = trader;
    trader = null;
    renderLibrary();
    renderTraderPanel();
    $("quest-list").querySelector('[aria-pressed="true"]')?.focus();
    if (was) draw();
  }
  const LEVEL_BANDS = [
    [0, 1, "From the start"],
    [2, 9, "Levels 2–9"],
    [10, 19, "Levels 10–19"],
    [20, 29, "Levels 20–29"],
    [30, 39, "Levels 30–39"],
    [40, 99, "Level 40 and up"],
  ];
  // The trader picker opens over the map so a trader's whole list fits on screen at once.
  function renderTraderPanel(fresh = false) {
    const panel = $("trader-panel");
    panel.hidden = !trader;
    if (!trader) return;
    if (trader === "Story") return renderStoryPanel(panel, fresh);
    const body = panel.querySelector(".picker-body"),
      keepScroll = fresh || !body ? 0 : body.scrollTop;
    const all = traderQuests(trader),
      done = all.filter((q) => profile.completed.includes(q.id)).length,
      picked = all.filter((q) => C.active(profile, q)).length,
      rows = availableOnly ? all.filter((q) => C.available(prog, profile, q)) : all;
    panel.replaceChildren();
    const head = el("div", undefined, "picker-head");
    const title = el("div", undefined, "picker-title");
    const h = el("h2", trader, "trader-title");
    h.tabIndex = -1;
    title.append(
      portrait(trader, "trader-portrait large"),
      (() => {
        const t = el("div");
        t.append(
          h,
          el("p", done + " of " + all.length + " done · " + picked + " in this raid", "picker-sub"),
        );
        return t;
      })(),
    );
    const controls = el("div", undefined, "trader-controls");
    const avail = el("label", undefined, "switch");
    const box = el("input");
    box.type = "checkbox";
    box.checked = availableOnly;
    box.onchange = () => {
      availableOnly = box.checked;
      renderTraderPanel(true);
    };
    avail.append(box, document.createTextNode(" Available only"));
    const lvl = el("label", undefined, "level-input");
    const num = el("input");
    num.type = "number";
    num.min = 1;
    num.max = 79;
    num.placeholder = "any";
    num.value = profile.level || "";
    num.onchange = () => {
      const v = Math.round(Number(num.value));
      profile.level = v >= 1 && v <= 79 ? v : null;
      persist();
      renderTraderPanel();
    };
    lvl.append(document.createTextNode("Your level "), num);
    controls.append(avail, lvl, button("Back to map", closeTrader, "primary"));
    head.append(title, controls);
    const scroll = el("div", undefined, "picker-body");
    if (!rows.length)
      scroll.append(
        el(
          "p",
          availableOnly
            ? "Nothing available from " +
                trader +
                " right now. Mark the quests you've finished as done, raise your level, or turn off Available only."
            : "No quests for this trader.",
          "quiet",
        ),
      );
    const groups = [];
    for (const [lo, hi, label] of LEVEL_BANDS)
      groups.push([
        label,
        rows.filter(
          (q) => q.kind !== "arena" && prog.level.get(q.id) >= lo && prog.level.get(q.id) <= hi,
        ),
      ]);
    groups.push(["Arena", rows.filter((q) => q.kind === "arena")]);
    for (const [label, qs] of groups) {
      if (!qs.length) continue;
      const sec = el("section", undefined, "picker-group");
      sec.append(el("h3", label + " (" + qs.length + ")"));
      const grid = el("div", undefined, "picker-grid");
      for (const q of qs) grid.append(traderRow(q));
      sec.append(grid);
      scroll.append(sec);
    }
    panel.append(head, scroll);
    scroll.scrollTop = keepScroll;
  }
  // ---- Story chapters page ----
  const STORY_ORDER = [
    "Tour",
    "Falling Skies",
    "Batya",
    "The Unheard",
    "Blue Fire",
    "They Are Already Here",
    "Accidental Witness",
    "The Labyrinth",
    "The Ticket",
    "Boreas",
  ];
  const STORY_BLURB = {
    Tour: "Your first days after the TerraGroup blast: get to know the city and look for a way out.",
    "Falling Skies": "A plane went down in the Woods. Find out what it was carrying and who wants it.",
    Batya: "Track down the BEAR special squad that went missing somewhere in Tarkov.",
    "The Unheard": "A note on TerraGroup paper leads to a group calling themselves The Unheard.",
    "Blue Fire": "Work out what the blue flash was that knocked you out during the raid.",
    "They Are Already Here": "Follow the cultists' symbols and the victims they leave behind.",
    "Accidental Witness": "Someone saw too much. Find out what happened to him and who he talked to.",
    "The Labyrinth": "Go under the Health Resort to learn what happened to a lost BEAR squad.",
    "The Ticket": "Work toward a real way out of Tarkov, and decide who you can trust.",
    Boreas: "Board the icebreaker stuck off the coast and dig into its history.",
  };
  const storyChapters = () =>
    STORY_ORDER.map((n) => data.quests.find((q) => q.kind === "story" && q.name === n)).filter(
      Boolean,
    );
  // Where the player is in a chapter: the step they last picked, else the first open step.
  function storyState(q) {
    const list = C.objectives(q, profile.mode),
      main = list.filter((o) => !o.optional),
      doneCount = main.filter((o) => C.progress(profile, o).done).length;
    const complete = profile.completed.includes(q.id);
    let current = complete
      ? null
      : list.find((o) => o.id === profile.story?.[q.id]) ||
        main.find((o) => !C.progress(profile, o).done) ||
        null;
    if (current && C.progress(profile, current).done) current = main.find((o) => !C.progress(profile, o).done) || null;
    const index = current ? list.indexOf(current) : -1;
    return {
      list,
      complete,
      current,
      started: complete || doneCount > 0 || Boolean(profile.story?.[q.id]),
      pct: complete ? 100 : main.length ? Math.round((doneCount / main.length) * 100) : 0,
      stepNumber: index + 1,
    };
  }
  function chapterArt(q, cls) {
    const spot = (q.photos || []).find((p) => p.kind !== "map") || (q.photos || [])[0];
    const art = el("div", undefined, cls);
    if (spot) {
      const im = photoImg(spot, q.name);
      im.alt = "";
      art.append(im);
    }
    return art;
  }
  function setChapterComplete(q, value) {
    change(
      () => {
        profile.completed = profile.completed.filter((id) => id !== q.id);
        if (value) {
          profile.completed.push(q.id);
          profile.selected = profile.selected.filter((id) => id !== q.id);
          for (const o of C.objectives(q, profile.mode))
            if (!o.optional) profile.objectives[o.id] = { done: true, count: o.count || 1 };
        }
      },
      value ? q.name + " marked complete" : q.name + " reopened",
    );
  }
  function renderStoryPanel(panel, fresh) {
    const chapters = storyChapters(),
      body = panel.querySelector(".picker-body"),
      keepScroll = fresh || !body ? 0 : body.scrollTop,
      doneCount = chapters.filter((q) => profile.completed.includes(q.id)).length;
    panel.replaceChildren();
    const chapter = chapters.find((q) => q.id === storyChapter);
    const head = el("div", undefined, "picker-head");
    const title = el("div", undefined, "picker-title");
    const h = el("h2", chapter ? chapter.name : "Story chapters", "trader-title");
    h.tabIndex = -1;
    const t = el("div");
    t.append(
      h,
      el(
        "p",
        chapter
          ? "Click the step you're on. Everything before it is marked done."
          : doneCount + " of " + chapters.length + " chapters complete",
        "picker-sub",
      ),
    );
    title.append(t);
    const controls = el("div", undefined, "trader-controls");
    if (chapter)
      controls.append(
        button("All chapters", () => {
          storyChapter = null;
          renderTraderPanel(true);
        }),
      );
    else {
      const seg = el("div", undefined, "segmented");
      for (const [key, label] of [
        ["incomplete", "Incomplete"],
        ["completed", "Completed"],
        ["all", "All"],
      ]) {
        const b = button(label, () => {
          storyFilter = key;
          renderTraderPanel(true);
        });
        b.setAttribute("aria-pressed", String(storyFilter === key));
        seg.append(b);
      }
      controls.append(seg);
    }
    controls.append(button("Back to map", closeTrader, "primary"));
    head.append(title, controls);
    const scroll = el("div", undefined, "picker-body");
    if (chapter) scroll.append(storyDetail(chapter));
    else {
      const shown = chapters.filter((q) =>
        storyFilter === "all"
          ? true
          : storyFilter === "completed"
            ? profile.completed.includes(q.id)
            : !profile.completed.includes(q.id),
      );
      if (!shown.length)
        scroll.append(
          el(
            "p",
            storyFilter === "completed" ? "No chapters completed yet." : "Every chapter is complete.",
            "quiet",
          ),
        );
      const grid = el("div", undefined, "story-grid");
      for (const q of shown) grid.append(storyCard(q));
      scroll.append(grid);
    }
    panel.append(head, scroll);
    scroll.scrollTop = keepScroll;
  }
  function storyCard(q) {
    const st = storyState(q),
      n = STORY_ORDER.indexOf(q.name) + 1;
    const card = el("article", undefined, "story-card");
    card.dataset.state = st.complete ? "done" : st.started ? "active" : "new";
    const open = button("", () => {
      storyChapter = q.id;
      renderTraderPanel(true);
    }, "story-open");
    open.setAttribute("aria-label", "Open " + q.name);
    open.append(chapterArt(q, "story-art"));
    const text = el("div", undefined, "story-text");
    const name = el("div", undefined, "story-name");
    name.append(el("span", String(n).padStart(2, "0"), "story-num"), el("span", q.name));
    text.append(name, el("p", STORY_BLURB[q.name] || "", "story-blurb"));
    const meter = el("span", undefined, "meter");
    meter.append(el("i"));
    meter.firstChild.style.width = st.pct + "%";
    text.append(
      meter,
      el(
        "p",
        st.complete
          ? "Complete"
          : !st.started
            ? "Not started · " + st.list.length + " steps"
            : st.current
              ? "Step " + st.stepNumber + " of " + st.list.length + ": " + st.current.description
              : "In progress",
        "story-status",
      ),
    );
    open.append(text);
    const check = button(st.complete ? "✓" : "", () => setChapterComplete(q, !st.complete), "story-check");
    check.setAttribute("aria-label", (st.complete ? "Reopen " : "Mark complete: ") + q.name);
    check.setAttribute("aria-pressed", String(st.complete));
    check.title = st.complete ? "Reopen chapter" : "Mark chapter complete";
    const wiki = el("a", "Wiki ↗", "story-wiki");
    wiki.href = q.wiki;
    wiki.target = "_blank";
    wiki.rel = "noreferrer";
    card.append(open, check, wiki);
    return card;
  }
  function storyDetail(q) {
    const st = storyState(q);
    const wrap = el("div", undefined, "story-detail");
    const top = el("div", undefined, "story-banner");
    top.append(chapterArt(q, "story-art"));
    const info = el("div", undefined, "story-text");
    const meter = el("span", undefined, "meter");
    meter.append(el("i"));
    meter.firstChild.style.width = st.pct + "%";
    info.append(
      el("p", STORY_BLURB[q.name] || "", "story-blurb"),
      meter,
      el(
        "p",
        st.complete
          ? "Chapter complete"
          : st.current
            ? "You're on step " + st.stepNumber + " of " + st.list.length + " · " + st.pct + "% of the main steps done"
            : "Not started",
        "story-status",
      ),
    );
    const actions = el("div", undefined, "story-actions");
    actions.append(
      button(C.active(profile, q) ? "In this raid ✓" : "Add to raid", () => setSelected(q, !C.active(profile, q)), C.active(profile, q) ? "" : "primary"),
      button(st.complete ? "Reopen chapter" : "Mark chapter complete", () => setChapterComplete(q, !st.complete)),
      button("Reset progress", () =>
        change(() => {
          for (const o of st.list) delete profile.objectives[o.id];
          if (profile.story) delete profile.story[q.id];
          profile.completed = profile.completed.filter((id) => id !== q.id);
        }, q.name + " progress reset"),
      ),
    );
    const wiki = el("a", "Fandom guide ↗", "link-button");
    wiki.href = q.wiki;
    wiki.target = "_blank";
    wiki.rel = "noreferrer";
    actions.append(wiki);
    info.append(actions);
    top.append(info);
    wrap.append(top);
    const steps = el("ol", undefined, "story-steps");
    st.list.forEach((o, i) => {
      const done = C.progress(profile, o).done || st.complete,
        current = st.current?.id === o.id;
      const li = el("li", undefined, "story-step");
      li.dataset.state = current ? "current" : done ? "done" : "todo";
      if (o.optional) li.dataset.optional = "true";
      const pick = button("", () =>
        change(() => C.setStoryStep(profile, q, o.id), "On step " + (i + 1) + " of " + q.name),
      "story-pick");
      pick.setAttribute("aria-label", "I'm on step " + (i + 1) + ": " + o.description);
      pick.append(
        el("span", done && !current ? "✓" : String(i + 1), "step-dot"),
        el("span", o.description, "step-text"),
      );
      const meta = [];
      if (current) meta.push("You are here");
      if (o.optional) meta.push("Optional / alternative");
      if (o.placement === "off-map") meta.push("Trader, hideout or progression");
      else if (o.placement === "mapwide") meta.push("Anywhere on " + (o.maps.map((m) => mById.get(m)?.name || m).join(", ") || "any map"));
      else if (o.locations.length) meta.push(o.locations.length > 1 ? o.locations.length + " places" : mById.get(o.locations[0].map)?.name || "");
      else if (o.placement === "unverified") meta.push("No pin yet");
      if (meta.length) pick.append(el("small", meta.join(" · "), "step-meta"));
      li.append(pick);
      if (o.locations.some((l) => l.world)) {
        const go = button("Map", () => {
          closeTrader();
          focusLocation(q, o, o.locations.findIndex((l) => l.world));
        }, "step-map");
        go.setAttribute("aria-label", "Show step " + (i + 1) + " on the map");
        li.append(go);
      }
      steps.append(li);
    });
    wrap.append(steps);
    return wrap;
  }
  function traderRow(q) {
    const complete = profile.completed.includes(q.id),
      blocked = complete ? [] : C.blockers(prog, profile, q),
      tooLow = !complete && profile.level && (q.minLevel || 0) > profile.level;
    const row = el("div", undefined, "quest-row trader-row");
    row.dataset.state = complete ? "done" : blocked.length || tooLow ? "locked" : "open";
    row.dataset.focused = String(selectedQuest?.id === q.id);
    const check = el("input");
    check.type = "checkbox";
    check.checked = C.active(profile, q);
    check.disabled = complete;
    check.dataset.questCheckbox = q.id;
    check.setAttribute("aria-label", "Add " + q.name + " to this raid");
    check.onchange = () => setSelected(q, check.checked);
    // In the picker the whole name is a big click target that adds/removes the quest.
    const open = button(
      q.name,
      () => (complete ? chooseQuest(q.id) : setSelected(q, !C.active(profile, q))),
      "quest-open",
    );
    let note = complete
      ? "Done"
      : blocked.length
        ? "Needs " +
          blocked[0].name +
          (blocked.length > 1 ? " and " + (blocked.length - 1) + " more" : "")
        : tooLow
          ? "Unlocks at level " + q.minLevel
          : q.kind === "arena"
            ? "Arena"
            : q.minLevel > 1
              ? "Level " + q.minLevel
              : "Available";
    open.append(el("small", note));
    const doneBtn = button(
      complete ? "Done" : "Mark done",
      () => {
        if (complete)
          change(() => {
            profile.completed = profile.completed.filter((id) => id !== q.id);
          }, "Reopened " + q.name);
        else {
          const earlier = [...C.ancestors(prog, q)].filter((id) => !profile.completed.includes(id));
          change(
            () => {
              profile.completed.push(q.id, ...earlier);
            },
            earlier.length
              ? "Marked " +
                  q.name +
                  " and " +
                  earlier.length +
                  " earlier quest" +
                  (earlier.length > 1 ? "s" : "") +
                  " done"
              : "Marked " + q.name + " done",
          );
        }
      },
      "done-button",
    );
    doneBtn.setAttribute("aria-pressed", String(complete));
    doneBtn.title = complete
      ? "Reopen this quest"
      : "Also marks every earlier quest in this chain as done";
    row.append(check, open, doneBtn);
    return row;
  }
  function renderLibrary() {
    const oldFocus = document.activeElement?.dataset?.questCheckbox;
    const list = $("quest-list");
    list.replaceChildren();
    const searching = $("quest-search").value.trim() !== "";
    $("filters-panel").hidden = libView === "traders" && !searching;
    $("selected-total").textContent =
      data.quests.filter((q) => C.active(profile, q)).length + " selected";
    if (libView === "traders" && !searching) {
      renderTraderGrid(list);
      return;
    }
    const rows = data.quests
      .filter(matches)
      .sort(
        (a, b) =>
          Number(C.active(profile, b)) - Number(C.active(profile, a)) ||
          (a.minLevel || 0) - (b.minLevel || 0) ||
          a.name.localeCompare(b.name),
      );
    $("quest-count").textContent =
      rows.length + " quests match · " + data.quests.length + " in library";
    for (const q of rows.slice(0, listLimit)) {
      let row = el("div", undefined, "quest-row");
      row.dataset.focused = String(selectedQuest?.id === q.id);
      let check = el("input");
      check.type = "checkbox";
      check.checked = C.active(profile, q);
      check.dataset.questCheckbox = q.id;
      check.setAttribute("aria-label", "Select " + q.name);
      check.onchange = () => setSelected(q, check.checked);
      let b = button(q.name, () => chooseQuest(q.id), "quest-open");
      let complete = profile.completed.includes(q.id);
      b.append(
        el(
          "small",
          q.trader +
            " · " +
            (q.kind === "story"
              ? "Story"
              : q.kind === "arena"
                ? "Arena"
                : q.minLevel
                  ? "Level " + q.minLevel
                  : "Side quest") +
            (complete ? " · Completed" : ""),
        ),
      );
      if (q.modes.length === 1)
        b.append(el("span", q.modes[0] === "pve" ? "PvE" : "PvP", "badge blue"));
      row.append(check, b);
      list.append(row);
    }
    if (rows.length > listLimit)
      list.append(
        button(
          "Show more (" + (rows.length - listLimit) + ")",
          () => {
            listLimit += 150;
            renderLibrary();
          },
          "on-map-row",
        ),
      );
    if (!rows.length)
      list.append(
        el(
          "p",
          "No quests match these filters. Try a shorter search or clear the filters.",
          "quiet",
        ),
      );
    if (oldFocus)
      list
        .querySelector('[data-quest-checkbox="' + oldFocus + '"]')
        ?.focus({ preventScroll: true });
  }
  function itemNames(items) {
    if (items.length > 8)
      return (
        items
          .slice(0, 5)
          .map((i) => i.name)
          .join(" / ") +
        " … " +
        (items.length - 5) +
        " more eligible items"
      );
    return items.map((i) => i.name).join(" OR ");
  }
  function packingList(rows, target, keep = false) {
    target.replaceChildren();
    if (!rows.length) {
      target.append(
        el(
          "p",
          keep
            ? "No keep-items recorded for your selected objectives."
            : "No special bring-in items recorded for these objectives.",
          "quiet",
        ),
      );
      return;
    }
    let list = el("ul", undefined, "packing-list");
    for (const r of rows) {
      let name = r.choices
        ? r.label +
          ": " +
          r.choices
            .slice(0, 8)
            .map((set) => set.map((i) => i.name).join(" + "))
            .join(" OR ") +
          (r.choices.length > 8 ? " · see objective for remaining choices" : "")
        : (r.kind === "key" ? "Key · " : r.kind === "quest-item" ? "Quest inventory · " : "") +
          (r.count > 1 ? r.count + " × " : "") +
          itemNames(r.items);
      let li = el("li", name);
      if (keep && r.foundInRaid) li.append(el("small", "Must be found in raid"));
      for (const c of [...new Map(r.context.map((c) => [c.questId, c])).values()]) {
        let d = el("small");
        d.append(button(c.quest, () => chooseQuest(c.questId, c.objectiveId)));
        li.append(d);
      }
      list.append(li);
    }
    target.append(list);
  }
  function renderUpcoming() {
    const target = $("upcoming-list"),
      rows = C.upcomingHandIns(data, prog, profile);
    target.replaceChildren();
    $("upcoming-count").textContent = rows.length ? "· " + plural(rows.length, "quest") : "";
    if (!rows.length) {
      target.append(
        el(
          "p",
          profile.completed.length
            ? "Nothing coming up. Mark finished quests as done (and set your level in a trader list) to get reminders."
            : "Mark the quests you've finished as done, and this will remind you which found-in-raid items to start keeping.",
          "quiet",
        ),
      );
      return;
    }
    const list = el("ul", undefined, "packing-list upcoming-list");
    for (const r of rows) {
      const li = el("li");
      li.append(button(r.q.name, () => chooseQuest(r.q.id), "link-button upcoming-quest"));
      li.append(
        el(
          "small",
          r.kind === "level"
            ? "Unlocks at level " + r.q.minLevel + " (" + plural(r.steps, "level") + " to go)"
            : plural(r.steps, "quest") +
                " away · working on " +
                r.via.map((v) => v.name).join(", "),
          "upcoming-when",
        ),
      );
      const needs = el("ul", undefined, "upcoming-needs");
      for (const o of r.need) {
        const items = (o.keep || []).flatMap((k) => k.items || []);
        const left = o.count - ((profile.objectives[o.id] || {}).count || 0);
        needs.append(
          el(
            "li",
            left +
              " × " +
              (items.length ? itemNames(items) : o.description) +
              " (found in raid)",
          ),
        );
      }
      li.append(needs);
      list.append(li);
    }
    target.append(list);
  }
  function renderPack() {
    renderUpcoming();
    const pack = C.packing(data, profile, map.id);
    packingList(pack.bring, $("pack"));
    packingList(pack.keep, $("keep-list"), true);
    $("pack-count").textContent = pack.bring.length ? "· " + plural(pack.bring.length, "item") : "";
    $("keep-count").textContent = pack.keep.length ? "· " + pack.keep.length : "";
    const gaps = C.entries(data, profile, map.id).filter(
      ({ q, o }) =>
        ["wiki", "story", "reference"].includes(o.type) &&
        o.placement !== "off-map" &&
        !o.bring.length &&
        !o.gear.length &&
        !o.keys.length,
    );
    if (gaps.length)
      $("pack").append(
        el(
          "p",
          "Some story/wiki-only steps have incomplete equipment data. Check their Fandom guide before deploying.",
          "warning-note",
        ),
      );
  }
  // Bottom-right of the map: unfinished objectives on this map that have no pin
  // (kill counts, found-in-raid items, unpinned steps), always visible while you play.
  function renderOther() {
    const box = $("map-todo"),
      otherMaps = data.maps.filter((m) => m.id !== map.id && !map.name.includes(m.name)),
      rows = C.entries(data, profile, map.id).filter(
        ({ o }) =>
          (o.placement === "mapwide" || o.placement === "unverified") &&
          // "...on Shoreline" belongs to that map even when the data doesn't say so.
          (o.maps.includes(map.id) ||
            !otherMaps.some((m) => new RegExp("\\b" + m.name + "\\b", "i").test(o.description))),
      );
    box.replaceChildren();
    box.hidden = !rows.length;
    if (!rows.length) return;
    box.append(overlayHead("todo", "No pin · still to do", rows.length));
    if (overlayMin.todo) return;
    const list = el("ul", undefined, "todo-list");
    for (const { q, o } of rows) {
      const left = C.remaining(profile, o);
      const li = el("li");
      const b = button("", () => chooseQuest(q.id, o.id), "todo-row");
      b.append(
        el("span", (left > 1 ? left + "× " : "") + shortObjective(o.description), "todo-what"),
        el("span", q.name + (o.placement === "unverified" ? " · not pinned yet" : ""), "todo-quest"),
      );
      li.append(b);
      list.append(li);
    }
    box.append(list);
  }
  // "Eliminate any target on Customs" -> "Eliminate any target" (the map is already on screen).
  function shortObjective(text) {
    return text
      .replace(new RegExp("\\s+(on|at|in)\\s+" + map.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"), "")
      .replace(/^Find (the item )?in raid: /i, "Find FIR: ")
      .replace(/found in raid/gi, "FIR");
  }
  function overlayHead(key, title, count) {
    const head = el("div", undefined, "overlay-head");
    head.append(el("strong", title + (count != null ? " · " + count : "")));
    const t = button(overlayMin[key] ? "+" : "–", () => {
      overlayMin[key] = !overlayMin[key];
      try {
        localStorage.setItem("tarkov-atlas-overlays", JSON.stringify(overlayMin));
      } catch {}
      renderOther();
      renderBosses();
    }, "overlay-toggle");
    t.setAttribute("aria-label", (overlayMin[key] ? "Show " : "Hide ") + title);
    head.append(t);
    return head;
  }
  // Top-left of the map: boss and cultist spawn chances for the profile's game mode.
  function renderBosses() {
    const box = $("boss-legend"),
      B = window.TARKOV_BOSSES;
    box.replaceChildren();
    if (!B) return (box.hidden = true);
    const mode = profile.mode === "regular" ? "regular" : "pve",
      rows = B[mode][map.id] || [];
    box.hidden = false;
    box.append(overlayHead("bosses", "Bosses · " + (mode === "pve" ? "PvE" : "PvP")));
    if (overlayMin.bosses) return;
    if (!rows.length) {
      box.append(el("p", "No bosses on this map", "boss-none"));
      return;
    }
    const list = el("ul", undefined, "boss-list");
    for (const [mob, chances, variant] of rows) {
      const name = B.names[mob] || mob;
      const pct = chances.map((c) => Math.round(c * 100) + "%").join(" + ");
      const note =
        variant === "night"
          ? "Night Factory"
          : variant === "21"
            ? "Ground Zero 21+"
            : variant === "dark"
              ? "Lab · night"
              : mob === "sectantPriest"
                ? "night only"
                : "";
      const li = el("li");
      li.append(el("span", name, "boss-name"), el("span", pct, "boss-pct"));
      if (note) li.append(el("small", note, "boss-note"));
      list.append(li);
    }
    box.append(list, el("small", "Spawn chance per raid · tarkov.dev, " + B.updated, "boss-src"));
  }
  // Quest progress counters above the map.
  function renderCounters() {
    const mode = profile.mode === "regular" ? "regular" : "pve",
      inMode = (q) => !q.modes?.length || q.modes.includes(mode),
      done = new Set(profile.completed);
    const kappa = data.quests.filter((q) => q.kappa && inMode(q)),
      all = data.quests.filter((q) => q.kind !== "story" && q.kind !== "arena" && inMode(q));
    const box = $("progress-counters");
    box.replaceChildren();
    for (const [label, list, cls] of [
      ["Kappa", kappa, "kappa"],
      ["Quests", all, "all"],
    ]) {
      const n = list.filter((q) => done.has(q.id)).length;
      const c = el("div", undefined, "counter " + cls);
      c.title = n + " complete, " + (list.length - n) + " remaining";
      c.append(
        el("span", label, "counter-label"),
        el("strong", n + "/" + list.length),
        el("span", list.length - n + " left", "counter-left"),
      );
      box.append(c);
    }
    // When the daily refresh last pulled quest data from tarkov.dev.
    if (data.snapshotDate) {
      const d = el("span", "Data " + fmtDate(data.snapshotDate), "data-date");
      d.title = "Quest data last refreshed from tarkov.dev on " + data.snapshotDate + ". Updates daily.";
      box.append(d);
    }
  }
  function fmtDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function renderLayerToggles() {
    const box = $("layer-toggles");
    box.replaceChildren();
    const lootHere = window.TARKOV_LOOT?.[map.id] || {};
    for (const [key, label, color] of LAYERS) {
      const count =
        key === "extracts"
          ? (map.extracts || []).filter((e) => e.position && e.faction !== "scav").length
          : key === "rooms"
            ? (map.lootRooms || []).length
            : (lootHere[key] || []).length;
      const b = button("", () => {
        layers[key] = !layers[key];
        try {
          localStorage.setItem(LAYER_KEY, JSON.stringify(layers));
        } catch {}
        renderLayerToggles();
        draw();
      }, "layer-chip");
      b.style.setProperty("--chip", color);
      b.setAttribute("aria-pressed", String(Boolean(layers[key])));
      b.disabled = !count;
      b.append(el("i"), el("span", label), el("small", String(count)));
      box.append(b);
    }
  }
  function renderFloorButtons() {
    const box = $("floor-buttons");
    box.replaceChildren();
    if (map.floors.length < 2) return;
    const opts = [["all", "All"], ...map.floors.map((f) => [f.id, f.name.replace(" / main", "").replace(/ Floor$/, "").replace(/ Level$/, "")])];
    for (const [id, name] of opts) {
      const b = button(name, () => setMap(map.id, { floor: id }));
      b.setAttribute("aria-pressed", String(floor === id));
      box.append(b);
    }
  }
  // Pack / Keep / Coming up live under the map while a quest is open, and move into the
  // right-hand panel when nothing is selected.
  function placeLists() {
    const lists = $("raid-lists"),
      target = selectedQuest ? $("bottom-dock") : $("side-dock");
    if (lists.parentElement !== target) target.append(lists);
    $("bottom-dock").hidden = !selectedQuest;
    lists.classList.toggle("docked-side", !selectedQuest);
  }
  // ---- Objective photos ----
  const isWikiImage = (u) => /^https:\/\/static\.wikia\.nocookie\.net\//.test(u || "");
  // Bump PHOTO_VERSION if browsers have cached bad copies (e.g. Fandom's hotlink placeholder).
  const PHOTO_VERSION = 2;
  const photoUrl = (u) =>
    isWikiImage(u) ? u + (u.includes("?") ? "&" : "?") + "v=" + PHOTO_VERSION : u;
  function photoImg(photo, alt, large) {
    const im = el("img");
    im.referrerPolicy = "no-referrer"; // Fandom blocks hotlinked images that carry a referrer
    im.src = photoUrl(isWikiImage(photo.thumb) && !large ? photo.thumb : photo.src);
    im.alt = photo.caption || alt;
    im.loading = "lazy";
    im.onerror = () => (im.hidden = true);
    return im;
  }
  // Spot photos (the exact place) come before overview maps.
  function orderedPhotos(q, refs) {
    const list = refs.map((i) => q.photos[i]).filter(Boolean);
    return [...list.filter((p) => p.kind !== "map"), ...list.filter((p) => p.kind === "map")];
  }
  let viewer = { list: [], index: 0, quest: null };
  function openPhoto(q, list, index) {
    viewer = { list, index, quest: q };
    showViewerPhoto();
    $("photo-dialog").showModal();
  }
  function showViewerPhoto() {
    const p = viewer.list[viewer.index];
    const box = $("photo-view");
    box.replaceChildren(photoImg(p, viewer.quest.name, true));
    $("photo-caption").textContent = p.caption || viewer.quest.name;
    $("photo-count").textContent =
      viewer.list.length > 1 ? viewer.index + 1 + " of " + viewer.list.length : "";
    $("photo-source").href = p.src;
    $("photo-prev").hidden = $("photo-next").hidden = viewer.list.length < 2;
  }
  function stepPhoto(d) {
    viewer.index = (viewer.index + d + viewer.list.length) % viewer.list.length;
    showViewerPhoto();
  }
  function objectivePhotos(q, o) {
    const list = orderedPhotos(q, o.photoRefs || []);
    if (!list.length) return null;
    const focused = selectedObjective === o.id;
    const wrap = el("div", undefined, focused ? "objective-photos open" : "objective-photos");
    list.forEach((p, i) => {
      if (!focused && i >= 3) return;
      const fig = el("figure", undefined, p.kind === "map" ? "is-map" : "");
      const b = button("", () => openPhoto(q, list, i), "photo-button");
      b.setAttribute("aria-label", "View full size: " + (p.caption || q.name));
      b.append(photoImg(p, q.name, false));
      fig.append(b);
      if (focused) fig.append(el("figcaption", p.caption || ""));
      wrap.append(fig);
    });
    if (!focused)
      wrap.append(
        button(
          list.length > 3 ? "Show all " + list.length + " photos" : "Show photos",
          () => chooseQuest(q.id, o.id),
          "link-button photo-more",
        ),
      );
    return wrap;
  }
  function objectiveCard(q, o) {
    let card = el("div", undefined, "objective"),
      remaining = C.remaining(profile, o),
      s = C.progress(profile, o);
    card.dataset.focused = String(selectedObjective === o.id);
    card.dataset.objective = o.id;
    if (remaining === 0) card.classList.add("done");
    let top = el("div", undefined, "objective-head"),
      check = el("input");
    check.type = "checkbox";
    check.checked = remaining === 0;
    check.id = "objective-" + o.id;
    check.onchange = () =>
      change(
        () => {
          profile.objectives[o.id] = {
            ...s,
            done: check.checked,
            count: check.checked ? o.count : 0,
          };
        },
        check.checked ? "Objective complete" : "Objective reopened",
      );
    let label = el("label", o.description);
    label.htmlFor = check.id;
    top.append(check, label);
    card.append(top);
    let note =
      o.placement === "mapwide"
        ? "Mapwide · no fixed marker"
        : o.placement === "off-map"
          ? "Trader, hideout, or progression"
          : o.placement === "unverified"
            ? "Location awaiting verification · no guessed pin"
            : o.locations.length && o.locations.every((l) => l.kind === "area")
              ? "Approximate area near " +
                (o.locations[0].anchor || "a landmark") +
                " · use the photos for the exact spot"
              : o.locations.some((l) => l.kind === "spot")
                ? "Pin marks the spot from the wiki map" +
                  (o.locations.length > 1 ? " · pick one of the options below" : "")
              : o.locations.some((l) => l.kind === "door")
                ? "Locked door · pin marks the door" +
                  (o.locations.length > 1 ? " · pick one of the options below" : "")
                : o.locations.some((l) => ["transit", "extract", "switch"].includes(l.kind))
                  ? "Pin marks the " + o.locations.find((l) => ["transit", "extract", "switch"].includes(l.kind)).kind
                  : o.locations.some((l) => l.kind === "entrance")
              ? "Room entrance locator · use the photo for the stash surface"
              : o.locations.some((l) => l.kind === "spawn")
                ? "Possible item spawn" + (o.locations.length > 1 ? "s · check alternatives" : "")
                : "Objective zone · marker shows the zone centre";
    if (o.optional) note += " · Optional";
    if (s.hidden) note += " · Skipped for this raid";
    card.append(el("div", note, "objective-note"));
    const pics = objectivePhotos(q, o);
    if (pics) card.append(pics);
    if (o.condition) card.append(el("div", o.condition, "objective-note"));
    if (o.time)
      card.append(
        el(
          "div",
          "Required time: " +
            String(o.time[0]).padStart(2, "0") +
            ":00–" +
            String(o.time[1]).padStart(2, "0") +
            ":00",
          "objective-note",
        ),
      );
    let places = el("div", undefined, "place-buttons");
    for (const [i, l] of o.locations.entries()) {
      const mapName = mById.get(l.map)?.name || l.map;
      let label = l.label
        ? (new Set(o.locations.map((x) => x.map)).size > 1 && !l.label.startsWith(mapName.split(" ")[0])
            ? mapName + " · "
            : "") + l.label
        : mapName + (o.locations.length > 1 ? " · " + (i + 1) : "");
      places.append(button(label, () => focusLocation(q, o, i)));
    }
    if (places.childElementCount) card.append(places);
    let actions = el("div", undefined, "objective-actions");
    if (o.count > 1) {
      let input = el("input");
      input.type = "number";
      input.min = "0";
      input.max = o.count;
      input.value = s.done ? o.count : s.count || 0;
      input.setAttribute("aria-label", "Progress for " + o.description);
      input.onchange = () => {
        const n = Math.max(0, Math.min(o.count, Number(input.value) || 0));
        change(() => {
          profile.objectives[o.id] = { ...s, count: n, done: n >= o.count };
        }, "Objective progress saved");
      };
      actions.append(input, el("small", "/ " + o.count));
    }
    if (o.placement !== "off-map")
      actions.append(
        button(s.hidden ? "Include this raid" : "Skip this raid", () =>
          change(
            () => {
              profile.objectives[o.id] = { ...s, hidden: !s.hidden };
            },
            s.hidden ? "Objective included" : "Objective skipped for this raid",
          ),
        ),
      );
    card.append(actions);
    if (o.attributes?.length) {
      let details = el("details");
      details.append(el("summary", "Build requirements"));
      for (let x of o.attributes)
        details.append(
          el(
            "p",
            (x.name || x.type || "Attribute") +
              " " +
              (x.requirement?.compareMethod || x.compareMethod || "") +
              " " +
              (x.requirement?.value ?? x.value ?? ""),
            "quiet",
          ),
        );
      card.append(details);
    }
    return card;
  }
  function renderDetail() {
    const target = $("selected-detail"),
      open = new Set(
        [...target.querySelectorAll("details[open][data-key]")].map((e) => e.dataset.key),
      );
    target.replaceChildren();
    if (!selectedQuest) {
      if (!profile.selected.length) {
        let d = el("div", undefined, "welcome");
        d.append(
          el("div", "Your raid, your priorities", "eyebrow"),
          el("h2", "A plan for every playthrough."),
          el(
            "p",
            "Pick quests from the library or a trader. Their spots appear on the map and your packing list builds itself below.",
          ),
          button(
            "Browse side quests",
            () => {
              showLibrary(true);
              $("quest-search").value = "";
              $("trader-filter").value = "";
              $("kind-filter").value = "side";
              $("progress-filter").value = "unfinished";
              selectionOnly = false;
              renderTabs();
              renderLibrary();
            },
            "primary",
          ),
        );
        target.append(d);
      } else target.append(el("p", "Click a pin to open its quest here.", "quiet side-hint"));
      return;
    }
    const q = selectedQuest;
    const top = el("div", undefined, "detail-top");
    top.append(el("div", q.kind === "story" ? "Story chapter" : q.trader, "eyebrow"));
    const close = button("×", () => chooseQuest(null), "detail-close");
    close.setAttribute("aria-label", "Close quest");
    close.title = "Close (or click the pin again)";
    top.append(close);
    target.append(top, el("h2", q.name, "detail-title"));
    let os = C.objectives(q, profile.mode),
      done = os.filter((o) => C.remaining(profile, o) === 0).length;
    target.append(
      el(
        "div",
        done +
          " / " +
          os.length +
          " objectives complete" +
          (q.minLevel ? " · Unlock level " + q.minLevel : "") +
          (q.faction && q.faction !== "Any" ? " · " + q.faction : ""),
        "detail-meta",
      ),
    );
    let actions = el("div", undefined, "quest-actions");
    actions.append(
      button(
        C.active(profile, q) ? "Remove from raid" : "Select for raid",
        () => setSelected(q, !C.active(profile, q)),
        C.active(profile, q) ? "" : "primary",
      ),
    );
    let completed = profile.completed.includes(q.id);
    actions.append(
      button(completed ? "Reopen quest" : "Mark quest complete", () =>
        change(
          () => {
            profile.completed = profile.completed.filter((id) => id !== q.id);
            if (!completed) {
              profile.completed.push(q.id);
              profile.selected = profile.selected.filter((id) => id !== q.id);
            } else {
              for (let o of os) delete profile.objectives[o.id];
            }
          },
          completed ? "Quest reopened" : "Quest completed",
        ),
      ),
    );
    target.append(actions);
    target.append(link("Fandom quest guide & photos ↗", q.wiki));
    if (q.kind === "story")
      target.append(
        el(
          "p",
          "Chapters contain sequential steps and alternative branches. Skip steps you are not currently pursuing to keep this raid’s map and packing list focused.",
          "info-note",
        ),
      );
    let unresolved = os.filter((o) => o.placement === "unverified").length;
    if (unresolved)
      target.append(
        el(
          "p",
          unresolved +
            " objective" +
            (unresolved === 1 ? " has" : "s have") +
            " no verified map position yet. They are listed below with the Fandom reference.",
          "warning-note",
        ),
      );
    if (q.chapterCoverage?.partial)
      target.append(
        el(
          "p",
          "This chapter’s structured step list is partial. The Fandom guide covers the available branches; missing step text is not treated as completion.",
          "warning-note",
        ),
      );
    if (!os.length)
      target.append(
        el(
          "p",
          "Objective data is not yet available for this entry. Open the Fandom guide for its requirements.",
          "warning-note",
        ),
      );
    let objectivesWrap = el("div");
    for (const o of os) if (!o.failure) objectivesWrap.append(objectiveCard(q, o));
    target.append(objectivesWrap);
    // Photos already sit on each objective; only show the quest's photos here when none do.
    if (q.photos?.length && !os.some((o) => o.photoRefs?.length)) {
      const gallery = el("div", undefined, "photo-grid");
      orderedPhotos(q, q.photos.map((_, i) => i)).forEach((photo, i, list) => {
        const f = el("figure", undefined, photo.kind === "map" ? "is-map" : "");
        const im = photoImg(photo, q.name);
        im.onclick = () => openPhoto(q, list, i);
        f.append(im, el("figcaption", photo.caption || "Location reference"));
        gallery.append(f);
      });
      target.append(gallery);
    }
    if (q.requirements?.length) {
      const d = el("p", "Unlocked by: ", "quiet prereqs");
      q.requirements.forEach((r, i) => {
        const previous = qById.get(typeof r.task === "object" ? r.task.id : r.task);
        if (i) d.append(", ");
        if (previous) d.append(button(previous.name, () => chooseQuest(previous.id), "link-button"));
        else if (r.name) d.append(r.name);
      });
      target.append(d);
    }
    if (q.experience)
      target.append(el("p", q.experience.toLocaleString() + " base quest XP", "quiet"));
  }
  function renderAll() {
    placeLists();
    renderCounters();
    renderBosses();
    renderLayerToggles();
    renderFloorButtons();
    renderProfiles();
    renderLibrary();
    renderTraderPanel();
    renderPack();
    renderDetail();
    renderOther();
    draw();
  }
  function mapDims() {
    return map;
  }
  function fit() {
    let d = mapDims();
    scale = Math.min(width / d.width, height / d.height) * 0.96;
    offset = { x: (width - d.width * scale) / 2, y: (height - d.height * scale) / 2 };
    draw();
  }
  function resize() {
    let r = viewport.getBoundingClientRect();
    width = Math.max(1, r.width - 2);
    height = Math.max(1, r.height - 2);
    let dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fit();
  }
  function zoom(factor, x = width / 2, y = height / 2) {
    let d = mapDims(),
      min = Math.min(width / d.width, height / d.height) * 0.3,
      next = Math.min(12, Math.max(min, scale * factor)),
      ratio = next / scale;
    offset = { x: x - (x - offset.x) * ratio, y: y - (y - offset.y) * ratio };
    scale = next;
    draw();
  }
  function setMap(id, options = {}) {
    map = mById.get(id) || map;
    if (options.floor) floor = options.floor;
    else if (id !== $("map-select").value) floor = "all";
    if (floor !== "all" && !map.floors.some((f) => f.id === floor)) floor = "all";
    $("map-select").value = map.id;
    $("floor-select").replaceChildren(
      new Option("All floors · overview", "all"),
      ...map.floors.map((f) => new Option(f.name, f.id)),
    );
    $("floor-select").value = floor;
    $("floor-select").disabled = map.floors.length < 2;
    $("map-wiki").href =
      "https://escapefromtarkov.fandom.com/wiki/" +
      encodeURIComponent(map.name.replaceAll(" ", "_"));
    const image = (map.floors.find((f) => f.id === floor) || map.floors[0]).image;
    const seq = ++loadSerial;
    ready = false;
    drawnPins = [];
    let next = imageCache.get(image);
    const loaded = () => {
      if (seq !== loadSerial) return;
      img = next;
      ready = true;
      fit();
      if (options.focus) {
        let l = options.focus,
          pt = l.world ? C.project(l.world, map) : l;
        scale = Math.min(6, Math.min(width / mapDims().width, height / mapDims().height) * 3.5);
        offset = { x: width / 2 - pt.x * scale, y: height / 2 - pt.y * scale };
        draw();
      }
    };
    if (next?.complete && next.naturalWidth) loaded();
    else {
      next = new Image();
      imageCache.set(image, next);
      next.onload = loaded;
      next.onerror = () => {
        if (seq !== loadSerial) return;
        ready = false;
        toast("The map image could not load. Keep the atlas assets folder with this page.");
        $("map-status").textContent = "Map image unavailable";
      };
      next.src = image;
    }
    renderPack();
    renderOther();
    renderBosses();
    renderLayerToggles();
    renderFloorButtons();
    if ($("map-filter").value === "current") renderLibrary();
    updateHash();
  }
  function focusLocation(q, o, index) {
    if (!C.active(profile, q)) {
      profile.selected.push(q.id);
      profile.completed = profile.completed.filter((id) => id !== q.id);
      persist();
    }
    if (C.progress(profile, o).hidden) {
      profile.objectives[o.id] = { ...C.progress(profile, o), hidden: false };
      persist();
    }
    selectedQuest = q;
    selectedObjective = o.id;
    let l = o.locations[index],
      m = mById.get(l.map);
    if (!m) return;
    setMap(l.map, {
      floor: C.floorFor(l, m) || "all",
      focus: l,
    });
    renderAll();
    requestAnimationFrame(() =>
      $("selected-detail")
        .querySelector('[data-objective="' + o.id + '"]')
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }
  function screen(pt) {
    return { x: offset.x + pt.x * scale, y: offset.y + pt.y * scale };
  }
  function drawLabels() {
    if (view !== "survey") return;
    ctx.save();
    ctx.font = "500 10px system-ui";
    ctx.textAlign = "center";
    const used = [];
    for (let l of map.labels || []) {
      if (l.top != null && floor !== "all") {
        const f = map.floors.find((f) => f.id === floor);
        if (
          f?.extents?.length &&
          !f.extents.some((e) => l.top >= e.height[0] && l.bottom < e.height[1])
        )
          continue;
      }
      const pt = screen(C.project({ x: l.position[0], z: l.position[1] }, map));
      if (pt.x < 10 || pt.y < 10 || pt.x > width - 10 || pt.y > height - 10) continue;
      let w = ctx.measureText(l.text).width;
      if (used.some((u) => Math.abs(u.x - pt.x) < (u.w + w) / 2 + 8 && Math.abs(u.y - pt.y) < 20))
        continue;
      used.push({ ...pt, w });
      ctx.fillStyle = "#10100ec9";
      ctx.fillRect(pt.x - w / 2 - 3, pt.y - 8, w + 6, 15);
      ctx.fillStyle = "#d6cfba";
      ctx.fillText(l.text, pt.x, pt.y + 3);
    }
    ctx.restore();
  }
  function drawExits() {
    if (view !== "survey") return;
    ctx.save();
    ctx.font = "500 9px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const seen = [];
    for (const e of map.extracts || []) {
      if (!e.position || e.faction === "scav") continue;
      if (floor !== "all" && C.floorFor({ world: e.position }, map) !== floor) continue;
      const p = screen(C.project(e.position, map));
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      ctx.strokeStyle = "#72b3a5";
      ctx.strokeRect(p.x - 3, p.y - 3, 6, 6);
      if (scale < Math.min(width / mapDims().width, height / mapDims().height) * 1.35) continue;
      const w = ctx.measureText(e.name).width,
        x = Math.min(width - w - 8, p.x + 7),
        y = p.y;
      if (seen.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 && Math.abs(r.y - y) < 15)) continue;
      seen.push({ x, y, w });
      ctx.fillStyle = "#161613e8";
      ctx.fillRect(x - 2, y - 7, w + 5, 14);
      ctx.fillStyle = "#9ed0c1";
      ctx.fillText(e.name, x, y);
    }
    ctx.restore();
  }
  // With a floor picked, grey out the map and light up only the parts on that level.
  function drawBase() {
    const w = mapDims().width * scale,
      h = mapDims().height * scale;
    const f = floor !== "all" && floor !== map.floors[0]?.id && map.floors.find((x) => x.id === floor);
    const rects = f
      ? (f.extents || []).flatMap((e) => (e.bounds || []).map((b) => [b[0], b[1]]))
      : [];
    if (!rects.length) {
      ctx.drawImage(img, offset.x, offset.y, w, h);
      return;
    }
    ctx.save();
    ctx.filter = "grayscale(1) brightness(0.35)";
    ctx.drawImage(img, offset.x, offset.y, w, h);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    for (const [a, b] of rects) {
      const corners = [
        [a[0], a[1]],
        [b[0], a[1]],
        [b[0], b[1]],
        [a[0], b[1]],
      ].map(([x, z]) => screen(C.project({ x, z }, map)));
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
      ctx.closePath();
    }
    ctx.clip();
    ctx.drawImage(img, offset.x, offset.y, w, h);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "#e0cd98aa";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  function drawSpawns() {
    drawnLoot = [];
    const L = window.TARKOV_LOOT?.[map.id];
    if (!L) return;
    const zoomed = scale > Math.min(width / mapDims().width, height / mapDims().height) * 1.2;
    ctx.save();
    for (const [key, label, color] of LAYERS) {
      if (!layers[key] || !L[key]) continue;
      for (const [x, y, z, what] of L[key]) {
        if (floor !== "all" && C.floorFor({ world: { x, y, z } }, map) !== floor) continue;
        const p = screen(C.project({ x, z }, map));
        if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
        const r = zoomed ? 4 : 3;
        ctx.fillStyle = color;
        ctx.strokeStyle = "#10100e";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (key === "rare") {
          ctx.moveTo(p.x, p.y - r - 1);
          ctx.lineTo(p.x + r + 1, p.y);
          ctx.lineTo(p.x, p.y + r + 1);
          ctx.lineTo(p.x - r - 1, p.y);
          ctx.closePath();
        } else if (key === "meds") {
          ctx.rect(p.x - r, p.y - 1.5, r * 2, 3);
          ctx.rect(p.x - 1.5, p.y - r, 3, r * 2);
        } else if (key === "tech") ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const nice = what.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
        drawnLoot.push({ x: p.x, y: p.y, text: label + " · " + (key === "rare" ? "can spawn: " + what : nice) });
      }
    }
    ctx.restore();
  }
  function drawLoot() {
    ctx.save();
    ctx.font = "500 10px system-ui";
    ctx.textBaseline = "middle";
    for (let r of map.lootRooms || []) {
      let pt = screen(C.project(r.world, map));
      if (pt.x < 0 || pt.x > width || pt.y < 0 || pt.y > height) continue;
      ctx.fillStyle = "#ebbc73";
      ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
      if (scale > Math.min(width / mapDims().width, height / mapDims().height) * 1.6) {
        let text = r.label || r.name.replace(/ key$/, "");
        ctx.fillStyle = "#1a1916ee";
        ctx.fillRect(pt.x + 7, pt.y - 9, ctx.measureText(text).width + 7, 18);
        ctx.fillStyle = "#ebbc73";
        ctx.fillText(text, pt.x + 10, pt.y);
      }
    }
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (!ready) return;
    drawBase();
    drawLabels();
    if (layers.extracts) drawExits();
    if (layers.rooms) drawLoot();
    drawSpawns();
    let pins = C.markers(data, profile, map, view, floor);
    drawnPins = [];
    for (let pin of pins) {
      const anchor = screen(pin);
      if (anchor.x < -10 || anchor.y < -10 || anchor.x > width + 10 || anchor.y > height + 10)
        continue;
      let x = anchor.x,
        y = anchor.y;
      for (let n = 0; n < 90 && drawnPins.some((p) => Math.hypot(p.sx - x, p.sy - y) < 25); n++) {
        const angle = n * 2.399,
          r = 24 + Math.floor(n / 10) * 14;
        x = Math.max(13, Math.min(width - 13, anchor.x + Math.cos(angle) * r));
        y = Math.max(13, Math.min(height - 28, anchor.y + Math.sin(angle) * r));
      }
      drawnPins.push({ ...pin, sx: x, sy: y, ax: anchor.x, ay: anchor.y });
    }
    for (let [i, p] of drawnPins.entries()) {
      let chosen = selectedObjective === p.o.id,
        questChosen = selectedQuest?.id === p.q.id,
        color = chosen ? "#fff1c9" : questChosen ? "#e0cd98" : "#c2ae7c";
      if (chosen && p.l.outline?.length && view === "survey") {
        ctx.beginPath();
        p.l.outline.forEach((v, i) => {
          const pt = screen(C.project(v, map));
          i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fillStyle = "#efcf743c";
        ctx.fill();
        ctx.strokeStyle = "#efd490";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (p.l.kind === "area") {
        // Approximate spot: a dashed ring around the anchor instead of a hard point.
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(p.ax, p.ay, Math.max(18, 14 * scale), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.ax, p.ay);
      ctx.lineTo(p.sx, p.sy);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(p.ax - 2, p.ay - 2, 4, 4);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, chosen ? 12 : 10.5, 0, Math.PI * 2);
      ctx.fillStyle = chosen ? color : "#1a1916ec";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = chosen ? 2 : 1.3;
      ctx.stroke();
      ctx.fillStyle = chosen ? "#1a1814" : color;
      ctx.font = "600 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i + 1, p.sx, p.sy);
      p.number = i + 1;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const all = C.markers(data, profile, map, view, "all");
    const activeQs = new Set(C.entries(data, profile, map.id).map((e) => e.q.id));
    $("map-quest-count").textContent = plural(activeQs.size, "selected quest");
    $("map-status").textContent =
      plural(pins.length, "location") +
      " · " +
      (floor === "all"
        ? "all floors"
        : map.floors.find((f) => f.id === floor)?.name || "reference") +
      " · " +
      Math.round((scale / Math.min(width / mapDims().width, height / mapDims().height)) * 100) +
      "%";
    const noSelected = !data.quests.some((q) => C.active(profile, q));
    $("map-empty").hidden = !noSelected || tipDismissed || Boolean(selectedQuest);
    if (!noSelected && !all.length)
      $("map-status").textContent =
        "No selected fixed locations on this " + "map" + " · see other objectives";
  }
  function renderTabs() {
    for (const v of ["traders", "all", "selected"])
      $(v + "-tab").setAttribute("aria-pressed", String(libView === v));
  }
  function setView(v) {
    libView = v;
    if (v !== "traders") trader = null;
    renderTraderPanel();
    selectionOnly = v === "selected";
    listLimit = 150;
    renderTabs();
    renderLibrary();
  }
  function showLibrary(show) {
    $("workspace").classList.toggle("library-hidden", !show);
    $("library-toggle").setAttribute("aria-expanded", String(show));
  }
  function coverage() {
    const target = $("coverage-content");
    target.replaceChildren();
    target.append(
      el(
        "p",
        data.stats.quests +
          " entries · " +
          data.stats.pinnedObjectives +
          " objectives with locations · " +
          data.stats.coordinatePoints +
          " location records · " +
          data.stats.photos +
          " Fandom reference images.",
      ),
      el(
        "p",
        "Quest lists and objective coordinates: tarkov.dev, with Fandom’s quest index and TarkovTracker’s story catalog. Only Fandom is used for quest-guide and photo links.",
      ),
      el(
        "p",
        "Mapwide kill, collection, and survival tasks do not get fake pins. Zone centres, possible spawns, and room entrances are labelled differently. A reference gallery does not mean every coordinate was independently photo-verified.",
      ),
      el(
        "p",
        "Some story branches and newer wiki-only objectives still need coordinates. Daily and weekly operational tasks are generated, so there is no finite catalog of every possible variant.",
        "warning-note",
      ),
      link("Full Fandom quest index ↗", "https://escapefromtarkov.fandom.com/wiki/Quests"),
      el(
        "p",
        "Detailed map assets: the-hideout / tarkov.dev contributors, CC BY-NC-SA 4.0. Story catalog: TarkovTracker.org, MIT. See README for source and license details.",
      ),
    );
    target.append(el("h3", "Location checks still needed"));
    for (let q of data.quests) {
      let os = C.objectives(q, profile.mode).filter((o) => o.placement === "unverified");
      if (!os.length) continue;
      let r = el("div", undefined, "coverage-row");
      r.append(
        button(q.name + " · " + os.length, () => {
          $("coverage-dialog").close();
          chooseQuest(q.id);
        }),
        el("p", os[0].description, "quiet"),
      );
      target.append(r);
    }
    $("coverage-dialog").showModal();
  }
  $("map-select").append(...data.maps.map((m) => new Option(m.name, m.id)));
  $("trader-filter").append(
    ...[...new Set(data.quests.map((q) => q.trader))].sort().map((n) => new Option(n, n)),
  );
  for (let id of ["quest-search", "trader-filter", "kind-filter", "map-filter", "progress-filter"])
    $(id).addEventListener(id === "quest-search" ? "input" : "change", () => {
      listLimit = 150;
      renderLibrary();
    });
  $("traders-tab").onclick = () => setView("traders");
  $("photo-prev").onclick = () => stepPhoto(-1);
  $("photo-next").onclick = () => stepPhoto(1);
  $("photo-dialog").addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") stepPhoto(-1);
    if (e.key === "ArrowRight") stepPhoto(1);
  });
  $("photo-dialog").addEventListener("click", (e) => {
    if (e.target === $("photo-dialog")) $("photo-dialog").close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && trader && !document.querySelector("dialog[open]")) closeTrader();
  });
  $("all-tab").onclick = () => setView("all");
  $("selected-tab").onclick = () => setView("selected");
  $("clear-selection").onclick = () =>
    change(() => {
      profile.selected = [];
    }, "Cleared this raid’s quest selection");
  $("library-toggle").onclick = () =>
    showLibrary($("workspace").classList.contains("library-hidden"));
  $("empty-close").onclick = () => {
    tipDismissed = true;
    try {
      localStorage.setItem("tarkov-atlas-tip-dismissed", "1");
    } catch {}
    $("map-empty").hidden = true;
  };
  $("story-open").onclick = () => {
    showLibrary(true);
    if (libView !== "traders") setView("traders");
    storyChapter = null;
    openTrader("Story");
  };
  $("empty-open-library").onclick = () => {
    showLibrary(true);
    $("quest-search").focus();
  };
  $("profile-select").onchange = () => switchProfile($("profile-select").value);
  $("profiles-button").onclick = () => {
    renderProfiles();
    $("profiles-dialog").showModal();
  };
  $("coverage-button").onclick = coverage;
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
  $("new-profile-form").onsubmit = (e) => {
    e.preventDefault();
    let p = C.newProfile($("new-profile-name").value.trim(), $("new-profile-mode").value);
    state.profiles.push(p);
    $("new-profile-name").value = "";
    switchProfile(p.id);
  };
  $("export-backup").onclick = () => {
    let url = URL.createObjectURL(
        new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
      ),
      a = el("a");
    a.href = url;
    a.download = "tarkov-atlas-profiles-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Profile backup exported");
  };
  $("import-backup").onclick = () => $("import-file").click();
  $("import-file").onchange = async () => {
    let f = $("import-file").files[0];
    if (!f) return;
    try {
      if (f.size > 5000000) throw Error("Backup is too large.");
      let incoming = C.validateState(JSON.parse(await f.text()), data);
      change(
        () => {
          for (let p of incoming.profiles) {
            if (state.profiles.some((e) => e.id === p.id)) {
              p.id = C.newProfile("").id;
              p.name += " (imported)";
            }
            state.profiles.push(p);
          }
        },
        "Imported " + incoming.profiles.length + " profiles",
      );
    } catch (e) {
      toast("Import failed: " + e.message);
    }
    $("import-file").value = "";
  };
  $("undo-button").onclick = () => {
    if (!undoState) return;
    state = JSON.parse(undoState);
    profile = state.profiles.find((p) => p.id === state.activeProfile) || state.profiles[0];
    undoState = null;
    persist();
    renderAll();
    toast("Change undone");
  };
  $("map-select").onchange = () => setMap($("map-select").value, { floor: "all" });
  $("floor-select").onchange = () => {
    floor = $("floor-select").value;
    setMap(map.id, { floor });
  };
  $("zoom-in").onclick = () => zoom(1.5);
  $("zoom-out").onclick = () => zoom(1 / 1.5);
  $("fit").onclick = fit;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (drag) {
      offset.x += e.clientX - drag.x;
      offset.y += e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      $("map-tip").hidden = true;
      draw();
      return;
    }
    hoverPin = drawnPins.find((p) => Math.hypot(p.sx - x, p.sy - y) < 14);
    const hoverLoot = hoverPin ? null : drawnLoot.find((p) => Math.hypot(p.x - x, p.y - y) < 7);
    canvas.style.cursor = hoverPin ? "pointer" : "grab";
    let tip = $("map-tip");
    tip.hidden = !hoverPin && !hoverLoot;
    if (hoverPin || hoverLoot) {
      tip.textContent = hoverPin ? hoverPin.q.name + " · " + hoverPin.o.description : hoverLoot.text;
      tip.style.left = Math.max(6, Math.min(width - 290, x + 16)) + "px";
      tip.style.top = Math.max(6, Math.min(height - 100, y + 16)) + "px";
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (drag && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) {
      let r = canvas.getBoundingClientRect(),
        p = drawnPins.find(
          (p) => Math.hypot(p.sx - (e.clientX - r.left), p.sy - (e.clientY - r.top)) < 14,
        );
      if (p) {
        // Clicking the open quest's pin again closes it.
        if (selectedQuest?.id === p.q.id && selectedObjective === p.o.id) chooseQuest(null);
        else chooseQuest(p.q.id, p.o.id);
      }
    }
    drag = null;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("pointerleave", () => ($("map-tip").hidden = true));
  new ResizeObserver(resize).observe(viewport);
  window.addEventListener("hashchange", () => {
    let h = new URLSearchParams(location.hash.slice(1));
    if (h.get("map")) setMap(h.get("map"));
    if (h.get("quest")) chooseQuest(h.get("quest"), h.get("objective"));
  });
  if (hash.get("quest")) selectedQuest = qById.get(hash.get("quest")) || null;
  // planner.html#view=story opens the story chapters page (linked from the home page).
  if (hash.get("view") === "story") requestAnimationFrame(() => $("story-open").click());
  selectedObjective = hash.get("objective");
  renderAll();
  setMap(map.id);
  persist();
  if (storageFailed) toast("Import or export a backup if browser storage is unavailable.");
})();
