import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "../src/builder.js";
import { init } from "../src/init.js";

test("initializer creates a two-page starter with shared components", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-starter-"));
  try {
    await writeFile(join(root, "package.json"), `{ "name": "starter", "private": true }\n`);
    const result = await init({ cwd: root });
    assert.equal(result.files.length, 9);
    await build({ cwd: root });

    const home = await readFile(join(root, "dist/index.html"), "utf8");
    const project = await readFile(join(root, "dist/project/index.html"), "utf8");
    assert.match(home, /Build plain HTML with reusable components/);
    assert.match(home, /button--primary/);
    assert.match(home, /button--secondary/);
    assert.match(home, /href="\/styles\/base.css"/);
    assert.match(home, /src="\/js\/site.js"/);
    assert.match(project, /Your first Nabi project is ready/);

    const repeated = await init({ cwd: root });
    assert.deepEqual(repeated.files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
