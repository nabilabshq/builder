import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("loads optional nabi.config.js with production defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-config-"));
  try {
    await writeFile(
      join(root, "nabi.config.js"),
      'export default { outDir: "public", baseRoute: "/partner/rabota/", dev: { port: 4173 }, minify: { html: true }, images: { optimize: true } };\n',
    );
    const config = await loadConfig({ cwd: root });
    assert.equal(config.outDir, "public");
    assert.equal(config.dev.port, 4173);
    assert.equal(config.baseRoute, "partner/rabota");
    assert.equal(config.pagesDir, "pages");
    assert.equal(config.pagesPath, join(root, "src/pages"));
    assert.equal(config.sharedDir, "shared");
    assert.equal(config.sharedPath, join(root, "src/shared"));
    assert.deepEqual(config.minify, { html: true, css: true, js: false });
    assert.deepEqual(config.images, { optimize: true });
  } finally {
    await rm(root, { recursive: true, force: true });
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
  await assert.rejects(() => loadConfig({ config: { sharedDir: "src/shared" } }), /sharedDir is relative to src/);
});
