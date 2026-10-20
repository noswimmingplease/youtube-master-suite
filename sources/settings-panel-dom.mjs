// Static, owned UI built with native DOM methods, not Trusted Types HTML sinks.
// Keep this factory self-contained: the builder embeds it in the userscript.
export function createSettingsDialog(document) {
  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === true) node.setAttribute(name, "");
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    node.append(...children);
    return node;
  }
  const id = name => `ytms-${name}`;
  const button = (name, label, className = "text-button", attributes = {}) =>
    element("button", { id: id(name), type: "button", class: className, ...attributes }, label);
  const note = text => element("p", { class: "section-note" }, text);
  const row = (name, label, control, description = "", attributes = {}) =>
    element("div", { class: "row", ...attributes },
      element("label", { for: id(name) }, label,
        ...(description ? [element("span", { class: "description" }, description)] : [])), control);
  const select = (name, options) => element("select", { id: id(name) },
    ...options.map(([value, label]) => element("option", { value }, label)));
  const toggle = (name, label, description) => row(name, label,
    element("input", { id: id(name), class: "switch", type: "checkbox", role: "switch" }), description);
  const colourRow = (name, label, example) => element("div", { class: "colour-row" },
    element("label", { for: id(`${name}-hex`) }, label),
    button(`${name}-swatch`, "", "swatch", {
      "aria-label": `Choose ${name === "viewer" ? "viewer" : "uploader"} colour`,
      "aria-expanded": "false", "aria-controls": id("colour-picker"),
    }),
    element("input", {
      id: id(`${name}-hex`), class: "hex", type: "text", maxlength: "7",
      spellcheck: "false", autocomplete: "off", "aria-describedby": id(`${name}-error`),
      "aria-label": `${name === "viewer" ? "Viewer" : "Uploader"} colour hex code`,
    }),
    element("p", { class: "field-error", id: id(`${name}-error`), hidden: true },
      `Enter a six-digit hex colour, for example ${example}.`));
  const channel = name => element("div", { class: "channel" },
    element("label", { for: id(name) }, name[0].toUpperCase() + name.slice(1)),
    element("input", { id: id(name), type: "range", min: "0", max: "255", step: "1" }),
    element("output", { for: id(name), id: id(`${name}-value`) }));
  const comments = element("section", {
    id: id("section-comments"), role: "tabpanel", "aria-labelledby": id("tab-comments"),
  },
    row("colour-mode", "Name colours", select("colour-mode", [
      ["default", "Default"], ["preset", "Preset palette"], ["custom", "Custom"], ["off", "Off · YouTube styling"],
    ]), "Viewer names, uploader names and creator/pinned badges."),
    row("palette", "Palette", select("palette", [
      ["teal-coral", "Teal / coral"], ["lavender-gold", "Lavender / gold"], ["cyan-rose", "Cyan / rose"],
    ]), "Theme-adaptive colours for viewer and uploader names.", { id: id("palette-row"), hidden: true }),
    element("div", { class: "colour-rows", id: id("custom-colours"), hidden: true },
      colourRow("viewer", "Viewer name", "#82A3E6"), colourRow("owner", "Uploader and pinned badges", "#FF9F1C")),
    element("div", { class: "picker", id: id("colour-picker"), role: "group", "aria-labelledby": id("picker-title"), hidden: true },
      element("div", { class: "picker-heading" },
        element("h3", { id: id("picker-title") }, "Choose colour"), button("close-picker", "Done")),
      ...["red", "green", "blue"].map(channel),
      note("This picker is part of the panel, so it follows the same dark or light theme. No system colour dialogue opens.")),
    element("div", { class: "preview", id: id("comment-preview"), "aria-label": "Comment colour preview" },
      element("div", { class: "pin" }, "⌖ Pinned by @ChannelOwner"),
      element("span", { class: "name owner" }, "@ChannelOwner"), element("time", {}, "1 hour ago"),
      element("p", {}, "A preview of the uploader's comment."),
      element("span", { class: "name viewer" }, "@Viewer"), element("time", {}, "20 minutes ago"),
      element("p", {}, "A preview of an ordinary viewer's comment.")),
    element("p", { id: id("contrast-warning"), class: "warning", hidden: true },
      "One or both colours have low contrast against this background. Consider a different colour."),
    toggle("compactComments", "Compact spacing", "Keep the suite's current tighter comment layout."),
    toggle("hideCommentControls", "Hide comment controls", "Likes, dislikes, reply, action menu and composer. Existing replies remain readable."),
    note("Off changes name styling only. Comment-loading and navigation safeguards remain enabled."));
  return element("dialog", {
    id: id("settings-dialog"), lang: "en-GB", "aria-labelledby": id("panel-title"),
  }, element("div", { class: "panel" },
    element("div", { class: "panel-header" }, element("h2", { id: id("panel-title") }, "Suite settings"),
      button("close-panel", "×", "icon-button close", { "aria-label": "Close settings" })),
    element("nav", { role: "tablist", "aria-label": "Settings sections" }),
    element("div", { class: "content" }, comments,
      ...["feed", "channels", "player", "layout", "miniplayer", "interface", "extensions", "credits"].map(name => element("section", {
        id: id(`section-${name}`), role: "tabpanel", "aria-labelledby": id(`tab-${name}`), hidden: true,
      })),
      element("p", { id: id("button-access-error"), class: "field-error", role: "alert", hidden: true }, "Keep at least one settings button enabled.")),
    element("footer", {}, button("restore-section-defaults", "Restore this section"),
      button("restore-defaults", "Restore all settings"), element("span", { class: "spacer" }),
      element("div", { class: "footer-actions" }, button("cancel-panel", "Cancel"),
        element("p", { id: id("settings-status"), role: "status", hidden: true }),
        button("save-preview", "Save", "text-button primary")))));
}
