#!/usr/bin/env node
import { build, clean } from "./builder.js";
import { startDev } from "./dev/server.js";
import { init } from "./init.js";
import { formatError, NabiError } from "./utils/errors.js";

const args = process.argv.slice(2);
const command = args[0] ?? "build";
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const hasHelp = () => args.includes("--help") || args.includes("-h");

const printHelp = () => {
  console.log(
    `Nabi\n\nUsage: nabi <command> [options]\n\nCommands:\n  init [directory]       Create a starter project\n  build [--mode <mode>]  Build the project\n  dev [--port <port>]    Start the development server\n  clean                  Remove generated files\n\nRun \`nabi <command> --help\` for command details.`,
  );
};

const printCommandHelp = (usage, description) => {
  console.log(`Nabi\n\nUsage: ${usage}\n\n${description}`);
};

const printBuild = (result) => {
  console.log(`\nNabi build\n\nMode: ${result.mode}\n`);
  for (const page of result.pages) console.log(`✓ ${page.outputPath}`);
  console.log(`\n${result.pages.length} pages\n${result.componentCount} components\nOutput: ${result.config.outDir}`);
};

const printInit = (result) => {
  console.log(`Nabi init\n\nInitialized: ${result.cwd}`);
};

const run = async () => {
  if (command === "help" || (hasHelp() && args.length === 1)) return printHelp();
  if (command === "init") {
    if (hasHelp())
      return printCommandHelp(
        "nabi init [directory]",
        "Create a starter project in the current directory or the specified directory.",
      );
    const directories = args.slice(1).filter((value) => !value.startsWith("-"));
    if (directories.length > 1)
      throw new NabiError("Nabi init accepts at most one directory\nUse: nabi init [directory]");
    return printInit(await init({ cwd: directories[0] }));
  }
  if (command === "build") {
    if (hasHelp()) return printCommandHelp("nabi build [--mode split|inline]", "Build the current Nabi project.");
    return printBuild(await build({ mode: option("--mode") }));
  }
  if (command === "clean") {
    if (hasHelp())
      return printCommandHelp("nabi clean", "Remove generated output and build cache from the current project.");
    await clean({});
    console.log("Nabi clean\n\n✓ dist and build cache removed");
    return;
  }
  if (command === "dev") {
    if (hasHelp())
      return printCommandHelp("nabi dev [--port <port>]", "Start the development server for the current Nabi project.");
    const port = option("--port");
    const dev = await startDev({ port: port ? Number(port) : undefined });
    console.log(`\nNabi dev\n\nLocal:\n${dev.url}\n\nWatching src/...`);
    return;
  }
  throw new NabiError(`Unknown command: ${command}\nUse: nabi <init|build|dev|clean>`);
};

run().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
