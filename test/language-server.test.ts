import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";
import type { CompletionItem, TextEdit } from "vscode-languageserver/node.js";
import { InsertTextFormat } from "vscode-languageserver/node.js";

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

test("language server completes dynamic route metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-route-data-"));

  try {
    const routeDataPath = join(root, "src/pages/[city]/_route.json");
    const cityDataPath = join(root, "src/data/global/cities.json");
    const incomeDataPath = join(root, "src/data/income.json");
    const text = '{\n  "@\n}';

    await Promise.all([
      mkdir(dirname(routeDataPath), { recursive: true }),
      mkdir(dirname(cityDataPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(cityDataPath, '{\n  "msk": { "name": "Москва" }\n}'),
      writeFile(incomeDataPath, "{}"),
      writeFile(routeDataPath, text),
    ]);

    const items = await completionsFor({
      position: positionAt(text, '"@', 2),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(items), ["@data", "@when"]);
    assert.equal(textEditOf(itemFor(items, "@data")).newText, '"@data": ["$1"]');
    assert.equal(textEditOf(itemFor(items, "@when")).newText, '"@when": {\n\t$0\n}');
    assert.equal(itemFor(items, "@when").preselect, true);
    assert.equal(itemFor(items, "@when").sortText, "0_@when");

    const blankText = "{\n  \n}";
    const blankItems = await completionsFor({
      position: { character: 2, line: 1 },
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: blankText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(blankItems), ["@data", "@when"]);

    const arrayText = '{\n  "items": [\n    "value",\n    \n  ]\n}';
    const arrayItems = await completionsFor({
      position: { character: 4, line: 3 },
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: arrayText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(arrayItems), []);

    const dataText = '{\n  "@data": [""\n}';
    const dataItems = await completionsFor({
      position: positionAt(dataText, '""', 1),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: dataText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(dataItems), ["global/cities.json", "income.json"]);

    const nextDataText = '{\n  "@data": ["income.json", ""\n}';
    const nextDataItems = await completionsFor({
      position: positionAt(nextDataText, '""', 1),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: nextDataText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(nextDataItems), ["global/cities.json", "income.json"]);

    const dataAfterCommaText = '{\n  "@data": ["income.json", \n}';
    const dataAfterCommaItems = await completionsFor({
      position: positionAt(dataAfterCommaText, "\n}", 0),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: dataAfterCommaText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(dataAfterCommaItems), ["global/cities.json", "income.json"]);
    assert.equal(textEditOf(itemFor(dataAfterCommaItems, "global/cities.json")).newText, '"global/cities.json"');
    assert.equal(textEditOf(itemFor(dataItems, "global/cities.json")).newText, "global/cities.json");
    assert.deepEqual(itemFor(dataItems, "global/cities.json").documentation, {
      kind: "markdown",
      value: 'JSON file relative to dataDir.\n\n```json\n{\n  "msk": { "name": "Москва" }\n}\n```',
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("language server completes metadata in configured route files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-route-file-"));

  try {
    const routeDataPath = join(root, "src/pages/[city]/route.json");
    const text = '{\n  "cpa": {\n    "@\n  }\n}';

    await mkdir(dirname(routeDataPath), { recursive: true });
    await Promise.all([
      writeFile(join(root, "nabi.config.js"), 'export default { routeFileName: "route" };'),
      writeFile(routeDataPath, text),
    ]);

    const items = await completionsFor({
      position: positionAt(text, '"@', 2),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(items), ["@data", "@when"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("language server completes parent parameters in dynamic route conditions", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-route-conditions-"));

  try {
    const routeDataPath = join(root, "src/pages/[folder]/[city]/[page]/_route.json");
    const text = '{\n  "page": {\n    "@when": {\n      "": ""\n    }\n  }\n}';

    await mkdir(dirname(routeDataPath), { recursive: true });
    await writeFile(routeDataPath, text);

    const items = await completionsFor({
      position: positionAt(text, '""', 1),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(items), ["folder", "city"]);
    assert.equal(itemFor(items, "folder").insertText, 'folder": "$1');
    assert.equal(itemFor(items, "folder").insertTextFormat, InsertTextFormat.Snippet);

    const closedQuoteItems = await completionsFor({
      position: positionAt(text, '""', 2),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(closedQuoteItems), ["folder", "city"]);
    assert.equal(itemFor(closedQuoteItems, "folder").filterText, '""');

    const keyOnlyText = '{\n  "page": {\n    "@when": {\n      ""\n    }\n  }\n}';
    const keyOnlyItems = await completionsFor({
      position: positionAt(keyOnlyText, '""', 1),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: keyOnlyText,
      uri: uriFromPath(routeDataPath),
    });

    assert.equal(itemFor(keyOnlyItems, "folder").insertTextFormat, InsertTextFormat.Snippet);
    assert.equal(itemFor(keyOnlyItems, "folder").insertText, 'folder": "$1');

    const namedKeyText = '{\n  "page": {\n    "@when": {\n      "folder"\n    }\n  }\n}';
    const namedKeyItems = await completionsFor({
      position: positionAt(namedKeyText, '"folder"', 8),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: namedKeyText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(namedKeyItems), ["folder"]);

    const blankText = '{\n  "page": {\n    "@when": {\n      \n    }\n  }\n}';
    const blankItems = await completionsFor({
      position: { character: 6, line: 3 },
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: blankText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(blankItems), ["folder", "city"]);
    assert.equal(itemFor(blankItems, "folder").insertText, '"folder": "$1"$0');
    assert.equal(itemFor(blankItems, "folder").sortText, "0_folder");

    const inlineBlankText = '{"page":{"@when": {  }}}';
    const inlineBlankItems = await completionsFor({
      position: positionAt(inlineBlankText, "}}"),
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: inlineBlankText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(inlineBlankItems), ["folder", "city"]);

    const afterConditionText = '{\n  "page": {\n    "@when": {\n      "city": "adler",\n      \n    }\n  }\n}';
    const afterConditionItems = await completionsFor({
      position: { character: 6, line: 4 },
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: afterConditionText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(afterConditionItems), ["folder"]);

    const nestedText = `{
  "cpa": {
    "seo": {
      "description": {
        "after": "Description",
        "before": "Title"
      }
    },
    "@when": {

    }
  },
  "students": {
    "@when": {
      "folder": "rabota"
    }
  }
}`;
    const nestedItems = await completionsFor({
      position: { character: 6, line: 9 },
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: nestedText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(nestedItems), ["folder", "city"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("language server completes available parent route values in conditions", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-route-values-"));

  try {
    const routeDataPath = join(root, "src/pages/[folder]/[city]/[page]/_route.json");
    const files = {
      [join(root, "src/pages/[folder]/_route.json")]: JSON.stringify(["rabota"]),
      [join(root, "src/pages/[folder]/[city]/_route.json")]: JSON.stringify({
        "": { "@when": { folder: "rabota" } },
        msk: { "@when": { folder: ["perf", "rabota"] } },
      }),
      [routeDataPath]: "{}",
    };

    await Promise.all(
      Object.entries(files).map(async ([path, source]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, source);
      }),
    );

    const projects = createProjectManager({ workspaceFolders: [uriFromPath(root)] });
    const folderText = '{\n  "page": {\n    "@when": {\n      "folder": ""\n    }\n  }\n}';
    const folderItems = await completionsFor({
      position: positionAt(folderText, '""', 1),
      projects,
      text: folderText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(folderItems), ["rabota"]);
    assert.equal(textEditOf(folderItems[0]!).newText, "rabota");

    const nextConditionText = '{\n  "page": {\n    "@when": {\n      "folder": "rabota",\n      ""\n    }\n  }\n}';
    const nextConditionItems = await completionsFor({
      position: positionAt(nextConditionText, '""', 1),
      projects,
      text: nextConditionText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(nextConditionItems), ["city"]);

    const cityText = '{\n  "page": {\n    "@when": {\n      "folder": "rabota",\n      "city": ""\n    }\n  }\n}';
    const cityItems = await completionsFor({
      position: positionAt(cityText, '"city": ""', 9),
      projects,
      text: cityText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(cityItems), ['""', "msk"]);
    assert.equal(textEditOf(cityItems[0]!).newText, "");

    const cityArrayText =
      '{\n  "page": {\n    "@when": {\n      "folder": "rabota",\n      "city": ["msk", ""\n    }\n  }\n}';
    const cityArrayItems = await completionsFor({
      position: positionAt(cityArrayText, '""', 1),
      projects,
      text: cityArrayText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(cityArrayItems), ['""']);
    assert.equal(textEditOf(cityArrayItems[0]!).newText, "");

    const cityArrayAfterCommaText =
      '{\n  "page": {\n    "@when": {\n      "folder": "rabota",\n      "city": ["msk", \n    }\n  }\n}';
    const cityArrayAfterCommaItems = await completionsFor({
      position: positionAt(cityArrayAfterCommaText, "\n    }", 0),
      projects,
      text: cityArrayAfterCommaText,
      uri: uriFromPath(routeDataPath),
    });

    assert.deepEqual(labels(cityArrayAfterCommaItems), ['""']);
    assert.equal(textEditOf(cityArrayAfterCommaItems[0]!).newText, '""');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("language server reports dynamic route collisions on their page template", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-language-server-route-collision-"));

  try {
    const pagePath = join(root, "src/pages/[folder]/[city]/[page]/index.html");
    const files = {
      [join(root, "src/pages/[folder]/_route.json")]: JSON.stringify(["perf"]),
      [join(root, "src/pages/[folder]/[city]/_route.json")]: JSON.stringify(["", "students"]),
      [join(root, "src/pages/[folder]/[city]/[page]/_route.json")]: JSON.stringify(["students", ""]),
      [pagePath]: "<main>Page</main>",
    };

    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );

    const diagnostics = await diagnosticsFor({
      projects: createProjectManager({ workspaceFolders: [uriFromPath(root)] }),
      text: files[pagePath],
      uri: uriFromPath(pagePath),
    });

    assert.deepEqual(
      diagnostics.map((item) => item.message),
      [
        'Route collision: "/perf/students"\n\n' +
          "The following entries generate the same route:\n\n" +
          "- src/pages/[folder]/[city]/[page]/index.html\n" +
          '  Dynamic context: folder=perf, city="", page=students\n\n' +
          "- src/pages/[folder]/[city]/[page]/index.html\n" +
          '  Dynamic context: folder=perf, city=students, page=""\n\n' +
          'Give each record a unique route slug or use "@when" to make the contexts exclusive.',
      ],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
