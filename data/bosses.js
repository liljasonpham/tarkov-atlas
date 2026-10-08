// Boss and cultist spawn chances per map, from tarkov.dev (json.tarkov.dev/{pve,regular}/maps),
// snapshot 8 October 2026. A boss listed with several values has separate spawn groups.
// Which bosses spawn on which map follows the Fandom wiki (tarkov.dev files Glukhar under
// Lighthouse; the wiki has him on Reserve and Terminal). Cultists spawn at night only. "night" = Night Factory, "21" = Ground Zero 21+.
window.TARKOV_BOSSES = {
  updated: "2026-10-08",
  names: {
    bossBully: "Reshala", bossKnight: "The Goons", bossPartisan: "Partisan",
    sectantPriest: "Cultists", bossKojaniy: "Shturman", bossZryachiy: "Zryachiy",
    bossGluhar: "Glukhar", bossSanitar: "Sanitar", bossKilla: "Killa", bossTagilla: "Tagilla",
    bossBoar: "Kaban", bossKolontay: "Kollontay", bossTagillaAgro: "Shadow of Tagilla",
    bossWedge: "The Wedge", bossWedgeLab: "The Wedge"
  },
  pve: {
    factory: [["bossTagilla",[0.5]],["bossTagilla",[0.75],"night"],["sectantPriest",[0.12],"night"]],
    customs: [["bossBully",[0.75]],["bossKnight",[0.25]],["bossPartisan",[0.15]],["sectantPriest",[0.3]]],
    woods: [["bossKojaniy",[0.75]],["bossKnight",[0.25]],["bossPartisan",[0.15]],["sectantPriest",[0.3]]],
    lighthouse: [["bossZryachiy",[1]],["bossKnight",[0.3]],["bossPartisan",[0.15]]],
    shoreline: [["bossSanitar",[0.75]],["bossKnight",[0.3]],["bossPartisan",[0.15]],["sectantPriest",[0.25]]],
    reserve: [["bossGluhar",[1]]],
    interchange: [["bossKilla",[0.75]],["bossTagilla",[0.5]]],
    "streets-of-tarkov": [["bossBoar",[0.75]],["bossKolontay",[0.75]]],
    "ground-zero": [["sectantPriest",[0.02],"21"]],
    terminal: [["bossKilla",[0.2]],["bossGluhar",[0.2]],["bossBully",[0.2]],["bossSanitar",[0.2]],["bossTagilla",[0.2]]],
    "the-labyrinth": [["bossTagillaAgro",[1]]],
    icebreaker: [["bossKnight",[1]],["bossWedge",[1]]],
    "the-lab": [["bossWedgeLab",[1],"dark"]]
  },
  regular: {
    factory: [["bossTagilla",[0.35]],["bossTagilla",[0.6],"night"],["sectantPriest",[0.08],"night"]],
    customs: [["bossBully",[0.6]],["bossKnight",[0.2]],["bossPartisan",[0.15]],["sectantPriest",[0.2]]],
    woods: [["bossKojaniy",[0.6]],["bossKnight",[0.2]],["bossPartisan",[0.15]],["sectantPriest",[0.2]]],
    lighthouse: [["bossZryachiy",[1]],["bossKnight",[0.2]],["bossPartisan",[0.15]]],
    shoreline: [["bossSanitar",[0.6]],["bossKnight",[0.2]],["bossPartisan",[0.15]],["sectantPriest",[0.17]]],
    reserve: [["bossGluhar",[1]]],
    interchange: [["bossKilla",[0.6]],["bossTagilla",[0.35]]],
    "streets-of-tarkov": [["bossBoar",[0.6]],["bossKolontay",[0.6]]],
    "ground-zero": [["sectantPriest",[0.02],"21"]],
    terminal: [["bossKilla",[0.2]],["bossGluhar",[0.2]],["bossBully",[0.2]],["bossSanitar",[0.2]],["bossTagilla",[0.2]]],
    "the-labyrinth": [["bossTagillaAgro",[1]]],
    icebreaker: [["bossKnight",[1]],["bossWedge",[1]]],
    "the-lab": [["bossWedgeLab",[0.33],"dark"]]
  }
};
