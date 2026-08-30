import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";

import { build } from "@/builder.ts";

const project = async (files: Record<string, string>) => {
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
    "src/pages/@header/index.html": '<header class="local-header">Local</header>',
    "src/pages/@header/style.css": "/* local header */\n",
    "src/pages/index.html":
      '<!doctype html><html><head><title>Home</title><link use="reset.css"></head><body><use ref="@header" /><use ref="ui/card"><h2 slot="header">Title</h2><p>Body</p><use ref="ui/button" slot="footer" href="/buy" variant="secondary" id="buy" aria-label="Buy">Buy</use></use><script use="base.js"></script></body></html>',
    "src/pages/script.js": "// page\n",
    "src/pages/style.css": "/* page */\n",
    "src/shared/assets/logo.txt": "asset",
    "src/shared/js/base.js": "// shared js\n",
    "src/shared/styles/reset.css": "/* shared */\n",
    "src/ui/button/index.html": '<a class="button button--{{variant}}" href="{{href}}" {{...props}}><slot /></a>',
    "src/ui/button/script.js": "// button\n",
    "src/ui/button/style.css": "/* button */\n",
    "src/ui/card/index.html":
      '<article class="card"><header><slot name="header"></slot></header><div><slot></slot></div><footer><slot name="footer"></slot></footer></article>',
    "src/ui/card/style.css": "/* card */\n",
    "src/ui/header/index.html": '<header class="shared-header">Shared</header>',
    "src/ui/header/style.css": "/* shared header */\n",
  });

  try {
    const result = await build({ config: { minify: { css: false } }, cwd: root, mode: "split" });

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
    await rm(root, { force: true, recursive: true });
  }
});

test("hybrid inline build emits component and page resources in the same graph order", async () => {
  const root = await project({
    "src/pages/promo/index.html": '<html><head></head><body><use ref="ui/banner" /></body></html>',
    "src/pages/promo/style.css": "/* page */",
    "src/ui/banner/index.html": "<section>Banner</section>",
    "src/ui/banner/script.js": "const html = '</script>';",
    "src/ui/banner/style.css": "/* banner */",
  });

  try {
    await build({ config: { minify: { css: false } }, cwd: root, mode: "inline" });

    const html = await readFile(join(root, "dist/promo/index.html"), "utf8");

    assert.match(
      html,
      /<style data-href="ui\/banner\/style\.css">\/\* banner \*\/<\/style><style data-href="pages\/promo\/style\.css">\/\* page \*\/<\/style>/,
    );
    assert.match(html, /const html = '<\\\/script>';/);
  } finally {
    await rm(root, { force: true, recursive: true });
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
    await rm(root, { force: true, recursive: true });
  }
});

test("resolves namespaced global components and nearest local @ components", async () => {
  const root = await project({
    "src/modules/carousel/index.html": '<section class="carousel">Carousel</section>',
    "src/pages/partners/@button/index.html": '<button class="outer">Outer</button>',
    "src/pages/partners/index.html": '<html><body><use ref="@button" /></body></html>',
    "src/pages/partners/special/@button/index.html": '<button class="nearest">Nearest</button>',
    "src/pages/partners/special/index.html":
      '<html><body><use ref="@button" /><use ref="ui/button" /><use ref="modules/carousel" /></body></html>',
    "src/ui/button/index.html": '<button class="global">Global</button>',
  });

  try {
    await build({ cwd: root });

    const parent = await readFile(join(root, "dist/partners/index.html"), "utf8");
    const nested = await readFile(join(root, "dist/partners/special/index.html"), "utf8");

    assert.match(parent, /outer/);
    assert.match(nested, /nearest/);
    assert.match(nested, /global/);
    assert.match(nested, /carousel/);
    assert.doesNotMatch(nested, /outer/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("excludes a configured pages directory from global components", async () => {
  const root = await project({
    "src/partner/@header/index.html": "<header>Header</header>",
    "src/partner/blog/index.html": "<html><body>Blog</body></html>",
    "src/partner/index.html": '<html><body><use ref="ui/footer" /><use ref="@header" /></body></html>',
    "src/ui/footer/index.html": "<footer>Footer</footer>",
  });

  try {
    const result = await build({
      config: { baseRoute: "partner/", minify: { css: false }, pagesDir: "partner" },
      cwd: root,
    });

    assert.equal(result.componentCount, 2);

    const output = await readFile(join(root, "dist/partner/index.html"), "utf8");

    assert.match(output, /<footer>Footer<\/footer><header>Header<\/header>/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps nested local components private to their root component", async () => {
  const root = await project({
    "src/pages/@header/@window.html": "<aside>Menu</aside>",
    "src/pages/@header/index.html": '<header><use ref="@header/window" /></header>',
    "src/pages/@steps/index.html": '<section><use ref="@header/window" /></section>',
    "src/pages/index.html": '<html><body><use ref="@header" /><use ref="@steps" /></body></html>',
  });

  try {
    await assert.rejects(
      () => build({ cwd: root }),
      /Nested local component "@header\/window" is private to "@header"/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
