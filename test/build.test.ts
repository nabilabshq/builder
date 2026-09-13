import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { test } from "bun:test";

import { build } from "@/builder.ts";

const project = async (files: Record<string, string>) => {
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
    "src/pages/dashboard/index.html": "<html><head></head><body>Dashboard</body></html>",
    "src/pages/index.html":
      '<!doctype html><html><head></head><body><use ref="ui/card">Home</use><img src="@assets/logo.bin"></body></html>',
    "src/pages/script.js": "// page js\n",
    "src/pages/style.css": "/* page css */\n",
    "src/shared/assets/logo.bin": "binary-like\u0000content",
    "src/ui/card/index.html": "<article><slot /></article>",
    "src/ui/card/script.js": "// card js\n",
    "src/ui/card/style.css": "/* card css */\n",
  });

  try {
    const result = await build({ config: { minify: { css: false } }, cwd: root, mode: "split" });

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
    await rm(root, { force: true, recursive: true });
  }
});

test("build emits error pages without registering them as regular routes", async () => {
  const root = await project({
    "src/pages/404.css": ".error { color: red; }",
    "src/pages/404.html": '<html><head></head><body class="error">Missing</body></html>',
    "src/pages/index.html": "<html><head></head><body>Home</body></html>",
  });

  try {
    const result = await build({ config: { minify: { css: false } }, cwd: root });

    assert.equal(result.pages.length, 1);
    assert.match(await readFile(join(root, "dist/404.html"), "utf8"), /Missing/);
    assert.match(await readFile(join(root, "dist/404.html"), "utf8"), /href="\/404\/style.css"/);
    assert.match(await readFile(join(root, "dist/404/style.css"), "utf8"), /error/);
    await assert.rejects(() => readFile(join(root, "dist/404/index.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("build emits dynamic error pages for each route context", async () => {
  const root = await project({
    "src/data/cities.json": JSON.stringify({ msk: { name: "Moscow" }, spb: { name: "Saint Petersburg" } }),
    "src/pages/rabota/[city]/_route.json": JSON.stringify({ "@data": "cities.json" }),
    "src/pages/rabota/[city]/404.html": "<html><body>Missing {{:city.name}}</body></html>",
    "src/pages/rabota/[city]/index.html": "<html><body>{{:city.name}}</body></html>",
  });

  try {
    await build({ cwd: root });

    assert.match(await readFile(join(root, "dist/rabota/msk/404.html"), "utf8"), /Missing Moscow/);
    assert.match(await readFile(join(root, "dist/rabota/spb/404.html"), "utf8"), /Missing Saint Petersburg/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("blocks shared asset path traversal", async () => {
  const root = await project({
    "src/pages/index.html": '<html><body><img src="@assets/../../secret.png"></body></html>',
  });

  try {
    await assert.rejects(() => build({ cwd: root }), /escapes its configured directory/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("uses configured source directories when discovering global components", async () => {
  const root = await project({
    "source/pages/card/index.html": "<article>Card</article>",
    "source/site/index.html": '<html><body><use ref="pages/card" /></body></html>',
  });

  try {
    const result = await build({
      config: { pagesDir: "site", sharedDir: "common", srcDir: "source" },
      cwd: root,
    });

    assert.equal(result.componentCount, 1);
    assert.match(await readFile(join(root, "dist/index.html"), "utf8"), /<article>Card<\/article>/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("inline build embeds graph CSS and JavaScript safely", async () => {
  const root = await project({
    "src/pages/index.html": '<!doctype html><html><head></head><body><use ref="ui/banner" /></body></html>',
    "src/pages/style.css": ".hero::after { content: '</style>'; }\n",
    "src/ui/banner/index.html": "<section>Banner</section>",
    "src/ui/banner/script.js": "const markup = '</script>';\n",
    "src/ui/banner/style.css": "/* banner */\n",
  });

  try {
    await build({ config: { minify: { css: false } }, cwd: root, mode: "inline" });

    const html = await readFile(join(root, "dist/index.html"), "utf8");

    assert.match(html, /<style data-href="ui\/banner\/style.css">\/\* banner \*\//);
    assert.match(html, /<style data-href="pages\/style.css">\.hero::after/);
    assert.match(html, /<script data-src="ui\/banner\/script.js">const markup/);
    assert.match(html, /<\\\/style>/);
    assert.match(html, /const markup = '<\\\/script>';/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("build scopes classes from module.css files with a suffix hash", async () => {
  const root = await project({
    "src/pages/index.html":
      '<html><head></head><body><use ref="ui/card">Page</use><p class="copy theme">Copy</p></body></html>',
    "src/pages/module.css": ".copy { color: red; }",
    "src/pages/theme.module.css": ".theme { background: white; }",
    "src/ui/card/index.html": '<section class="card"><slot /></section>',
    "src/ui/card/module.css": ".card { color: blue; }",
  });

  try {
    await build({ config: { minify: { css: false } }, cwd: root, mode: "split" });

    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const css = await readFile(join(root, "dist/style.css"), "utf8");

    assert.match(html, /<section class="card--[\w-]+">Page<\/section>/);
    assert.match(html, /<p class="copy--[\w-]+ theme--[\w-]+">Copy<\/p>/);
    assert.match(css, /\.card--[\w-]+/);
    assert.match(css, /\.copy--[\w-]+/);
    assert.match(css, /\.theme--[\w-]+/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("body build emits a wrapper-free fragment with inline styles and JSON data scripts", async () => {
  const root = await project({
    "src/pages/index.html":
      '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><link use="fonts.css"></head><body><link use="normalize.css"><use ref="ui/card">Body content</use><script use="shared.js"></script><script>window.page = true;</script><script type="application/json">{"page":true}</script></body></html>',
    "src/pages/script.js": "// page script\n",
    "src/pages/style.css": "/* page style */\n",
    "src/shared/js/shared.js": "// shared script\n",
    "src/shared/styles/fonts.css": "/* fonts */\n",
    "src/shared/styles/normalize.css": "/* normalize */\n",
    "src/ui/card/index.html": '<section class="card"><slot/></section>',
    "src/ui/card/script.js": "// component script\n",
    "src/ui/card/style.css": "/* component style */\n",
  });

  try {
    await build({ config: { minify: { css: false } }, cwd: root, mode: "body" });

    const fragment = await readFile(join(root, "dist/index.html"), "utf8");

    assert.doesNotMatch(fragment, /<!doctype|<html|<head|<body|<meta/i);
    assert.match(fragment, /<style data-href="shared\/styles\/fonts.css">\/\* fonts \*\//);
    assert.match(fragment, /<style data-href="shared\/styles\/normalize.css">\/\* normalize \*\//);
    assert.match(fragment, /<style data-href="ui\/card\/style.css">\/\* component style \*\//);
    assert.match(fragment, /<style data-href="pages\/style.css">\/\* page style \*\//);
    assert.match(fragment, /<section class="card">Body content<\/section>/);
    assert.match(fragment, /<script type="application\/json">{"page":true}<\/script>/);
    assert.equal(fragment.match(/<script\b/g)?.length, 1);
    assert.doesNotMatch(fragment, /shared script|component script|page script|window\.page/);
    assert.ok(fragment.indexOf("shared/styles/normalize.css") < fragment.indexOf("ui/card/style.css"));
    assert.ok(fragment.indexOf("shared/styles/normalize.css") < fragment.indexOf('<section class="card">'));
    await assert.rejects(() => readFile(join(root, "dist/styles/fonts.css")));
    assert.equal(await readFile(join(root, "dist/js/shared.js"), "utf8"), "// shared script\n");
    assert.equal(await readFile(join(root, "dist/script.js"), "utf8"), "// component script\n\n// page script\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("body build flattens pages without scripts", async () => {
  const root = await project({
    "src/pages/with-script/index.html": "<html><body>With script</body></html>",
    "src/pages/with-script/script.js": "window.loaded = true;\n",
    "src/pages/without-script/index.html": "<html><body>Without script</body></html>",
  });

  try {
    await build({ cwd: root, mode: "body" });

    assert.match(await readFile(join(root, "dist/without-script.html"), "utf8"), /Without script/);
    await assert.rejects(() => access(join(root, "dist/without-script")));
    assert.match(await readFile(join(root, "dist/with-script/index.html"), "utf8"), /With script/);
    assert.equal(await readFile(join(root, "dist/with-script/script.js"), "utf8"), "window.loaded = true;\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("body build keeps parent index files beside nested route output", async () => {
  const root = await project({
    "src/pages/parent/child/index.html": "<html><body>Child</body></html>",
    "src/pages/parent/index.html": "<html><body>Parent</body></html>",
  });

  try {
    await build({ cwd: root, mode: "body" });

    assert.match(await readFile(join(root, "dist/parent/child.html"), "utf8"), /Child/);
    assert.match(await readFile(join(root, "dist/parent/index.html"), "utf8"), /Parent/);
    await assert.rejects(() => access(join(root, "dist/parent.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("body build keeps base route index files beside copied assets", async () => {
  const root = await project({
    "src/pages/index.html": "<html><body>Home</body></html>",
    "src/shared/assets/logo.svg": "<svg/>",
  });

  try {
    await build({ config: { baseRoute: "partner" }, cwd: root, mode: "body" });

    assert.match(await readFile(join(root, "dist/partner/index.html"), "utf8"), /Home/);
    assert.equal(await readFile(join(root, "dist/partner/assets/logo.svg"), "utf8"), "<svg/>");
    await assert.rejects(() => access(join(root, "dist/partner.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("minifies shared styles that are inlined for body builds", async () => {
  const root = await project({
    "src/pages/index.html": '<html><head><link use="fonts.css"></head><body>Content</body></html>',
    "src/shared/styles/fonts.css": "/* font styles */\n:root { --font-size: 16px; }\n",
  });

  try {
    await build({ cwd: root, mode: "body" });

    const fragment = await readFile(join(root, "dist/index.html"), "utf8");

    assert.doesNotMatch(fragment, /font styles/);
    assert.match(fragment, /<style data-href="shared\/styles\/fonts\.css">:root\{--font-size:16px\}<\/style>/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("minifies CSS by default and applies HTML and JavaScript minification only when enabled", async () => {
  const root = await project({
    "src/pages/index.html":
      "<!doctype html><html><head></head><body><!-- page comment --><h1> Hello Nabi </h1></body></html>",
    "src/pages/script.js": "const greeting = 'Nabi'; console.log(greeting);\n",
    "src/pages/style.css": "/* style comment */\n.card { color: red; }\n",
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

    await build({ config: { minify: { html: true, js: true } }, cwd: root, mode: "split" });

    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const javascript = await readFile(join(root, "dist/script.js"), "utf8");

    assert.doesNotMatch(html, /page comment/);
    assert.doesNotMatch(html, />\s+</);
    assert.match(javascript, /console\.log\("Nabi"\)/);
  } finally {
    await rm(root, { force: true, recursive: true });
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
    await rm(join(root, "src/pages/retired"), { force: true, recursive: true });
    await build({ cwd: root });
    await assert.rejects(() => access(join(root, "dist/retired/index.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("builds dynamic routes and interpolates their route data", async () => {
  const root = await project({
    "src/data/cities.json": JSON.stringify({
      msk: { from16: true, income: "до 250 000 ₽", name: "Москва" },
      spb: { from16: false, income: "до 230 000 ₽", name: "Санкт-Петербург" },
    }),
    "src/pages/partner/rabota/[city]/_route.json": JSON.stringify({ "@data": "cities.json" }),
    "src/pages/partner/rabota/[city]/index.html":
      "<html><body><h1>{{:city.name}}</h1><p>{{:city}}</p><p>{{:city.income}}</p><p>{{:unknown}}</p></body></html>",
    "src/pages/partner/rabota/[city]/students.html": "<html><body>{{:city.name}} {{:city.from16}}</body></html>",
    "src/pages/partner/rabota/[city]/style.css": ".city { color: blue; }",
  });

  try {
    const result = await build({ config: { minify: { css: false } }, cwd: root });

    assert.equal(result.pages.length, 4);
    assert.match(await readFile(join(root, "dist/partner/rabota/msk/index.html"), "utf8"), /Москва/);
    assert.match(await readFile(join(root, "dist/partner/rabota/msk/index.html"), "utf8"), /<p>msk<\/p>/);
    assert.match(await readFile(join(root, "dist/partner/rabota/msk/index.html"), "utf8"), /{{:unknown}}/);
    assert.match(
      await readFile(join(root, "dist/partner/rabota/spb/students/index.html"), "utf8"),
      /Санкт-Петербург false/,
    );
    assert.equal(await readFile(join(root, "dist/partner/rabota/msk/style.css"), "utf8"), ".city { color: blue; }");
    await assert.rejects(() => readFile(join(root, "dist/partner/rabota/[city]/index.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("builds conditional dynamic pages without exposing when to templates", async () => {
  const root = await project({
    "src/pages/partner/[folder]/_route.json": JSON.stringify(["perf", "rabota"]),
    "src/pages/partner/[folder]/[city]/_route.json": JSON.stringify({ "": {}, msk: {} }),
    "src/pages/partner/[folder]/[city]/[page]/_route.json": JSON.stringify({
      cpa: { "@when": { city: "", folder: "rabota" } },
    }),
    "src/pages/partner/[folder]/[city]/[page]/index.html":
      "<html><body>{{:folder}}|{{:city}}|{{:page}}|{{:when}}</body></html>",
  });

  try {
    const result = await build({ cwd: root });
    const source = await readFile(join(root, "dist/partner/rabota/cpa/index.html"), "utf8");

    assert.equal(result.pages.length, 1);
    assert.match(source, /rabota\|\|cpa\|{{:when}}/);
    await assert.rejects(() => readFile(join(root, "dist/partner/perf/cpa/index.html")));
    await assert.rejects(() => readFile(join(root, "dist/partner/rabota/msk/cpa/index.html")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("compiles conditional route content", async () => {
  const root = await project({
    "src/pages/[city]/_route.json": JSON.stringify({
      msk: { featureCombo: true },
      spb: { featureCombo: false },
    }),
    "src/pages/[city]/index.html":
      '<html><body><if when="{{:city.featureBike}}"><article id="feature-bike">Bike</article></if><use ref="ui/features" feature-combo="{{:city.featureCombo}}" /></body></html>',
    "src/ui/features/index.html":
      '<section><if when="{{feature-combo}}"><article id="feature-combo">Combo</article><else><article id="feature-default">Default</article></else></if></section>',
  });

  try {
    await build({ cwd: root });

    const moscow = await readFile(join(root, "dist/msk/index.html"), "utf8");
    const petersburg = await readFile(join(root, "dist/spb/index.html"), "utf8");

    assert.match(moscow, /<article id="feature-combo">Combo<\/article>/);
    assert.doesNotMatch(moscow, /feature-bike|feature-default|<if|<else/);
    assert.match(petersburg, /<article id="feature-default">Default<\/article>/);
    assert.doesNotMatch(petersburg, /feature-bike|feature-combo|<if|<else/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interpolates nested local route properties in component attributes", async () => {
  const root = await project({
    "src/pages/[page]/_route.json": JSON.stringify({
      "": {
        seo: {
          description: "Работа курьером на один день",
          title: "Приложение для работы курьером",
        },
        title: "Работа курьером",
      },
    }),
    "src/pages/[page]/index.html":
      '<html><body><use ref="ui/meta" description="{{:page.seo.description}}" /></body></html>',
    "src/ui/meta/index.html": '<meta name="description" content="{{description}}">',
  });

  try {
    await build({ cwd: root });

    const source = await readFile(join(root, "dist/index.html"), "utf8");

    assert.match(source, /content="Работа курьером на один день"/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
