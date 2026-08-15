import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const directories = ["src/pages", "src/shared/components", "src/shared/styles", "src/shared/js"];

const runCli = (cwd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, errors, output }));
  });

test("CLI initializes a project in a target directory and provides command help", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-cli-init-"));
  try {
    await mkdir(join(root, "starter"), { recursive: true });
    await writeFile(join(root, "starter", "package.json"), `{ "name": "starter", "private": true }\n`);
    const initialized = await runCli(root, ["init", "starter"]);
    assert.equal(initialized.code, 0);
    assert.match(initialized.output, /Initialized:.*starter/);
    await Promise.all(directories.map((directory) => access(join(root, "starter", directory))));

    const help = await runCli(root, ["init", "--help"]);
    assert.equal(help.code, 0);
    assert.match(help.output, /Usage: nabi init \[directory\]/);

    const unknown = await runCli(root, ["unknown"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.errors, /Use: nabi <init\|build\|dev\|clean>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
