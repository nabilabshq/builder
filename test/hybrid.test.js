import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { build } from "../src/builder.js";

const project = async (files) => {
  const root = await mkdtemp(join(tmpdir(), "nabi-hybrid-"));
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  return root;
};

test("hybrid layout resolves local components before shared, projects slots, forwards attributes, and emits page resources", async () => {
  const root = await project({
    "src/pages/index.html":
      '<!doctype html><html><head><title>Home</title><link use="reset.css"></head><body><use ref="header"></use><use ref="card"><h2 slot="header">Title</h2><p>Body</p><use ref="button" slot="footer" href="/buy" variant="secondary" id="buy" aria-label="Buy">Buy</use></use><script use="base.js"></script></body></html>',
    "src/pages/style.css": "/* page */\n",
    "src/pages/script.js": "// page\n",
    "src/pages/components/header/index.html": '<header class="local-header">Local</header>',
    "src/pages/components/header/style.css": "/* local header */\n",
    "src/shared/components/header/index.html": '<header class="shared-header">Shared</header>',
    "src/shared/components/header/style.css": "/* shared header */\n",
    "src/shared/components/card/index.html":
      '<article class="card"><header><slot name="header"></slot></header><div><slot></slot></div><footer><slot name="footer"></slot></footer></article>',
    "src/shared/components/card/style.css": "/* card */\n",
    "src/shared/components/button/index.html":
      '<a class="button button--{{variant}}" href="{{href}}" {{...props}}><slot /></a>',
    "src/shared/components/button/style.css": "/* button */\n",
    "src/shared/components/button/script.js": "// button\n",
    "src/shared/styles/reset.css": "/* shared */\n",
    "src/shared/js/base.js": "// shared js\n",
    "src/shared/assets/logo.txt": "asset",
  });
  try {
    const result = await build({ cwd: root, mode: "split", config: { minify: { css: false } } });
    assert.equal(result.config.baseRoute, "");
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    assert.match(html, /<header class="local-header">Local<\/header>/);
    assert.doesNotMatch(html, /shared-header/);
    assert.match(html, /<header><h2>Title<\/h2><\/header>/);
    assert.match(html, /<div><p>Body<\/p><\/div>/);
    assert.match(html, /<a class="button button--secondary" href="\/buy" id="buy" aria-label="Buy">Buy<\/a>/);
    assert.match(html, /href="\/style.css"/);
    assert.match(html, /src="\/script.js"/);
    const css = await readFile(join(root, "dist/style.css"), "utf8");
    assert.deepEqual(css, "/* local header */\n\n/* card */\n\n/* button */\n\n/* page */\n");
    const js = await readFile(join(root, "dist/script.js"), "utf8");
    assert.deepEqual(js, "// button\n\n// page\n");
    assert.match(html, /<link rel="stylesheet" href="\/styles\/reset.css">/);
    assert.match(html, /<script src="\/js\/base.js"><\/script>/);
    assert.equal(await readFile(join(root, "dist/styles/reset.css"), "utf8"), "/* shared */\n");
    assert.equal(await readFile(join(root, "dist/js/base.js"), "utf8"), "// shared js\n");
    assert.equal(await readFile(join(root, "dist/assets/logo.txt"), "utf8"), "asset");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hybrid inline build emits component and page resources in the same graph order", async () => {
  const root = await project({
    "src/pages/promo/index.html": '<html><head></head><body><use ref="banner"></use></body></html>',
    "src/pages/promo/style.css": "/* page */",
    "src/shared/components/banner/index.html": "<section>Banner</section>",
    "src/shared/components/banner/style.css": "/* banner */",
    "src/shared/components/banner/script.js": "const html = '</script>';",
  });
  try {
    await build({ cwd: root, mode: "inline", config: { minify: { css: false } } });
    const html = await readFile(join(root, "dist/promo/index.html"), "utf8");
    assert.match(html, /<style>\/\* banner \*\/<\/style><style>\/\* page \*\/<\/style>/);
    assert.match(html, /const html = '<\\\/script>';/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseRoute mounts root and nested pages with colocated assets", async () => {
  const root = await project({
    "nabi.config.js": 'export default { baseRoute: "partner/rabota" };\n',
    "src/pages/index.html":
      '<html><head></head><body><a href="/">Home</a><a href="/students">Students</a><a href="./students">Relative students</a><img src="@assets/logo.svg"></body></html>',
    "src/pages/students/index.html":
      '<html><head></head><body><a href="./">Current page</a><img src="@assets/logo.svg">Students</body></html>',
    "src/shared/assets/logo.svg": "<svg></svg>",
  });
  try {
    const result = await build({ cwd: root, mode: "split" });
    assert.equal(result.config.baseRoute, "partner/rabota");
    const index = await readFile(join(root, "dist/partner/rabota/index.html"), "utf8");
    assert.match(index, /src="\/partner\/rabota\/assets\/logo.svg"/);
    assert.match(index, /href="\/partner\/rabota">Home/);
    assert.match(index, /href="\/partner\/rabota\/students">Students/);
    assert.match(index, /href="\/partner\/rabota\/students">Relative students/);
    const students = await readFile(join(root, "dist/partner/rabota/students/index.html"), "utf8");
    assert.match(students, /src="\/partner\/rabota\/assets\/logo.svg"/);
    assert.match(students, /href="\/partner\/rabota\/students">Current page/);
    await readFile(join(root, "dist/partner/rabota/assets/logo.svg"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
