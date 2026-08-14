import { mkdir, readFile, rename } from "node:fs/promises";
import { join, relative } from "node:path";

import { injectGeneratedResources } from "../compiler/dependencies.js";
import { copyTree, listFiles, remove, writeText } from "../utils/files.js";
import { minifyCss, minifyHtml, minifyJs } from "./minify.js";

const temporaryPath = (config) => join(config.cwd, ".nabi-build-temp");
const backupPath = (config) => join(config.cwd, ".nabi-build-backup");
const retryableRenameError = (error) => ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const renameWithRetry = async (source, destination) => {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableRenameError(error) || attempt === 9) throw error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
};

const syncOutput = async (config, temporary) => {
  const expectedFiles = new Set((await listFiles(temporary)).map((path) => relative(temporary, path)));
  await copyTree(temporary, config.outPath);
  const staleFiles = (await listFiles(config.outPath)).filter(
    (path) => !expectedFiles.has(relative(config.outPath, path)),
  );
  await Promise.all(staleFiles.map(remove));
  await remove(temporary);
};

const replaceOutput = async (config, temporary) => {
  const backup = backupPath(config);
  await remove(backup);
  let oldOutputMoved = false;
  try {
    try {
      await renameWithRetry(config.outPath, backup);
      oldOutputMoved = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await renameWithRetry(temporary, config.outPath);
    if (oldOutputMoved) await remove(backup);
  } catch (error) {
    if (oldOutputMoved) {
      try {
        await renameWithRetry(backup, config.outPath);
      } catch {
        // The original output could not be restored after a failed replacement.
      }
    }
    if (!oldOutputMoved && retryableRenameError(error)) {
      await syncOutput(config, temporary);
      return;
    }
    throw error;
  }
};

const readResources = async ({ resources, minify }) => ({
  css: await Promise.all(
    resources.css.map(async (path) => {
      const source = await readFile(path, "utf8");
      return minify.css ? minifyCss(source) : source;
    }),
  ),
  js: await Promise.all(
    resources.js.map(async (path) => {
      const source = await readFile(path, "utf8");
      return minify.js ? minifyJs(source) : source;
    }),
  ),
});

const publicResourcePath = (page, fileName) => `/${[page.publicRoute, fileName].filter(Boolean).join("/")}`;

const writeSharedDependencies = async ({ config, pages, temporary }) => {
  const styles = [...new Set(pages.flatMap((page) => page.dependencies.styles))];
  const scripts = [...new Set(pages.flatMap((page) => page.dependencies.scripts))];
  await Promise.all(
    styles.map(async (path) => {
      const output = join(temporary, config.baseRoute, "styles", relative(config.sharedStylesPath, path));
      const source = await readFile(path, "utf8");
      await writeText(output, config.minify.css ? minifyCss(source) : source);
    }),
  );
  await Promise.all(
    scripts.map(async (path) => {
      const output = join(temporary, config.baseRoute, "js", relative(config.sharedJsPath, path));
      const source = await readFile(path, "utf8");
      await writeText(output, config.minify.js ? await minifyJs(source) : source);
    }),
  );
};

const writeHybridBuild = async ({ config, pages, mode, temporary }) => {
  await copyTree(config.assetsPath, join(temporary, config.baseRoute, "assets"));
  await writeSharedDependencies({ config, pages, temporary });
  const manifest = {};
  for (const page of pages) {
    const resources = await readResources({ resources: page.resources, minify: config.minify });
    const isInline = mode === "inline";
    const html = injectGeneratedResources({
      html: page.html,
      css: isInline ? resources.css : resources.css.length ? [publicResourcePath(page, "style.css")] : [],
      js: isInline ? resources.js : resources.js.length ? [publicResourcePath(page, "script.js")] : [],
      inline: isInline,
    });
    const outputPath = page.outputPath;
    await writeText(join(temporary, outputPath), config.minify.html ? await minifyHtml(html) : html);
    if (!isInline) {
      if (resources.css.length) await writeText(join(temporary, page.outputDir, "style.css"), resources.css.join("\n"));
      if (resources.js.length) await writeText(join(temporary, page.outputDir, "script.js"), resources.js.join("\n"));
      manifest[outputPath] = {
        css: resources.css.length ? [[page.outputDir, "style.css"].filter((part) => part !== ".").join("/")] : [],
        js: resources.js.length ? [[page.outputDir, "script.js"].filter((part) => part !== ".").join("/")] : [],
      };
    }
  }
  if (mode === "split") await writeText(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
};

export const writeBuild = async ({ config, pages, mode }) => {
  const temporary = temporaryPath(config);
  await remove(temporary);
  await mkdir(temporary, { recursive: true });
  try {
    await writeHybridBuild({ config, pages, mode, temporary });
    await replaceOutput(config, temporary);
  } catch (error) {
    await remove(temporary);
    throw error;
  }
};
