import chokidar from "chokidar";

let building = false;
let pending = false;

const build = async () => {
  if (building) {
    pending = true;

    return;
  }

  building = true;

  do {
    pending = false;

    const child = Bun.spawn([process.execPath, "run", "scripts/build.ts"], {
      stderr: "inherit",
      stdout: "inherit",
    });
    const exitCode = await child.exited;

    if (exitCode !== 0) {
      console.error("Package build failed. Waiting for the next change...");
    }
  } while (pending);

  building = false;
};

const watcher = chokidar.watch(["src", "tsconfig.types.json"], { ignoreInitial: true });

watcher.on("all", (_event: string, path: string) => {
  console.log(`Rebuilding package after ${path} changed...`);
  void build();
});

console.log("Building package...");
await build();
console.log("Watching src for package rebuilds...");

await new Promise<void>((resolve) => {
  const close = () => {
    void watcher.close().then(resolve);
  };

  process.once("SIGINT", close);
  process.once("SIGTERM", close);
});
