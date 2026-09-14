#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import chokidar from "chokidar";

import { createBuildProgressRenderer } from "@/build/progress";
import { build, clean } from "@/builder";
import { startDev } from "@/dev";
import type { BuildMode } from "@/types";
import { formatError, NabiError } from "@/utils/errors";

const args = process.argv.slice(2);
const command = args[0] ?? "build";
const devWorkerFlag = "--nabi-dev-worker";
const isDevWorker = args.includes(devWorkerFlag);

const option = (name: string) => {
  const index = args.indexOf(name);

  return index === -1 ? undefined : args[index + 1];
};

const hasHelp = () => args.includes("--help") || args.includes("-h");
const isBuildMode = (value: string): value is BuildMode => {
  return value === "split" || value === "inline" || value === "body";
};

const displayDuration = (milliseconds: number) => {
  return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
};

const normaliseBuildMode = (value: string | undefined) => {
  if (value === undefined) return;

  if (!isBuildMode(value)) throw new NabiError(`Unknown build mode: ${value}. Use split, inline, or body.`);

  return value;
};

const normalisePort = (value: string | undefined) => {
  if (value === undefined) return;

  const port = Number(value);

  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new NabiError("--port must be an integer between 1 and 65535.");
  }

  return port;
};

const printHelp = () => {
  console.log(
    `Nabi\n\nUsage: nabi <command> [options]\n\nCommands:\n  build [--mode <mode>]  Build the project\n  dev [--port <port>]    Start the development server\n  clean                  Remove generated files\n\nRun \`nabi <command> --help\` for command details.`,
  );
};

const printCommandHelp = (usage: string, description: string) => {
  console.log(`Nabi\n\nUsage: ${usage}\n\n${description}`);
};

const printBuild = ({ duration, ...result }: Awaited<ReturnType<typeof build>> & { duration: number }) => {
  console.log(`\nNabi build\n\nMode: ${result.mode}\n`);

  for (const page of result.pages) {
    console.log(`✓ ${page.outputPath}`);
  }

  console.log(
    `\n${result.pages.length} pages\n${result.componentCount} components\nOutput: ${result.config.outPath}\n\n✓ built in ${displayDuration(duration)}\n`,
  );
};

const workerExitFor = (worker: ReturnType<typeof spawn>) =>
  new Promise<number>((resolve) => {
    worker.once("error", () => resolve(1));
    worker.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });

const superviseDev = async () => {
  const cliPath = fileURLToPath(import.meta.url);
  const watcher = chokidar.watch(dirname(cliPath), { ignoreInitial: true });

  let closed = false;
  let restarting = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let worker: ReturnType<typeof spawn>;
  let workerExit: Promise<number>;

  const startWorker = () => {
    worker = spawn(process.execPath, [cliPath, ...args, devWorkerFlag], { stdio: "inherit" });
    workerExit = workerExitFor(worker);
  };

  startWorker();

  await new Promise<void>((resolve) => {
    const close = async (exitCode = 0) => {
      if (closed) return;

      closed = true;

      if (restartTimer) {
        clearTimeout(restartTimer);
      }

      worker.kill();
      await Promise.all([watcher.close(), workerExit]);

      if (exitCode) {
        process.exitCode = exitCode;
      }

      resolve();
    };

    const restart = async () => {
      if (closed || restarting) return;

      restarting = true;
      worker.kill();
      await workerExit;
      restarting = false;

      if (closed) return;

      console.log("\nNabi Builder changed. Restarting development server...");
      startWorker();

      void workerExit.then((exitCode) => {
        if (!restarting) {
          void close(exitCode);
        }
      });
    };

    const scheduleRestart = (path: string) => {
      if (path !== cliPath || closed) return;

      if (restartTimer) {
        clearTimeout(restartTimer);
      }

      restartTimer = setTimeout(() => void restart(), 100);
    };

    watcher.on("add", scheduleRestart);
    watcher.on("change", scheduleRestart);

    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());

    void workerExit.then((exitCode) => {
      if (!restarting) void close(exitCode);
    });
  });
};

const run = async () => {
  if (command === "help" || (hasHelp() && args.length === 1)) return printHelp();

  if (command === "build") {
    if (hasHelp()) {
      return printCommandHelp("nabi build [--mode split|inline|body]", "Build the current Nabi project.");
    }

    const mode = normaliseBuildMode(option("--mode"));

    console.log("\nBuilding project...");

    const startedAt = performance.now();
    const progress = createBuildProgressRenderer();
    let result: Awaited<ReturnType<typeof build>>;

    try {
      progress.discovering();
      result = await build({
        mode,
        onBuildStarted: progress.begin,
        onOutputStage: progress.output,
        onPageBuilt: progress.update,
      });
    } finally {
      progress.finish();
    }

    return printBuild({ ...result, duration: performance.now() - startedAt });
  }

  if (command === "clean") {
    if (hasHelp()) {
      return printCommandHelp("nabi clean", "Remove generated output and build cache from the current project.");
    }

    await clean({});
    console.log("Nabi clean\n\n✓ dist and build cache removed");

    return;
  }

  if (command === "dev") {
    if (hasHelp()) {
      return printCommandHelp("nabi dev [--port <port>]", "Start the development server for the current Nabi project.");
    }

    if (!isDevWorker) return superviseDev();

    const rawPort = option("--port");

    if (args.includes("--port") && rawPort === undefined) {
      throw new NabiError("--port requires a value.");
    }

    const port = normalisePort(rawPort);
    const dev = await startDev({ port });

    console.log(`\nNabi dev\n\nLocal:\n${dev.url}\n\nWatching src/...`);

    return;
  }

  throw new NabiError(`Unknown command: ${command}\nUse: nabi <build|dev|clean>`);
};

run().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
