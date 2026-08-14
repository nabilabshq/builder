#!/usr/bin/env node
import { build, clean } from "./builder.js";
import { startDev } from "./dev/server.js";
import { formatError, NabiError } from "./utils/errors.js";

const args = process.argv.slice(2);
const command = args[0] ?? "build";
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const printBuild = (result) => {
  console.log(`\nNabi build\n\nMode: ${result.mode}\n`);
  for (const page of result.pages) console.log(`✓ ${page.outputPath}`);
  console.log(`\n${result.pages.length} pages\n${result.componentCount} components\nOutput: ${result.config.outDir}`);
};

const run = async () => {
  if (command === "build") return printBuild(await build({ mode: option("--mode") }));
  if (command === "clean") {
    await clean({});
    console.log("Nabi clean\n\n✓ dist and build cache removed");
    return;
  }
  if (command === "dev") {
    const port = option("--port");
    const dev = await startDev({ port: port ? Number(port) : undefined });
    console.log(`\nNabi dev\n\nLocal:\n${dev.url}\n\nWatching src/...`);
    return;
  }
  throw new NabiError(`Unknown command: ${command}\nUse: nabi [build|dev|clean]`);
};

run().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
