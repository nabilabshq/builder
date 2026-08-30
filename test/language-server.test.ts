import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";
import type { CompletionItem, TextEdit } from "vscode-languageserver/node.js";

import { completionsFor } from "@/language-server/features/completions.ts";
import { definitionFor } from "@/language-server/features/definitions.ts";
import { diagnosticsFor } from "@/language-server/features/diagnostics.ts";
import { documentLinksFor } from "@/language-server/features/document-links.ts";
import { createProjectManager, uriFromPath } from "@/language-server/project.ts";

const positionAt = (text: string, needle: string, offset = 0) => {
  const index = text.indexOf(needle) + offset;
  const before = text.slice(0, index);

  return { character: before.split("\n").at(-1)?.length ?? 0, line: before.split("\n").length - 1 };
};

const label = (item: CompletionItem) => String(item.label);
const labels = (items: CompletionItem[]) => items.map(label);
const itemFor = (items: CompletionItem[], name: string) => {
  const item = items.find((candidate) => label(candidate) === name);

  assert.ok(item, `Expected completion for ${name}`);

  return item;
};

const documentation = (item: CompletionItem) =>
  typeof item.documentation === "string" ? item.documentation : (item.documentation?.value ?? "");
const textEditOf = (item: CompletionItem): TextEdit => {
  assert.ok(item.textEdit && "range" in item.textEdit, `Expected a text edit for ${label(item)}`);

  return item.textEdit;
};

const commandOf = (item: CompletionItem) => {
  assert.ok(item.command, `Expected a command for ${label(item)}`);

  return item.command;
};

