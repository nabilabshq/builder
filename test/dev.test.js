import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { startDev } from "../src/dev/server.js";

test("dev server serves compiled pages and injects live reload client", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-dev-"));
  try {
    const page = join(root, "src/pages/index.html");
    const style = join(root, "src/pages/style.css");
    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, "<html><body><h1>Dev page</h1></body></html>");
    await writeFile(style, "/* dev comment */\n.dev-page { color: red; }\n");
    const dev = await startDev({ cwd: root, port: 0 });
    try {
      const response = await fetch(dev.url);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /Dev page/);
      assert.match(html, /data-nabi-live-reload/);
      const css = await (await fetch(`${dev.url}/style.css`)).text();
      assert.match(css, /dev-page/);
      assert.match(css, /dev comment/);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev server maps hybrid page directories to routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-hybrid-dev-"));
  try {
    const home = join(root, "src/pages/index.html");
    const promo = join(root, "src/pages/promo/index.html");
    const about = join(root, "src/pages/about.html");
    const promoStyle = join(root, "src/pages/promo/style.css");
    await mkdir(dirname(home), { recursive: true });
    await mkdir(dirname(promo), { recursive: true });
    await mkdir(dirname(about), { recursive: true });
    const asset = join(root, "src/shared/assets/example.txt");
    await mkdir(dirname(asset), { recursive: true });
    await writeFile(home, "<html><body>Home</body></html>");
    await writeFile(promo, "<html><body>Promo</body></html>");
    await writeFile(about, "<html><body>About</body></html>");
    await writeFile(promoStyle, ".promo { color: purple; }");
    await writeFile(asset, "asset");
    const dev = await startDev({ cwd: root, port: 0 });
    try {
      assert.match(await (await fetch(dev.url)).text(), /Home/);
      assert.match(await (await fetch(`${dev.url}/promo`)).text(), /Promo/);
      assert.match(await (await fetch(`${dev.url}/promo/`)).text(), /Promo/);
      assert.match(await (await fetch(`${dev.url}/about?utm_source=test`)).text(), /About/);
      assert.match(await (await fetch(`${dev.url}/about/`)).text(), /About/);
      assert.match(await (await fetch(`${dev.url}/promo/style.css`)).text(), /purple/);
      assert.equal(await (await fetch(`${dev.url}/assets/example.txt`)).text(), "asset");
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev server serves explicitly declared shared styles and scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-shared-dev-"));
  try {
    const page = join(root, "src/pages/index.html");
    const style = join(root, "src/shared/styles/base.css");
    const script = join(root, "src/shared/js/site.js");
    await mkdir(dirname(page), { recursive: true });
    await mkdir(dirname(style), { recursive: true });
    await mkdir(dirname(script), { recursive: true });
    await writeFile(
      page,
      '<html><head><link use="base.css"></head><body><script use="site.js"></script></body></html>',
    );
    await writeFile(style, ".shared-base { color: teal; }\n");
    await writeFile(script, "window.nabiShared = true;\n");
    const dev = await startDev({ cwd: root, port: 0 });
    try {
      const html = await (await fetch(dev.url)).text();
      assert.match(html, /href="\/styles\/base.css"/);
      assert.match(html, /src="\/js\/site.js"/);
      assert.match(await (await fetch(`${dev.url}/styles/base.css`)).text(), /shared-base/);
      assert.match(await (await fetch(`${dev.url}/js/site.js`)).text(), /nabiShared/);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev server mounts pages and assets under configured baseRoute", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-based-dev-"));
  try {
    await writeFile(join(root, "nabi.config.js"), 'export default { baseRoute: "partner/rabota" };\n');
    const home = join(root, "src/pages/index.html");
    const students = join(root, "src/pages/students/index.html");
    const asset = join(root, "src/shared/assets/example.txt");
    await mkdir(dirname(home), { recursive: true });
    await mkdir(dirname(students), { recursive: true });
    await mkdir(dirname(asset), { recursive: true });
    await writeFile(home, "<html><body>Home</body></html>");
    await writeFile(students, "<html><body>Students</body></html>");
    await writeFile(asset, "asset");
    const dev = await startDev({ cwd: root, port: 0 });
    try {
      assert.match(dev.url, /\/partner\/rabota$/);
      assert.match(await (await fetch(dev.url)).text(), /Home/);
      assert.match(await (await fetch(`${dev.url}/students`)).text(), /Students/);
      assert.equal(await (await fetch(`${dev.url}/assets/example.txt`)).text(), "asset");
      assert.equal((await fetch(dev.url.replace(/\/partner\/rabota$/, "/"))).status, 404);
    } finally {
      await dev.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
