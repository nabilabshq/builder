import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { build } from "../src/builder.js";

const project = async (files) => {
  const root = await mkdtemp(join(tmpdir(), "nabi-shared-dependencies-"));
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  return root;
};

test("resolves page and component shared dependencies without global injection", async () => {
  const root = await project({
    "src/pages/index.html":
      '<html><head><link use="core/normalize.css" media="screen"><link rel="stylesheet" href="./page.css"></head><body><script use="core/utm.js" type="module" defer></script><script use="core/utm.js"></script><script src="./page.js"></script></body></html>',
    "src/pages/pricing/index.html":
      '<html><head><link use="pricing.css"></head><body><use ref="card"></use></body></html>',
    "src/shared/components/card/index.html": '<section>Card</section><script use="card.js"></script>',
    "src/shared/styles/core/normalize.css": "/* normalize */\nhtml { color: black; }",
    "src/shared/styles/pricing.css": ".price { color: purple; }",
    "src/shared/styles/unused.css": ".unused { color: red; }",
    "src/shared/js/core/utm.js": "window.utm = true;\n",
    "src/shared/js/card.js": "window.card = true;\n",
    "src/shared/js/unused.js": "window.unused = true;\n",
  });
  try {
    await build({ cwd: root, config: { minify: { css: false } } });
    const index = await readFile(join(root, "dist/index.html"), "utf8");
    const pricing = await readFile(join(root, "dist/pricing/index.html"), "utf8");
    assert.match(index, /<link media="screen" rel="stylesheet" href="\/styles\/core\/normalize.css">/);
    assert.match(
      index,
      /<script type="module" defer="" src="\/js\/core\/utm.js"><\/script><script src="\/js\/core\/utm.js"><\/script>/,
    );
    assert.match(index, /<link rel="stylesheet" href="\.\/page.css">/);
    assert.match(index, /<script src="\.\/page.js"><\/script>/);
    assert.doesNotMatch(index, / use=/);
    assert.match(pricing, /<link rel="stylesheet" href="\/styles\/pricing.css">/);
    assert.match(pricing, /<script src="\/js\/card.js"><\/script>/);
    await readFile(join(root, "dist/styles/core/normalize.css"));
    await readFile(join(root, "dist/styles/pricing.css"));
    await readFile(join(root, "dist/js/core/utm.js"));
    await readFile(join(root, "dist/js/card.js"));
    await assert.rejects(() => readFile(join(root, "dist/styles/unused.css")));
    await assert.rejects(() => readFile(join(root, "dist/js/unused.js")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid shared dependency declarations", async () => {
  const root = await project({ "src/pages/index.html": "<html><head></head><body></body></html>" });
  try {
    await writeFile(
      join(root, "src/pages/index.html"),
      '<html><body><script use="a.js" src="./a.js"></script></body></html>',
    );
    await assert.rejects(() => build({ cwd: root }), /Invalid <script>: "use" cannot be combined with "src"/);
    await writeFile(
      join(root, "src/pages/index.html"),
      '<html><head><link use="a.css" href="./a.css"></head><body></body></html>',
    );
    await assert.rejects(() => build({ cwd: root }), /Invalid <link>: "use" cannot be combined with "href"/);
    await writeFile(
      join(root, "src/pages/index.html"),
      '<html><body><script use="../../secret.js"></script></body></html>',
    );
    await assert.rejects(() => build({ cwd: root }), /Invalid shared script path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