test("language server resolves Nabi DSL from project files and unsaved documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-"));

  try {
    const pagePath = join(root, "src/pages/index.html");
    const files = {
      [join(root, "src/forms/input/index.html")]: '<input value="{{value}}">',
      [join(root, "src/shared/js/core/utm.js")]: "window.utm = true;",
      [join(root, "src/shared/js/script.js")]: "window.script = true;",
      [join(root, "src/shared/styles/core/normalize.css")]: "html {}",
      [join(root, "src/shared/styles/pricing.css")]: ".pricing {}",
      [join(root, "src/ui/button/index.html")]: "<button><slot></slot></button>",
      [join(root, "src/ui/card/index.html")]:
        '---\nvariants: primary | secondary\nsize: compact | spacious\n---\n<section data-variant="{{variant}}" data-size="{{size}}"><slot name="header"></slot><slot></slot><slot name="footer"></slot></section>',
      [pagePath]: "<html><body></body></html>",
    };

    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );

    const uri = uriFromPath(pagePath);
    const projects = createProjectManager({ workspaceFolders: [{ uri: uriFromPath(root) }] });
    const refs = '<use ref=""></use>';
    const componentItems = await completionsFor({
      position: positionAt(refs, '"', 1),
      projects,
      text: refs,
      uri,
    });

    assert.deepEqual(labels(componentItems), ["forms/input", "ui/button", "ui/card"]);
    assert.match(documentation(itemFor(componentItems, "ui/card")), /<section/);
    assert.match(documentation(itemFor(componentItems, "ui/card")), /variant: \[primary\] \[secondary\]/);
    assert.match(documentation(itemFor(componentItems, "ui/card")), /\*\*Component props\*\* {2}\n/);
    assert.match(documentation(itemFor(componentItems, "ui/card")), /size: \[compact\] \[spacious\] {2}\nvariant:/);
    assert.match(documentation(itemFor(componentItems, "ui/card")), /\n\n---\n\n```html/);

    const refPrefix = '<use ref="ui/ca"></use>';

    assert.deepEqual(
      labels(
        await completionsFor({
          position: positionAt(refPrefix, "ui/ca", 5),
          projects,
          text: refPrefix,
          uri,
        }),
      ),
      ["ui/card"],
    );

    const scripts = '<script use="core/"></script>';
    const scriptItems = await completionsFor({
      position: positionAt(scripts, "core/", 5),
      projects,
      text: scripts,
      uri,
    });

    assert.deepEqual(labels(scriptItems), ["core/utm.js"]);
    assert.match(documentation(scriptItems[0]!), /window\.utm/);

    const styles = '<link use="core/">';
    const styleItems = await completionsFor({
      position: positionAt(styles, "core/", 5),
      projects,
      text: styles,
      uri,
    });

    assert.deepEqual(labels(styleItems), ["core/normalize.css"]);
    assert.match(documentation(styleItems[0]!), /html \{\}/);

    const componentAttribute = "<use ></use>";
    const refItem = (
      await completionsFor({
        position: positionAt(componentAttribute, ">"),
        projects,
        text: componentAttribute,
        uri,
      })
    )[0]!;

    assert.equal(refItem.label, "ref");
    assert.equal(textEditOf(refItem).newText, 'ref="${1}"');
    assert.equal(commandOf(refItem).command, "editor.action.triggerSuggest");

    const scriptAttribute = "<script ></script>";

    assert.equal(
      (
        await completionsFor({
          position: positionAt(scriptAttribute, ">"),
          projects,
          text: scriptAttribute,
          uri,
        })
      )[0].label,
      "use",
    );

    const styleAttribute = "<link >";

    assert.equal(
      (
        await completionsFor({
          position: positionAt(styleAttribute, ">"),
          projects,
          text: styleAttribute,
          uri,
        })
      )[0].label,
      "use",
    );

    const props = '<use ref="ui/card" ></use>';
    const propItems = await completionsFor({
      position: positionAt(props, ">"),
      projects,
      text: props,
      uri,
    });

    assert.deepEqual(labels(propItems), ["size", "variant"]);
    assert.equal(textEditOf(itemFor(propItems, "variant")).newText, 'variant="${1}"');
    assert.equal(commandOf(itemFor(propItems, "variant")).command, "editor.action.triggerSuggest");
    assert.match(documentation(itemFor(propItems, "variant")), /primary, secondary/);
    assert.equal(itemFor(propItems, "variant").sortText, "0_variant");
    assert.equal(itemFor(propItems, "variant").preselect, true);

    const spacedProps = '<use ref="ui/card"   ></use>';

    assert.deepEqual(
      labels(
        await completionsFor({
          position: positionAt(spacedProps, ">"),
          projects,
          text: spacedProps,
          uri,
        }),
      ),
      ["size", "variant"],
    );

    const propValues = '<use ref="ui/card" variant=""></use>';

    assert.deepEqual(
      labels(
        await completionsFor({
          position: { character: propValues.indexOf('variant="') + 9, line: 0 },
          projects,
          text: propValues,
          uri,
        }),
      ),
      ["primary", "secondary"],
    );

    const slots = '<use ref="ui/card"><h3 slot=""></h3></use>';

    assert.deepEqual(
      labels(
        await completionsFor({
          position: positionAt(slots, 'slot="', 6),
          projects,
          text: slots,
          uri,
        }),
      ),
      ["footer", "header"],
    );

    const componentUse = '<use ref="ui/card"></use>';

    assert.equal(
      (
        await definitionFor({
          position: positionAt(componentUse, "ui/card", 5),
          projects,
          text: componentUse,
          uri,
        })
      )[0].uri,
      uriFromPath(join(root, "src/ui/card/index.html")),
    );

    const scriptUse = '<script use="core/utm.js"></script>';

    assert.equal(
      (
        await definitionFor({
          position: positionAt(scriptUse, "core/utm.js", 5),
          projects,
          text: scriptUse,
          uri,
        })
      )[0].uri,
      uriFromPath(join(root, "src/shared/js/core/utm.js")),
    );

    const styleUse = '<link use="core/normalize.css">';

    assert.equal(
      (
        await definitionFor({
          position: positionAt(styleUse, "core/normalize.css", 5),
          projects,
          text: styleUse,
          uri,
        })
      )[0]!.uri,
      uriFromPath(join(root, "src/shared/styles/core/normalize.css")),
    );

    const invalid =
      '<use></use><use ref="ui/unknown"></use><script use="unknown.js"></script><link use="unknown.css"><use ref="ui/card"><button slot="actions"></button></use>';

    assert.deepEqual(
      (await diagnosticsFor({ projects, text: invalid, uri })).map((item) => item.message),
      [
        'Missing required attribute "ref"',
        'Component not found: "ui/unknown"',
        'Shared script not found: "unknown.js"',
        'Shared stylesheet not found: "unknown.css"',
        'Unknown slot "actions" in component "ui/card"',
      ],
    );
    assert.deepEqual(
      (await diagnosticsFor({ projects, text: '<use ref="forms/input">Text</use>', uri })).map((item) => item.message),
      ['Component "forms/input" does not define a default slot'],
    );
    assert.deepEqual(
      (await diagnosticsFor({ projects, text: '<use ref="forms/input"></use>', uri })).map((item) => item.message),
      ['Component "forms/input" does not define a default slot. Use <use ref="forms/input" />.'],
    );
    assert.deepEqual(
      (await diagnosticsFor({ projects, text: '<use ref="forms/input" /><p>After</p>', uri })).map(
        (item) => item.message,
      ),
      [],
    );

    const modalPath = join(root, "src/ui/modal/index.html");

    await mkdir(dirname(modalPath), { recursive: true });
    await writeFile(modalPath, "<dialog></dialog>");
    projects.invalidate();
    assert(
      labels(await completionsFor({ position: positionAt(refs, '"', 1), projects, text: refs, uri })).includes(
        "ui/modal",
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("language server hides private nested local components outside their owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-private-"));

  try {
    const bonusPath = join(root, "src/pages/@bonus/index.html");
    const files = {
      [bonusPath]: '<section><use ref="@header/data"></use></section>',
      [join(root, "src/pages/@header/data/index.html")]: "<span>Data</span>",
      [join(root, "src/pages/@header/index.html")]: '<header><use ref="@header/data"></use></header>',
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
      position: positionAt(ref, "@header/", 8),
      projects,
      text: ref,
      uri,
    });

    assert(!labels(completions).includes("@header/data"));
    assert.deepEqual(await definitionFor({ position: positionAt(ref, "@header/", 8), projects, text: ref, uri }), []);
    assert.deepEqual(
      (await diagnosticsFor({ projects, text: '<use ref="@header/data"></use>', uri })).map((item) => item.message),
      ['Nested local component "@header/data" is private to "@header"'],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
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
      text,
      uri: uriFromPath(pagePath),
    });

    assert.deepEqual(
      diagnostics.map((item) => item.message),
      ['pagesDir must be a single directory name inside srcPath, for example "pages".'],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("language server replaces complete refs and resolves nested local component files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-refs-"));

  try {
    const pagePath = join(root, "src/pages/index.html");
    const files = {
      [join(root, "src/pages/@faq/index.html")]: "<section></section>",
      [join(root, "src/pages/@faq/ui/data.html")]: "<data></data>",
      [join(root, "src/pages/@faq/ui/link/index.html")]: "<a></a>",
      [join(root, "src/pages/@faq/ui/link/selfreg.html")]: "<span></span>",
      [join(root, "src/ui/button/index.html")]: "<button></button>",
      [pagePath]: "<html><body></body></html>",
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
      await completionsFor({
        position: positionAt(partialRef, "ui/b", 4),
        projects,
        text: partialRef,
        uri,
      })
    ).find((item) => item.label === "ui/button")!;

    assert.equal(textEditOf(button).newText, "ui/button");
    assert.deepEqual(textEditOf(button).range, {
      end: { character: 14, line: 0 },
      start: { character: 10, line: 0 },
    });
    assert.deepEqual(
      (await diagnosticsFor({ projects, text: '<use ref="uI/BuTtOn"></use>', uri })).map((item) => item.message),
      ['Component ref must match its source path exactly: "uI/BuTtOn". Use "ui/button".'],
    );

    const faqUri = uriFromPath(join(root, "src/pages/@faq/index.html"));
    const faqRef = '<use ref="@faq/ui/"></use>';

    assert.deepEqual(
      labels(
        await completionsFor({
          position: positionAt(faqRef, "@faq/ui/", 8),
          projects,
          text: faqRef,
          uri: faqUri,
        }),
      ),
      ["@faq/ui/data", "@faq/ui/link", "@faq/ui/link/selfreg"],
    );

    const links = await documentLinksFor({ projects, text: '<use ref="ui/button"></use>', uri });

    assert.deepEqual(links[0].range, {
      end: { character: 19, line: 0 },
      start: { character: 10, line: 0 },
    });
    assert.equal(links[0].target, uriFromPath(join(root, "src/ui/button/index.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
