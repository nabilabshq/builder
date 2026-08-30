import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const distPath = resolve("dist");

const buildRuntime = async () => {
  const result = await Bun.build({
    entrypoints: ["./src/cli.ts", "./src/index.ts", "./src/language-server.ts"],
    format: "esm",
    naming: "[name].js",
    outdir: distPath,
    packages: "external",
    sourcemap: "linked",
    target: "node",
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }

    throw new Error("Runtime build failed.");
  }
};

const run = async (args: string[]) => {
  const process = Bun.spawn(args, {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await process.exited;

  if (exitCode !== 0) throw new Error(`${args.join(" ")} failed.`);
};

await rm(distPath, { force: true, recursive: true });
await buildRuntime();
await run([
  "bunx",
  "dts-bundle-generator",
  "--no-banner",
  "--out-file",
  "dist/index.d.ts",
  "--project",
  "tsconfig.types.json",
  "src/index.ts",
]);
