// Builds the website (gracehush.com) from the Markdown in docs/, into site/:
//
//   node docs/site/build.cjs ["November 4, 2026"]      (the optional argument is the effective date, today's date if left out)
//
// - Sources: docs/privacy-policy.md, docs/terms-of-use.md and docs/site/{home,support,delete-account,not-found}.md.
// - {{COMPANY_NAME}} and {{COMPANY_ADDRESS}} come from docs/site/facts.json, which is git-ignored: the company's details are on the published
//   pages and stay out of the public repository, and out of the site/ folder too, so uploading site/ publishes nothing but the pages.
//   {{SUPPORT_EMAIL}} comes from src/constants/app.ts, so the app and the pages never disagree. {{SITE}}, {{DATE}} and {{YEAR}} are set here.
// - Output: site/index.html, site/{privacy,terms,support,delete-account}/index.html, site/404.html and site/logo-mark.png. Every page is plain HTML with
//   its style inline: no script, no cookie, no analytics and no request to another site. Upload the site/ folder to any static host.
// - It writes nothing while a {{token}}, a TODO or an example.com address is left in a page.
//
// docs/site/facts.json: { "companyName": "...", "companyAddress": "..." }
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "site");
const SITE = "https://gracehush.com";

const PAGES = [
  { src: "docs/site/home.md", out: "index.html", title: "GraceHush", description: "A private audio prayer journal: speak or write what you are carrying and get a Bible passage, a short spoken devotional and three gentle affirmations.", home: true },
  { src: "docs/privacy-policy.md", out: "privacy/index.html", title: "Privacy Policy", description: "What information GraceHush handles, why, who helps us, how long we keep it, and your choices." },
  { src: "docs/terms-of-use.md", out: "terms/index.html", title: "Terms of Use", description: "The terms for using GraceHush." },
  { src: "docs/site/support.md", out: "support/index.html", title: "Support", description: "Help with GraceHush: deleting your account, exporting your journal, subscriptions and more." },
  { src: "docs/site/delete-account.md", out: "delete-account/index.html", title: "Delete your account", description: "How to delete your GraceHush account, in the app or by email." },
  { src: "docs/site/not-found.md", out: "404.html", title: "Page not found", description: "This page does not exist.", hidden: true },
];

function fail(message) {
  console.error(`build-site: ${message}`);
  process.exit(1);
}

// The company's details.
const factsPath = path.join(__dirname, "facts.json");
if (!fs.existsSync(factsPath)) {
  fail(`${path.relative(ROOT, factsPath)} is missing. Create it with {"companyName": "...", "companyAddress": "..."} (the file is git-ignored).`);
}
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
for (const key of ["companyName", "companyAddress"]) {
  if (typeof facts[key] !== "string" || facts[key].trim() === "") fail(`${key} is missing from docs/site/facts.json`);
}

const appSource = fs.readFileSync(path.join(ROOT, "src/constants/app.ts"), "utf8");
const email = /export const SUPPORT_EMAIL = "([^"]+)"/.exec(appSource)?.[1];
if (!email) fail("SUPPORT_EMAIL was not found in src/constants/app.ts");

const date = process.argv[2] ?? new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const year = /\d{4}/.exec(date)?.[0] ?? String(new Date().getFullYear());
const tokens = {
  COMPANY_NAME: facts.companyName.trim(),
  COMPANY_ADDRESS: facts.companyAddress.trim(),
  SUPPORT_EMAIL: email,
  SITE,
  DATE: date,
  YEAR: year,
};

