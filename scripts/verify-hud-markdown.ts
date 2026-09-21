import { parseHudMarkdown, parseInline } from "../lib/hud-markdown";

const sample = `**Aktueller Status der Projekte**

1. **Neue Business-Idee**
   Neues Projekt basierend auf einer offenen Marktchance.

2. **Testprojekt Alpha**
   Projektstart im November.

3. **Projekt X**
   Aktives Vorhaben für den nächsten Quartalszyklus.

Mehr dazu auf [RankPilot](https://rankpilot.de).`;

const blocks = parseHudMarkdown(sample);
const inline = parseInline("Siehe **Neue Business-Idee** und **Testprojekt Alpha**.");
const serialized = JSON.stringify(blocks);

const withColon = parseHudMarkdown("1. **Neue Business-Idee**: Neues Projekt basierend auf einer offenen Marktchance.");
const colonBody = withColon.find((block) => block.type === "list")?.items[0]?.body[0];
const colonText = JSON.stringify(colonBody ?? []);

const checks = {
  noRawAsterisksInLists: !serialized.includes("**Neue") && !serialized.includes("**Test"),
  headingOrLead: blocks.some((block) => {
    if (block.type === "paragraph" || block.type === "heading") {
      return block.children.some((node) => node.type === "bold");
    }
    return false;
  }),
  threeItems: blocks.some((block) => block.type === "list" && block.ordered && block.items.length === 3),
  firstTitleBold: blocks.some(
    (block) =>
      block.type === "list" &&
      block.items[0]?.title.some((node) => node.type === "text" && node.value.includes("Neue Business-Idee")),
  ),
  linkKept: blocks.some(
    (block) =>
      block.type === "paragraph" && block.children.some((node) => node.type === "link" && node.href.includes("rankpilot")),
  ),
  inlineBold: inline.some((node) => node.type === "bold"),
  inlineHasNoRawMarks: !JSON.stringify(inline).includes("**"),
  colonStripped: colonText.includes("Neues Projekt") && !colonText.includes(": Neues"),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok);
console.log(JSON.stringify({ checks, failed: failed.map(([key]) => key), blocks }, null, 2));
if (failed.length > 0) {
  throw new Error(`HUD-Markdown-Verifikation fehlgeschlagen: ${failed.map(([key]) => key).join(", ")}`);
}
console.log("NOVA HUD-Markdown-Verifikation erfolgreich.");
