import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clean } from "../src/builder.js";

test("clean removes generated output without touching source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-clean-"));
  const page = join(root, "src/pages/index.html");
  const output = join(root, "dist/index.html");
  try {
    await mkdir(join(root, "src/pages"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(page, "<h1>Source</h1>");
    await writeFile(output, "<h1>Generated</h1>");
    await clean({ cwd: root });
    await assert.rejects(() => access(output));
    assert.equal(await readFile(page, "utf8"), "<h1>Source</h1>");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
