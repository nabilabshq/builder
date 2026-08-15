import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { NabiError } from "./utils/errors.js";

const directories = ["src/pages", "src/shared/components", "src/shared/styles", "src/shared/js"];
const starterScripts = {
  dev: "nabi dev",
  build: "nabi build",
  "build:inline": "nabi build --mode inline",
};
const starterFiles = {
  "src/pages/index.html": `<!doctype html>
<html lang="en">
  <head>
    <use ref="head" title="Nabi starter"></use>
  </head>
  <body>
    <main class="welcome">
      <p class="welcome__eyebrow">Nabi starter</p>
      <h1>Build plain HTML with reusable components.</h1>
      <p class="welcome__copy">Start with this small multi-page project, then make it your own.</p>
      <div class="welcome__actions">
        <use ref="button" href="/project" variant="primary">Open the project</use>
        <use ref="button" href="https://github.com/nabilabshq/builder" variant="secondary" target="_blank">Read the guide</use>
      </div>
    </main>
    <use ref="footer"></use>
  </body>
</html>
`,
  "src/pages/project/index.html": `<!doctype html>
<html lang="en">
  <head>
    <use ref="head" title="Nabi project"></use>
  </head>
  <body>
    <main class="welcome">
      <p class="welcome__eyebrow">Project page</p>
      <h1>Your first Nabi project is ready.</h1>
      <p class="welcome__copy">Pages follow the file system, while components stay shared and predictable.</p>
      <div class="welcome__actions">
        <use ref="button" href="/" variant="primary">Back home</use>
        <use ref="button" href="https://github.com/nabilabshq/builder" variant="secondary" target="_blank">View documentation</use>
      </div>
    </main>
    <use ref="footer"></use>
  </body>
</html>
`,
  "src/shared/components/button/index.html": `---
variants: primary | secondary
---
<a class="button button--{{variant}}" href="{{href}}" {{...props}}><slot></slot></a>
`,
  "src/shared/components/button/style.css": `.button {
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  display: inline-flex;
  font-weight: 650;
  gap: 0.5rem;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.75rem 1.125rem;
  text-decoration: none;
  transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;

  &:hover {
    transform: translateY(-1px);
  }

  &.button--primary {
    background: #646cff;
    color: #fff;
  }

  &.button--secondary {
    background: #fff;
    border-color: #d9d9e8;
    color: #24243a;
  }
}
`,
  "src/shared/components/head/index.html": `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="A Nabi static website starter.">
  <title>{{title}}</title>
  <link use="base.css">
  <script use="site.js" defer></script>
</head>
`,
  "src/shared/components/footer/index.html": `<footer class="footer">
  <p>Built with Nabi.</p>
  <a href="/">Back to home</a>
</footer>
`,
  "src/shared/components/footer/style.css": `.footer {
  align-items: center;
  border-top: 1px solid #e6e6ef;
  color: #69697c;
  display: flex;
  font-size: 0.875rem;
  justify-content: space-between;
  margin: 0 auto;
  max-width: 68rem;
  padding: 1.5rem;

  a {
    color: inherit;
  }
}
`,
  "src/shared/styles/base.css": `:root {
  color: #24243a;
  background: #f7f7fb;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 20rem;
}

.welcome {
  display: grid;
  gap: 1.5rem;
  margin: 0 auto;
  max-width: 48rem;
  min-height: calc(100vh - 5.25rem);
  padding: clamp(5rem, 15vh, 10rem) 1.5rem 3rem;
  place-content: center start;

  h1,
  p {
    margin: 0;
  }
}

.welcome__eyebrow {
  color: #646cff;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.welcome__copy {
  color: #69697c;
  font-size: 1.125rem;
  line-height: 1.6;
  max-width: 38rem;
}

.welcome__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
`,
  "src/shared/js/site.js": `document.documentElement.dataset.nabi = "ready";
`,
};

const createStarterFile = async ({ root, path, source }) => {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, source, { flag: "wx" });
    return target;
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
};

const runBunCommand = ({ cwd, args }) =>
  new Promise((resolve, reject) => {
    const child = spawn("bun", args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve();
      reject(new NabiError(`Bun command failed: bun ${args.join(" ")}`));
    });
  });

const readPackage = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    if (error instanceof SyntaxError) throw new NabiError(`Invalid package.json: ${path}`);
    throw error;
  }
};

const addStarterScripts = async ({ packagePath }) => {
  const manifest = await readPackage(packagePath);
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    throw new NabiError(`Invalid package.json: ${packagePath}`);
  }
  if (manifest.scripts && (Array.isArray(manifest.scripts) || typeof manifest.scripts !== "object")) {
    throw new NabiError(`Invalid package.json scripts: ${packagePath}`);
  }
  const scripts = manifest.scripts ?? {};
  const added = Object.entries(starterScripts).filter(([name]) => !Object.hasOwn(scripts, name));
  if (added.length === 0) return [];
  manifest.scripts = { ...scripts, ...Object.fromEntries(added) };
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return added.map(([name]) => name);
};

export const init = async ({ cwd = process.cwd(), runBun = runBunCommand } = {}) => {
  const root = resolve(cwd);
  const packagePath = resolve(root, "package.json");
  await mkdir(root, { recursive: true });
  const packageCreated = (await readPackage(packagePath)) === undefined;
  if (packageCreated) {
    await runBun({ cwd: root, args: ["init"] });
    await runBun({ cwd: root, args: ["add", "-d", "@nabilabs/builder"] });
  }
  const scripts = await addStarterScripts({ packagePath });
  const paths = directories.map((directory) => resolve(root, directory));
  await Promise.all(paths.map((path) => mkdir(path, { recursive: true })));
  const files = await Promise.all(
    Object.entries(starterFiles).map(([path, source]) => createStarterFile({ root, path, source })),
  );
  return { cwd: root, directories: paths, files: files.filter(Boolean), packageCreated, packagePath, scripts };
};
