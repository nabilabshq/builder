import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { build } from "../src/builder.js";

const project = async (files) => {
  const root = await mkdtemp(join(tmpdir(), "nabi-build-"));
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  return root;
};

test("split build emits page-owned CSS, JS, assets, and manifest", async () => {
  const root = await project({
    "src/pages/index.html":
      '<!doctype html><html><head></head><body><use ref="card">Home</use><img src="@assets/logo.bin"></body></html>',
    "src/pages/style.css": "/* page css */\n",
    "src/pages/script.js": "// page js\n",
    "src/pages/dashboard/index.html": "<html><head></head><body>Dashboard</body></html>",
    "src/shared/components/card/index.html": "<article><slot /></article>",
    "src/shared/components/card/style.css": "/* card css */\n",
    "src/shared/components/card/script.js": "// card js\n",
    "src/shared/assets/logo.bin": "binary-like\u0000content",
  });
  try {
    const result = await build({ cwd: root, mode: "split", config: { minify: { css: false } } });
    assert.equal(result.pages.length, 2);
    const index = await readFile(join(root, "dist/index.html"), "utf8");
    assert.match(index, /href="\/style.css"/);
    assert.match(index, /src="\/script.js"/);
    assert.match(index, /src="\/assets\/logo.bin"/);
    assert.match(index, /<article>Home<\/article>/);
    assert.equal(await readFile(join(root, "dist/style.css"), "utf8"), "/* card css */\n\n/* page css */\n");
    assert.equal(await readFile(join(root, "dist/script.js"), "utf8"), "// card js\n\n// page js\n");
    assert.deepEqual(
      await readFile(join(root, "src/shared/assets/logo.bin")),
      await readFile(join(root, "dist/assets/logo.bin")),
    );
    const manifest = JSON.parse(await readFile(join(root, "dist/manifest.json"), "utf8"));
    assert.deepEqual(manifest["index.html"], { css: ["style.css"], js: ["script.js"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blocks shared asset path traversal", async () => {
  const root = await project({
    "src/pages/index.html": '<html><body><img src="@assets/../../secret.png"></body></html>',
  });
  try {
    await assert.rejects(() => build({ cwd: root }), /escapes its configured directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inline build embeds graph CSS and JavaScript safely", async () => {
  const root = await project({
    "src/pages/index.html": '<!doctype html><html><head></head><body><use ref="banner"></use></body></html>',
    "src/pages/style.css": ".hero::after { content: '</style>'; }\n",
    "src/shared/components/banner/index.html": "<section>Banner</section>",
    "src/shared/components/banner/style.css": "/* banner */\n",
    "src/shared/components/banner/script.js": "const markup = '</script>';\n",
  });
  try {
    await build({ cwd: root, mode: "inline", config: { minify: { css: false } } });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    assert.match(html, /<style>\/\* banner \*\//);
    assert.match(html, /<\\\/style>/);
    assert.match(html, /const markup = '<\\\/script>';/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("minifies CSS by default and applies HTML and JavaScript minification only when enabled", async () => {
  const root = await project({
    "src/pages/index.html":
      "<!doctype html><html><head></head><body><!-- page comment --><h1> Hello Nabi </h1></body></html>",
    "src/pages/style.css": "/* style comment */\n.card { color: red; }\n",
    "src/pages/script.js": "const greeting = 'Nabi'; console.log(greeting);\n",
  });
  try {
    await build({ cwd: root, mode: "split" });
    const defaultHtml = await readFile(join(root, "dist/index.html"), "utf8");
    const defaultCss = await readFile(join(root, "dist/style.css"), "utf8");
    const defaultJs = await readFile(join(root, "dist/script.js"), "utf8");
    assert.match(defaultHtml, /<!-- page comment -->/);
    assert.doesNotMatch(defaultCss, /style comment/);
    assert.match(defaultCss, /\.card\{color:red\}/);
    assert.equal(defaultJs, "const greeting = 'Nabi'; console.log(greeting);\n");

    await build({ cwd: root, mode: "split", config: { minify: { html: true, js: true } } });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const javascript = await readFile(join(root, "dist/script.js"), "utf8");
    assert.doesNotMatch(html, /page comment/);
    assert.doesNotMatch(html, />\s+</);
    assert.match(javascript, /console\.log\("Nabi"\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes stale generated routes on a subsequent build", async () => {
  const root = await project({
    "src/pages/index.html": "<html><body>Home</body></html>",
    "src/pages/retired/index.html": "<html><body>Retired</body></html>",
  });
  try {
    await build({ cwd: root });
    await access(join(root, "dist/retired/index.html"));
    await rm(join(root, "src/pages/retired"), { recursive: true, force: true });
    await build({ cwd: root });
    await assert.rejects(() => access(join(root, "dist/retired/index.html")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
