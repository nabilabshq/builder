import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "bun:test";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

type CliResult = { code: number; errors: string; output: string };

const runCli = async (cwd: string, args: string[]): Promise<CliResult> => {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { code, errors, output };
};

test("CLI reports build duration", async () => {
  const root = await mkdtemp(join(tmpdir(), "nabi-cli-build-"));

  try {
    await mkdir(join(root, "src/pages"), { recursive: true });
    await writeFile(join(root, "src/pages/index.html"), "<html><body>Home</body></html>");

    const built = await runCli(root, ["build"]);

    assert.equal(built.code, 0);
    assert.match(built.output, /Building project\.\.\./);
    assert.ok(built.output.includes(`Output: ${join(root, "dist")}`));
    assert.match(built.output, /built in \d+(?:ms|\.\d+s)/);

    const unknown = await runCli(root, ["init"]);

    assert.equal(unknown.code, 1);
    assert.match(unknown.errors, /Use: nabi <build\|dev\|clean>/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
