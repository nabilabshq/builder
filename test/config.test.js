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
    assert.deepEqual(config.minify, { html: true, css: true, js: false });
    assert.deepEqual(config.images, { optimize: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