function fill(text, where) {
  const filled = text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
    if (!(key in tokens)) fail(`${where}: unknown token ${whole}`);
    return tokens[key];
  });
  if (/TODO/.test(filled)) fail(`${where}: a TODO is left in the text`);
  if (/example\.com/.test(filled)) fail(`${where}: an example.com address is left in the text`);
  return filled;
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (text) => text.toLowerCase().replace(/&amp;/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inline(text) {
  return escape(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${url}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function table(rows) {
  const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const [head, , ...body] = rows;
  const labels = cells(head);
  const attribute = (text) => escape(text).replace(/"/g, "&quot;");
  const th = labels.map((cell) => `<th role="columnheader">${inline(cell)}</th>`).join("");
  const tr = body
    .map((row) => `<tr role="row">${cells(row).map((cell, i) => `<td role="cell" data-label="${attribute(labels[i] ?? "")}">${inline(cell)}</td>`).join("")}</tr>`)
    .join("");
  // The roles keep it a table for screen readers when the phone layout (see STYLE) draws each row as a card.
  return `<div class="table"><table role="table"><thead role="rowgroup"><tr role="row">${th}</tr></thead><tbody role="rowgroup">${tr}</tbody></table></div>`;
}

// The Markdown these pages use: headings, paragraphs, bullet lists, tables, rules, **bold** and [links](...). Nothing else.
function markdown(source) {
  const lines = source.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list !== null) html.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level} id="${slug(escape(heading[2]))}">${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (line === "---") {
      flushParagraph();
      flushList();
      html.push("<hr>");
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list = list ?? [];
      list.push(line.slice(2));
      continue;
    }
    if (line.startsWith("|")) {
      flushParagraph();
      flushList();
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html.push(table(rows));
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return html.join("\n");
}

const STYLE = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#FBF7F2;color:#2E2A33;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}header,main,footer{max-width:720px;margin:0 auto;padding-left:20px;padding-right:20px}header{padding-top:24px;padding-bottom:8px}.brand{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#3E2741;font:600 22px/1 Georgia,"Times New Roman",serif;letter-spacing:-.02em}.brand img{width:40px;height:40px}.wm span{color:#96555D}main{padding-top:16px;padding-bottom:40px}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:#3E2741;line-height:1.25;font-weight:600}h1{font-size:1.9rem;margin:.6em 0 .4em}.home h1{font-size:2.3rem}h2{font-size:1.3rem;margin:1.8em 0 .5em}h3{font-size:1.08rem;margin:1.4em 0 .4em}p,li{margin:.6em 0}ul{padding-left:1.3em}a{color:#5B3A5E;text-underline-offset:2px}hr{border:0;border-top:1px solid #EADFDB;margin:2em 0}.table{overflow-x:auto;margin:1em 0}table{border-collapse:collapse;width:100%;font-size:.94rem;min-width:520px}th,td{border:1px solid #EADFDB;padding:8px 10px;text-align:left;vertical-align:top;background:#fff}th{background:#F5ECE8;color:#3E2741}footer{border-top:1px solid #EADFDB;padding-top:20px;padding-bottom:40px;font-size:.9rem;color:#6E636D}footer nav{margin-bottom:10px}footer nav a{margin-right:16px}footer p{margin:.3em 0}@media (max-width:640px){.table{overflow:visible}table{min-width:0}thead{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}table,tbody,tr,td{display:block;width:100%}tr{background:#fff;border:1px solid #EADFDB;border-radius:12px;margin:0 0 12px;padding:4px 14px}td{border:0;padding:8px 0}td+td{border-top:1px solid #F1EDE8}td::before{content:attr(data-label);display:block;font-size:.8rem;font-weight:600;color:#6E636D;margin-bottom:2px}}`;

function page({ title, description, home, hidden }, body) {
  const heading = home ? "GraceHush" : `${title} · GraceHush`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#FBF7F2">
<title>${escape(heading)}</title>
<meta name="description" content="${escape(description)}">${hidden ? '\n<meta name="robots" content="noindex">' : ""}
<link rel="icon" href="/logo-mark.png">
<style>${STYLE}</style>
</head>
<body>
<header><a class="brand" href="/"><img src="/logo-mark.png" alt="" width="40" height="40"><span class="wm">Grace<span>Hush</span></span></a></header>
<main${home ? ' class="home"' : ""}>
${body}
</main>
<footer>
<nav><a href="/support/">Support</a><a href="/privacy/">Privacy Policy</a><a href="/terms/">Terms of Use</a></nav>
<p>© ${tokens.YEAR} ${escape(tokens.COMPANY_NAME)}. GraceHush is not a crisis, medical or counseling service.</p>
</footer>
</body>
</html>
`;
}

// Everything is checked before anything is written.
const built = PAGES.map((entry) => {
  const source = fs.readFileSync(path.join(ROOT, entry.src), "utf8");
  return { entry, html: page(entry, markdown(fill(source, entry.src))) };
});

for (const { entry, html } of built) {
  const file = path.join(OUT, entry.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
fs.copyFileSync(path.join(ROOT, "assets/images/logo-mark.png"), path.join(OUT, "logo-mark.png"));
console.log(`built ${built.length} pages into site/ (effective date: ${date})`);
