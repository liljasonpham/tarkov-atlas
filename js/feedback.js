// "Leave feedback": a small form that turns into a GitHub issue on the project repo, so every
// report lands in one place (github.com/<repo>/issues). No server and no email: the form opens
// GitHub's "new issue" page with the title and text already filled in. People without a GitHub
// account can copy the text instead.
// Any element with data-feedback opens it. Pages can pass extra context with
// window.AtlasFeedback.context = () => ({ Map: "...", Quest: "..." }).
(function () {
  "use strict";
  const REPO = "liljasonpham/tarkov-atlas";
  const TYPES = [
    ["pin", "Wrong or missing pin", "Which objective, and where should the pin be?"],
    ["bug", "Something's broken", "What did you do, and what happened?"],
    ["idea", "Idea or request", "What would make this more useful for your raids?"],
    ["other", "Something else", "What's on your mind?"],
  ];
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  let dialog, form, typeBox, text, ctxBox, status, extra = {};

  function build() {
    typeBox = el("div", { className: "fb-types", role: "radiogroup" });
    TYPES.forEach(([id, label], i) => {
      const input = el("input", { type: "radio", name: "fb-type", value: id, checked: i === 0 });
      input.addEventListener("change", () => (text.placeholder = TYPES.find((t) => t[0] === id)[2]));
      typeBox.append(el("label", { className: "fb-type" }, input, el("span", { textContent: label })));
    });
    text = el("textarea", { id: "fb-text", rows: 6, maxLength: 4000, placeholder: TYPES[0][2], required: true });
    ctxBox = el("p", { className: "fb-context" });
    status = el("p", { className: "fb-status", role: "status" });
    const send = el("button", { type: "submit", className: "fb-primary", textContent: "Send on GitHub" });
    const copy = el("button", { type: "button", textContent: "Copy text instead" });
    copy.addEventListener("click", copyText);
    const close = el("button", { type: "button", className: "fb-close", textContent: "×", ariaLabel: "Close" });
    close.addEventListener("click", () => dialog.close());

    form = el(
      "form",
      { method: "dialog" },
      el("div", { className: "fb-head" }, el("h2", { textContent: "Leave feedback" }), close),
      el("p", {
        className: "fb-lede",
        textContent: "Wrong pin, a bug, or an idea. Every report gets read.",
      }),
      typeBox,
      el("label", { className: "fb-label", htmlFor: "fb-text", textContent: "Details" }),
      text,
      ctxBox,
      el("div", { className: "fb-actions" }, send, copy),
      el("p", {
        className: "fb-note",
        textContent:
          "“Send on GitHub” opens a new tab with your report filled in; press Create there to post it (needs a free GitHub account, and the report is public). No account? Copy the text and post it in the Reddit thread instead.",
      }),
      status,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendToGitHub();
    });
    dialog = el("dialog", { className: "fb-dialog", ariaLabel: "Leave feedback" }, form);
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
    document.body.append(dialog);
  }

  function context() {
    const c = { Page: location.pathname.split("/").pop() || "home" };
    try {
      Object.assign(c, window.AtlasFeedback.context?.() || {});
    } catch {}
    Object.assign(c, extra);
    c.Browser = navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 140);
    return c;
  }
  function report() {
    const type = TYPES.find((t) => t[0] === (form.querySelector("input:checked")?.value || "other"));
    const body = text.value.trim();
    const c = context();
    const firstLine = body.split("\n")[0].slice(0, 70);
    const title = "[" + type[1] + "] " + (c.Quest ? c.Quest + ": " : "") + (firstLine || "Feedback");
    const lines = Object.entries(c)
      .filter(([, v]) => v)
      .map(([k, v]) => "- **" + k + ":** " + v);
    return { title, body: body + "\n\n---\n" + lines.join("\n") + "\n\n_Sent from the Tarkov Atlas feedback form._" };
  }
  function sendToGitHub() {
    if (!text.value.trim()) {
      text.focus();
      return;
    }
    const r = report();
    const url =
      "https://github.com/" + REPO + "/issues/new?title=" + encodeURIComponent(r.title) + "&body=" + encodeURIComponent(r.body);
    window.open(url, "_blank", "noopener");
    status.textContent = "Opened GitHub in a new tab. Press “Create” there to send it. Thanks!";
  }
  async function copyText() {
    if (!text.value.trim()) {
      text.focus();
      return;
    }
    const r = report();
    try {
      await navigator.clipboard.writeText(r.title + "\n\n" + r.body);
      status.textContent = "Copied. Paste it wherever you found the site (Reddit, Discord). Thanks!";
    } catch {
      status.textContent = "Couldn't copy automatically. Select the text above and copy it.";
    }
  }

  function open(opts = {}) {
    if (!dialog) build();
    extra = opts.context || {};
    status.textContent = "";
    const type = opts.type || "pin";
    const radio = form.querySelector('input[value="' + type + '"]');
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
    }
    if (opts.text != null) text.value = opts.text;
    const c = context();
    delete c.Browser;
    const shown = Object.entries(c).filter(([k, v]) => v && k !== "Page" && k !== "Link");
    ctxBox.textContent = shown.length ? "Attached: " + shown.map(([k, v]) => k + " " + v).join(" · ") : "";
    dialog.showModal();
    text.focus();
  }

  window.AtlasFeedback = Object.assign(window.AtlasFeedback || {}, { open });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-feedback]");
    if (!t) return;
    e.preventDefault();
    open({ type: t.dataset.feedback || "pin" });
  });
})();
