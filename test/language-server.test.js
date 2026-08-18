import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { completionsFor, definitionFor, diagnosticsFor, documentLinksFor } from "../src/language-server/features.js";
import { createProjectManager, uriFromPath } from "../src/language-server/project.js";

const positionAt = (text, needle, offset = 0) => {
  const index = text.indexOf(needle) + offset;
  const before = text.slice(0, index);
  return { line: before.split("\n").length - 1, character: before.split("\n").at(-1).length };
};

const labels = (items) => items.map((item) => item.label);

test("language server resolves Nabi DSL from project files and unsaved documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-"));
  try {
    const pagePath = join(root, "src/pages/index.html");
    const files = {
      [pagePath]: "<html><body></body></html>",
      [join(root, "src/ui/card/index.html")]:
        '---\nvariants: primary | secondary\nsize: compact | spacious\n---\n<section data-variant="{{variant}}" data-size="{{size}}"><slot name="header"></slot><slot></slot><slot name="footer"></slot></section>',
      [join(root, "src/ui/button/index.html")]: "<button><slot></slot></button>",
      [join(root, "src/forms/input/index.html")]: '<input value="{{value}}">',
      [join(root, "src/shared/js/script.js")]: "window.script = true;",
      [join(root, "src/shared/js/core/utm.js")]: "window.utm = true;",
      [join(root, "src/shared/styles/pricing.css")]: ".pricing {}",
      [join(root, "src/shared/styles/core/normalize.css")]: "html {}",
    };
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );
    const uri = uriFromPath(pagePath);
    const projects = createProjectManager({ workspaceFolders: [{ uri: uriFromPath(root), name: "landing" }] });

    const refs = '<use ref=""></use>';
    const componentItems = await completionsFor({ projects, uri, text: refs, position: positionAt(refs, '"', 1) });
    assert.deepEqual(labels(componentItems), ["forms/input", "ui/button", "ui/card"]);
    assert.match(componentItems.find((item) => item.label === "ui/card").documentation.value, /<section/);
    assert.match(
      componentItems.find((item) => item.label === "ui/card").documentation.value,
      /variant: \[primary\] \[secondary\]/,
    );
    assert.match(
      componentItems.find((item) => item.label === "ui/card").documentation.value,
      /\*\*Component props\*\* {2}\n/,
    );
    assert.match(
      componentItems.find((item) => item.label === "ui/card").documentation.value,
      /size: \[compact\] \[spacious\] {2}\nvariant:/,
    );
    assert.match(componentItems.find((item) => item.label === "ui/card").documentation.value, /\n\n---\n\n```html/);
    const refPrefix = '<use ref="ui/ca"></use>';
    assert.deepEqual(
      labels(await completionsFor({ projects, uri, text: refPrefix, position: positionAt(refPrefix, "ui/ca", 5) })),
      ["ui/card"],
    );

    const scripts = '<script use="core/"></script>';
    const scriptItems = await completionsFor({
      projects,
      uri,
      text: scripts,
      position: positionAt(scripts, "core/", 5),
    });
    assert.deepEqual(labels(scriptItems), ["core/utm.js"]);
    assert.match(scriptItems[0].documentation.value, /window\.utm/);
    const styles = '<link use="core/">';
    const styleItems = await completionsFor({ projects, uri, text: styles, position: positionAt(styles, "core/", 5) });
    assert.deepEqual(labels(styleItems), ["core/normalize.css"]);
    assert.match(styleItems[0].documentation.value, /html \{\}/);

    const componentAttribute = "<use ></use>";
    const refItem = (
      await completionsFor({ projects, uri, text: componentAttribute, position: positionAt(componentAttribute, ">") })
    )[0];
    assert.equal(refItem.label, "ref");
    assert.equal(refItem.textEdit.newText, 'ref="${1}"');
    assert.equal(refItem.command.command, "editor.action.triggerSuggest");
    const scriptAttribute = "<script ></script>";
    assert.equal(
      (await completionsFor({ projects, uri, text: scriptAttribute, position: positionAt(scriptAttribute, ">") }))[0]
        .label,
      "use",
    );
    const styleAttribute = "<link >";
    assert.equal(
      (await completionsFor({ projects, uri, text: styleAttribute, position: positionAt(styleAttribute, ">") }))[0]
        .label,
      "use",
    );

    const props = '<use ref="ui/card" ></use>';
    const propItems = await completionsFor({ projects, uri, text: props, position: positionAt(props, ">") });
    assert.deepEqual(labels(propItems), ["size", "variant"]);
    assert.equal(propItems.find((item) => item.label === "variant").textEdit.newText, 'variant="${1}"');
    assert.equal(propItems.find((item) => item.label === "variant").command.command, "editor.action.triggerSuggest");
    assert.match(propItems.find((item) => item.label === "variant").documentation, /primary, secondary/);
    assert.equal(propItems.find((item) => item.label === "variant").sortText, "0_variant");
    assert.equal(propItems.find((item) => item.label === "variant").preselect, true);
    const spacedProps = '<use ref="ui/card"   ></use>';
    assert.deepEqual(
      labels(await completionsFor({ projects, uri, text: spacedProps, position: positionAt(spacedProps, ">") })),
      ["size", "variant"],
    );
    const propValues = '<use ref="ui/card" variant=""></use>';
    assert.deepEqual(
      labels(
        await completionsFor({
          projects,
          uri,
          text: propValues,
          position: { line: 0, character: propValues.indexOf('variant="') + 9 },
        }),
      ),
      ["primary", "secondary"],
    );
    const slots = '<use ref="ui/card"><h3 slot=""></h3></use>';
    assert.deepEqual(
      labels(await completionsFor({ projects, uri, text: slots, position: positionAt(slots, 'slot="', 6) })),
      ["footer", "header"],
    );

    const componentUse = '<use ref="ui/card"></use>';
    assert.equal(
      (await definitionFor({ projects, uri, text: componentUse, position: positionAt(componentUse, "ui/card", 5) }))[0]
        .uri,
      uriFromPath(join(root, "src/ui/card/index.html")),
    );
    const scriptUse = '<script use="core/utm.js"></script>';
    assert.equal(
      (await definitionFor({ projects, uri, text: scriptUse, position: positionAt(scriptUse, "core/utm.js", 5) }))[0]
        .uri,
      uriFromPath(join(root, "src/shared/js/core/utm.js")),
    );
    const styleUse = '<link use="core/normalize.css">';
    assert.equal(
      (
        await definitionFor({ projects, uri, text: styleUse, position: positionAt(styleUse, "core/normalize.css", 5) })
      )[0].uri,
      uriFromPath(join(root, "src/shared/styles/core/normalize.css")),
    );

    const invalid =
      '<use></use><use ref="ui/unknown"></use><script use="unknown.js"></script><link use="unknown.css"><use ref="ui/card"><button slot="actions"></button></use>';
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: invalid })).map((item) => item.message),
      [
        'Missing required attribute "ref"',
        'Component not found: "ui/unknown"',
        'Shared script not found: "unknown.js"',
        'Shared stylesheet not found: "unknown.css"',
        'Unknown slot "actions" in component "ui/card"',
      ],
    );
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: '<use ref="forms/input">Text</use>' })).map((item) => item.message),
      ['Component "forms/input" does not define a default slot'],
    );
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: '<use ref="forms/input"></use>' })).map((item) => item.message),
      ['Component "forms/input" does not define a default slot. Use <use ref="forms/input" />.'],
    );
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: '<use ref="forms/input" /><p>After</p>' })).map(
        (item) => item.message,
      ),
      [],
    );

    const modalPath = join(root, "src/ui/modal/index.html");
    await mkdir(dirname(modalPath), { recursive: true });
    await writeFile(modalPath, "<dialog></dialog>");
    projects.invalidate();
    assert(
      labels(await completionsFor({ projects, uri, text: refs, position: positionAt(refs, '"', 1) })).includes(
        "ui/modal",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("language server hides private nested local components outside their owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-private-"));
  try {
    const bonusPath = join(root, "src/pages/@bonus/index.html");
    const files = {
      [bonusPath]: '<section><use ref="@header/data"></use></section>',
      [join(root, "src/pages/@header/index.html")]: '<header><use ref="@header/data"></use></header>',
      [join(root, "src/pages/@header/data/index.html")]: "<span>Data</span>",
    };
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );
    const uri = uriFromPath(bonusPath);
    const projects = createProjectManager({ workspaceFolders: [uriFromPath(root)] });
    const ref = '<use ref="@header/"></use>';
    const completions = await completionsFor({
      projects,
      uri,
      text: ref,
      position: positionAt(ref, "@header/", 8),
    });
    assert(!labels(completions).includes("@header/data"));
    assert.deepEqual(await definitionFor({ projects, uri, text: ref, position: positionAt(ref, "@header/", 8) }), []);
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: '<use ref="@header/data"></use>' })).map((item) => item.message),
      ['Nested local component "@header/data" is private to "@header"'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("language server reports invalid project configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-config-"));
  try {
    const pagePath = join(root, "src/pages/index.html");
    await mkdir(dirname(pagePath), { recursive: true });
    await Promise.all([
      writeFile(pagePath, "<html><body></body></html>"),
      writeFile(join(root, "nabi.config.js"), 'export default { pagesDir: "src/pages" };\n'),
    ]);
    const text = "<html><body></body></html>";
    const diagnostics = await diagnosticsFor({
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      uri: uriFromPath(pagePath),
      text,
    });
    assert.deepEqual(
      diagnostics.map((item) => item.message),
      ['pagesDir must be a single directory name inside src, for example "pages".'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("language server replaces complete refs and resolves nested local component files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-refs-"));
  try {
    const pagePath = join(root, "src/pages/index.html");
    const files = {
      [pagePath]: "<html><body></body></html>",
      [join(root, "src/ui/button/index.html")]: "<button></button>",
      [join(root, "src/pages/@faq/index.html")]: "<section></section>",
      [join(root, "src/pages/@faq/ui/link/index.html")]: "<a></a>",
      [join(root, "src/pages/@faq/ui/link/selfreg.html")]: "<span></span>",
      [join(root, "src/pages/@faq/ui/data.html")]: "<data></data>",
    };
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );
    const uri = uriFromPath(pagePath);
    const projects = createProjectManager({ workspaceFolders: [uriFromPath(root)] });
    const partialRef = '<use ref="ui/b"></use>';
    const button = (
      await completionsFor({ projects, uri, text: partialRef, position: positionAt(partialRef, "ui/b", 4) })
    ).find((item) => item.label === "ui/button");
    assert.equal(button.textEdit.newText, "ui/button");
    assert.deepEqual(button.textEdit.range, {
      start: { line: 0, character: 10 },
      end: { line: 0, character: 14 },
    });
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: '<use ref="uI/BuTtOn"></use>' })).map((item) => item.message),
      ['Component ref must match its source path exactly: "uI/BuTtOn". Use "ui/button".'],
    );
    const faqUri = uriFromPath(join(root, "src/pages/@faq/index.html"));
    const faqRef = '<use ref="@faq/ui/"></use>';
    assert.deepEqual(
      labels(
        await completionsFor({ projects, uri: faqUri, text: faqRef, position: positionAt(faqRef, "@faq/ui/", 8) }),
      ),
      ["@faq/ui/data", "@faq/ui/link", "@faq/ui/link/selfreg"],
    );
    const links = await documentLinksFor({ projects, uri, text: '<use ref="ui/button"></use>' });
    assert.deepEqual(links[0].range, {
      start: { line: 0, character: 10 },
      end: { line: 0, character: 19 },
    });
    assert.equal(links[0].target, uriFromPath(join(root, "src/ui/button/index.html")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
