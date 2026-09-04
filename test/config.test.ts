import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "bun:test";

import { defineConfig, loadConfig } from "@/config.ts";

test("config preserves the JavaScript configuration object", () => {
  const value = { baseRoute: "partner", pagesDir: "partner" };

  assert.equal(defineConfig(value), value);
});

test("loads optional nabi.config.js with production defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-config-"));

  try {
    await writeFile(
      join(root, "nabi.config.js"),
      'export default { outDir: "public", baseRoute: "/partner/rabota/", defaultBuildMode: "body", dev: { port: 4173 }, minify: { html: true }, images: { optimize: true } };\n',
    );

    const config = await loadConfig({ cwd: root });

    assert.equal(config.outDir, "public");
    assert.equal(config.dev.port, 4173);
    assert.equal(config.baseRoute, "partner/rabota");
    assert.equal(config.pagesDir, "pages");
    assert.equal(config.pagesPath, join(root, "src/pages"));
    assert.equal(config.sharedDir, "shared");
    assert.equal(config.sharedPath, join(root, "src/shared"));
    assert.equal(config.defaultBuildMode, "body");
    assert.deepEqual(config.minify, { css: true, html: true, js: false });
    assert.deepEqual(config.images, { optimize: true });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("requires pagesDir to be a single directory inside src", async () => {
  await assert.rejects(
    () => loadConfig({ config: { pagesDir: "src/partner" } }),
    /pagesDir must be a single directory name inside src/,
  );
  await assert.rejects(
    () => loadConfig({ config: { pagesDir: "partner/second" } }),
    /pagesDir must be a single directory name inside src/,
  );
});

test("allows sharedDir paths relative to src", async () => {
  const config = await loadConfig({ config: { sharedDir: "src/shared", srcDir: "source" } });

  assert.equal(config.sharedDir, "src/shared");
  assert.equal(config.sharedPath, join(config.srcPath, "src/shared"));
});

test("uses and validates the JSON data directory", async () => {
  const config = await loadConfig({ config: { dataDir: "content/data" } });

  assert.equal(config.dataDir, "content/data");
  await assert.rejects(() => loadConfig({ config: { dataDir: "../data" } }), /dataDir must be a relative directory/);
});

test("uses and validates the dynamic route file name", async () => {
  const config = await loadConfig({ config: { routeFileName: "routes" } });

  assert.equal(config.routeFileName, "routes");
  await assert.rejects(
    () => loadConfig({ config: { routeFileName: "routes.json" } }),
    /routeFileName must be a filename without an extension/,
  );
});

test("requires dev.port to be an integer between 1 and 65535", async () => {
  for (const port of [NaN, Infinity, -1, 3.14, 65536]) {
    await assert.rejects(
      () => loadConfig({ config: { dev: { port } } }),
      /dev\.port must be an integer between 1 and 65535/,
    );
  }
});

test("rejects unsafe source, output, and shared directory configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-config-"));

  try {
    await assert.rejects(
      () => loadConfig({ config: { srcDir: "../src" }, cwd: root }),
      /srcDir must be a relative directory/,
    );
    await assert.rejects(
      () => loadConfig({ config: { sharedDir: "../shared" }, cwd: root }),
      /sharedDir is relative to src/,
    );
    await assert.rejects(
      () => loadConfig({ config: { outDir: "src" }, cwd: root }),
      /srcDir and outDir must not overlap/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
