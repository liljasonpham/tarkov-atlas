#!/usr/bin/env node
// After the daily refresh: if a data file only changed its "updated on" date, put the old file
// back, so the site doesn't get a new commit every day when nothing in the game changed.
// Used by .github/workflows/update-data.yml. Prints "changed" or "unchanged".
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILES = ["data/catalog.js", "data/bosses.js", "data/loot.js"];
const noDates = (s) => s.replace(/\d{4}-\d{2}-\d{2}/g, "DATE");

let changed = false;
for (const file of FILES) {
  let old;
  try {
    old = execFileSync("git", ["show", "HEAD:" + file], { encoding: "utf8", maxBuffer: 1 << 28 });
  } catch {
    changed = true; // new file
    continue;
  }
  const now = fs.readFileSync(file, "utf8");
  if (now === old) continue;
  if (noDates(now) === noDates(old)) fs.writeFileSync(file, old);
  else changed = true;
}
console.log(changed ? "changed" : "unchanged");
