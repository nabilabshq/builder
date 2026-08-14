import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { completionsFor, definitionFor, diagnosticsFor } from "../src/language-server/features.js";
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
      [join(root, "src/shared/components/card/index.html")]:
        '---\nvariants: primary | secondary\nsize: compact | spacious\n---\n<section data-variant="{{variant}}" data-size="{{size}}"><slot name="header"></slot><slot></slot><slot name="footer"></slot></section>',
      [join(root, "src/shared/components/button/index.html")]: "<button><slot></slot></button>",
      [join(root, "src/shared/components/forms/input/index.html")]: '<input value="{{value}}">',
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
    assert.deepEqual(labels(componentItems), ["button", "card", "forms/input"]);
    assert.match(componentItems.find((item) => item.label === "card").documentation.value, /<section/);
    const refPrefix = '<use ref="ca"></use>';
    assert.deepEqual(
      labels(await completionsFor({ projects, uri, text: refPrefix, position: positionAt(refPrefix, "ca", 2) })),
      ["card"],
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

    const props = '<use ref="card" ></use>';
    const propItems = await completionsFor({ projects, uri, text: props, position: positionAt(props, ">") });
    assert.deepEqual(labels(propItems), ["size", "variant"]);
    assert.equal(propItems.find((item) => item.label === "variant").textEdit.newText, 'variant="${1}"');
    assert.equal(propItems.find((item) => item.label === "variant").command.command, "editor.action.triggerSuggest");
    const propValues = '<use ref="card" variant=""></use>';
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
    const slots = '<use ref="card"><h3 slot=""></h3></use>';
    assert.deepEqual(
      labels(await completionsFor({ projects, uri, text: slots, position: positionAt(slots, 'slot="', 6) })),
      ["footer", "header"],
    );

    const componentUse = '<use ref="card"></use>';
    assert.equal(
      (await definitionFor({ projects, uri, text: componentUse, position: positionAt(componentUse, "card", 2) }))[0]
        .uri,
      uriFromPath(join(root, "src/shared/components/card/index.html")),
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
      '<use></use><use ref="unknown"></use><script use="unknown.js"></script><link use="unknown.css"><use ref="card"><button slot="actions"></button></use>';
    assert.deepEqual(
      (await diagnosticsFor({ projects, uri, text: invalid })).map((item) => item.message),
      [
        'Missing required attribute "ref"',
        'Component not found: "unknown"',
        'Shared script not found: "unknown.js"',
        'Shared stylesheet not found: "unknown.css"',
        'Unknown slot "actions" in component "card"',
      ],
    );

    const modalPath = join(root, "src/shared/components/modal/index.html");
    await mkdir(dirname(modalPath), { recursive: true });
    await writeFile(modalPath, "<dialog></dialog>");
    projects.invalidate();
    assert(
      labels(await completionsFor({ projects, uri, text: refs, position: positionAt(refs, '"', 1) })).includes("modal"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
