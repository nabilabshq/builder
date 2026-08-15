import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { init } from "../src/init.js";

const requiredDirectories = ["src/pages", "src/shared/components", "src/shared/styles", "src/shared/js"];
const starterScripts = {
  dev: "nabi dev",
  build: "nabi build",
  "build:inline": "nabi build --mode inline",
};

const createPackage = (root, manifest = {}) =>
  writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "starter", private: true, ...manifest }, null, 2)}\n`,
  );

test("initializes the minimal Nabi project structure", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-init-"));
  try {
    await createPackage(root);
    const result = await init({ cwd: root });
    assert.equal(result.cwd, root);
    assert.equal(result.packageCreated, false);
    assert.deepEqual(result.scripts, Object.keys(starterScripts));
    assert.deepEqual(
      result.directories,
      requiredDirectories.map((directory) => join(root, directory)),
    );
    await Promise.all(requiredDirectories.map((directory) => access(join(root, directory))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initialization is idempotent and preserves existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-init-"));
  const page = join(root, "src/pages/index.html");
  const stylesheet = join(root, "src/shared/styles/base.css");
  try {
    await createPackage(root);
    await init({ cwd: root });
    await writeFile(page, "<h1>Existing page</h1>");
    await writeFile(stylesheet, ".existing { color: teal; }");
    await init({ cwd: root });
    await init({ cwd: root });
    assert.equal(await readFile(page, "utf8"), "<h1>Existing page</h1>");
    assert.equal(await readFile(stylesheet, "utf8"), ".existing { color: teal; }");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initializes a Bun project and installs Nabi when package.json is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-init-"));
  const commands = [];
  const runBun = async ({ cwd, args }) => {
    commands.push({ cwd, args });
    if (args[0] === "init") await createPackage(cwd);
    if (args[0] === "add") {
      const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
      manifest.devDependencies = { "@nabilabs/builder": "latest" };
      await writeFile(join(cwd, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
  };
  try {
    const result = await init({ cwd: root, runBun });
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(result.packageCreated, true);
    assert.deepEqual(commands, [
      { cwd: root, args: ["init"] },
      { cwd: root, args: ["add", "-d", "@nabilabs/builder"] },
    ]);
    assert.deepEqual(manifest.scripts, starterScripts);
    assert.deepEqual(manifest.devDependencies, { "@nabilabs/builder": "latest" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adds missing starter scripts without replacing existing scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-init-"));
  try {
    await createPackage(root, { scripts: { dev: "vite", preview: "vite preview" } });
    const result = await init({ cwd: root });
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.deepEqual(result.scripts, ["build", "build:inline"]);
    assert.deepEqual(manifest.scripts, {
      dev: "vite",
      preview: "vite preview",
      build: "nabi build",
      "build:inline": "nabi build --mode inline",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
