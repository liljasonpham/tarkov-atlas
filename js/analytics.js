// Visit counting with GoatCounter (free, no cookies, no personal data).
// 1. Make an account at https://www.goatcounter.com/signup and pick a code, e.g. "tarkovatlas".
// 2. Put that code below. Leave it empty to turn counting off.
// 3. To show the total on the home page, turn on
//    Settings -> "Allow adding visitor counts on your website" in GoatCounter.
(function () {
  "use strict";
  const GOATCOUNTER_CODE = "";
  if (!GOATCOUNTER_CODE || location.protocol === "file:" || /^(localhost|127\.)/.test(location.hostname))
    return;
  const base = "https://" + GOATCOUNTER_CODE + ".goatcounter.com";
  const s = document.createElement("script");
  s.async = true;
  s.src = "//gc.zgo.at/count.js";
  s.dataset.goatcounter = base + "/count";
  document.head.append(s);

  // Home page: "1,234 visits" in the footer.
  const out = document.getElementById("visit-count");
  if (!out) return;
  fetch(base + "/counter/TOTAL.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?.count) return;
      out.textContent = d.count + " visits so far";
      out.hidden = false;
    })
    .catch(() => {});
})();
