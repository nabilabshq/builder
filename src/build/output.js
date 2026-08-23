import { mkdir, readFile, rename } from "node:fs/promises";
import { join, relative } from "node:path";

import * as parse5 from "parse5";

import { compileCssModule } from "../compiler/css-modules.js";
import { injectGeneratedResources } from "../compiler/dependencies.js";
import { copyTree, listFiles, remove, writeText } from "../utils/files.js";
import { minifyCss, minifyHtml, minifyJs } from "./minify.js";

const temporaryPath = (config) => join(config.cwd, ".nabi-build-temp");
const backupPath = (config) => join(config.cwd, ".nabi-build-backup");
const retryableRenameError = (error) => ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code);

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
      await rename(config.outPath, backup);
      oldOutputMoved = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, config.outPath);
    if (oldOutputMoved) await remove(backup);
  } catch (error) {
    if (retryableRenameError(error)) {
      await syncOutput(config, temporary);
      if (oldOutputMoved) await remove(backup);
      return;
    }
    if (oldOutputMoved) {
      try {
        await rename(backup, config.outPath);
      } catch {
        // The original output could not be restored after a failed replacement.
      }
    }
    throw error;
  }
};

const cached = async ({ cache, path, read }) => {
  const existing = cache.get(path);
  if (existing) return existing;
  const value = read();
  cache.set(path, value);
  return value;
};

const readResources = async ({ config, resources, minify, cache }) => ({
  css: await Promise.all(
    resources.css.map(async (path) => {
      const isModule = resources.cssModules.includes(path);
      return cached({
        cache: cache.css,
        path,
        read: async () => {
          const source = await readFile(path, "utf8");
          if (isModule) return compileCssModule({ source, path, sourcePath: config.srcPath, minify: minify.css });
          return minify.css ? minifyCss(source) : source;
        },
      });
    }),
  ),
  js: await Promise.all(
    resources.js.map((path) =>
      cached({
        cache: cache.js,
        path,
        read: async () => {
          const source = await readFile(path, "utf8");
          return minify.js ? minifyJs(source) : source;
        },
      }),
    ),
  ),
});

const publicResourcePath = (page, fileName) => `/${[page.publicRoute, fileName].filter(Boolean).join("/")}`;
const sourcePathFromProject = ({ config, path }) => relative(config.srcPath, path).replaceAll("\\", "/");
const findElement = (node, tagName) => {
  if (node.tagName === tagName) return node;
  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);
    if (found) return found;
  }
};
const attribute = (node, name) => node.attrs?.find((item) => item.name === name);
const extractElements = (node, tagName, predicate = () => true) => {
  const elements = [];
  const visit = (current) => {
    for (const child of current.childNodes ?? []) {
      if (child.tagName === tagName && predicate(child)) elements.push(child);
      else visit(child);
    }
    current.childNodes = (current.childNodes ?? []).filter((child) => !elements.includes(child));
  };
  visit(node);
  return elements;
};
const inlineSharedDependencies = async ({ config, dependencies, html, annotate }) => {
  const [styles, scripts] = await Promise.all([
    Promise.all(
      [...new Set(dependencies.styles)].map(async (path) => [
        `/${[config.baseRoute, "styles", relative(config.sharedStylesPath, path).replaceAll("\\", "/")].filter(Boolean).join("/")}`,
        { path: sourcePathFromProject({ config, path }), source: await readFile(path, "utf8") },
      ]),
    ),
    Promise.all(
      [...new Set(dependencies.scripts)].map(async (path) => [
        `/${[config.baseRoute, "js", relative(config.sharedJsPath, path).replaceAll("\\", "/")].filter(Boolean).join("/")}`,
        { path: sourcePathFromProject({ config, path }), source: await readFile(path, "utf8") },
      ]),
    ),
  ]);
  const styleSources = new Map(styles);
  const scriptSources = new Map(scripts);
  const document = parse5.parse(html);
  const rawBlocks = [];
  const rawBlock = (value) => {
    const marker = `__NABI_SHARED_${rawBlocks.length}__`;
    rawBlocks.push({ marker, value });
    return marker;
  };
  const visit = (node) => {
    if (node.tagName === "link") {
      const href = attribute(node, "href");
      const source = styleSources.get(href?.value);
      if (source) {
        node.nodeName = "style";
        node.tagName = "style";
        node.attrs = (node.attrs ?? []).filter((item) => !["href", "rel"].includes(item.name));
        if (annotate) node.attrs.push({ name: "data-href", value: source.path });
        node.childNodes = [{ nodeName: "#text", value: rawBlock(source.source.replace(/<\/style/gi, "<\\/style")) }];
      }
    }
    if (node.tagName === "script") {
      const src = attribute(node, "src");
      const source = scriptSources.get(src?.value);
      if (source) {
        node.attrs = (node.attrs ?? []).filter((item) => item.name !== "src");
        if (annotate) node.attrs.push({ name: "data-src", value: source.path });
        node.childNodes = [{ nodeName: "#text", value: rawBlock(source.source.replace(/<\/script/gi, "<\\/script")) }];
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  return rawBlocks.reduce((output, block) => output.replace(block.marker, block.value), parse5.serialize(document));
};

const bodyOutput = (html) => {
  const document = parse5.parse(html);
  const body = findElement(document, "body");
  const styles = extractElements(document, "style");
  const scripts = extractElements(document, "script");
  const globalStyles = styles.filter((node) => attribute(node, "data-href")?.value.startsWith("shared/styles/"));
  const componentStyles = styles.filter((node) => !globalStyles.includes(node));
  return parse5.serialize({
    nodeName: "#document-fragment",
    childNodes: [...globalStyles, ...componentStyles, ...(body?.childNodes ?? []), ...scripts],
  });
};

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

const writeHybridBuild = async ({ config, pages, mode, temporary, copyAssets }) => {
  if (copyAssets) await copyTree(config.assetsPath, join(temporary, config.baseRoute, "assets"));
  const isInline = mode === "inline" || mode === "body";
  const isBody = mode === "body";
  if (!isInline) await writeSharedDependencies({ config, pages, temporary });
  const manifest = {};
  const resourceCache = { css: new Map(), js: new Map() };
  for (const page of pages) {
    const resources = await readResources({ config, resources: page.resources, minify: config.minify, cache: resourceCache });
    const pageHtml = isInline
      ? await inlineSharedDependencies({ config, dependencies: page.dependencies, html: page.html, annotate: isInline })
      : page.html;
    const html = injectGeneratedResources({
      html: pageHtml,
      css: isInline ? resources.css : resources.css.length ? [publicResourcePath(page, "style.css")] : [],
      js: isInline ? resources.js : resources.js.length ? [publicResourcePath(page, "script.js")] : [],
      cssSources: isInline ? page.resources.css.map((path) => sourcePathFromProject({ config, path })) : [],
      jsSources: isInline ? page.resources.js.map((path) => sourcePathFromProject({ config, path })) : [],
      inline: isInline,
    });
    const outputPath = page.outputPath;
    const output = isBody ? bodyOutput(html) : html;
    await writeText(join(temporary, outputPath), config.minify.html ? await minifyHtml(output) : output);
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

export const writeBuild = async ({ config, pages, mode, copyAssets = true, atomic = true }) => {
  const temporary = temporaryPath(config);
  await remove(temporary);
  await mkdir(temporary, { recursive: true });
  try {
    await writeHybridBuild({ config, pages, mode, temporary, copyAssets });
    if (atomic) await replaceOutput(config, temporary);
    else await syncOutput(config, temporary);
  } catch (error) {
    await remove(temporary);
    throw error;
  }
};
