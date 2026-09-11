import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { minifyCss, minifyHtml, minifyJs } from "@/build/minify";
import type { AssetCache } from "@/build/types";
import { injectGeneratedResources } from "@/compiler/dependencies";
import type { BuildMode, BuiltPage, NabiConfig } from "@/types";
import { copyTree, writeText } from "@/utils/files";

import { bodyOutput, inlineSharedDependencies } from "./html";
import { publicResourcePath, readResources, sourcePathFromProject } from "./resources";

type WriteSharedFilesProps = {
  directory: string;
  paths: string[];
  root: string;
  temporary: string;
  transform: (source: string) => Promise<string> | string;
};

type WriteSharedDependenciesProps = {
  config: NabiConfig;
  pages: BuiltPage[];
  temporary: string;
};

type BuildManifest = Record<string, { css: string[]; js: string[] }>;

type WritePageProps = {
  config: NabiConfig;
  isBody: boolean;
  isInline: boolean;
  manifest: BuildManifest;
  page: BuiltPage;
  resourceCache: AssetCache;
  temporary: string;
};

type WriteHybridBuildProps = {
  config: NabiConfig;
  copyAssets: boolean;
  mode: BuildMode;
  pages: BuiltPage[];
  temporary: string;
};

type WriteDevPageProps = {
  config: NabiConfig;
  page: BuiltPage;
};

const writeSharedFiles = async ({ directory, paths, root, temporary, transform }: WriteSharedFilesProps) => {
  await Promise.all(
    paths.map(async (path) => {
      const output = join(temporary, directory, relative(root, path));
      const source = await readFile(path, "utf8");

      await writeText(output, await transform(source));
    }),
  );
};

const writeSharedDependencies = async ({ config, pages, temporary }: WriteSharedDependenciesProps) => {
  const styles = [...new Set(pages.flatMap((page) => page.dependencies.styles))];
  const scripts = [...new Set(pages.flatMap((page) => page.dependencies.scripts))];

  await Promise.all([
    writeSharedFiles({
      directory: join(config.baseRoute, "styles"),
      paths: styles,
      root: config.stylesPath,
      temporary,
      transform: (source) => (config.minify.css ? minifyCss(source) : source),
    }),
    writeSharedFiles({
      directory: join(config.baseRoute, "js"),
      paths: scripts,
      root: config.jsPath,
      temporary,
      transform: (source) => (config.minify.js ? minifyJs(source) : source),
    }),
  ]);
};

const outputResourcePath = (directory: string, fileName: string) =>
  [directory, fileName].filter((part) => part !== ".").join("/");

const writePage = async ({ config, isBody, isInline, manifest, page, resourceCache, temporary }: WritePageProps) => {
  const resources = await readResources({
    cache: resourceCache,
    config,
    minify: config.minify,
    resources: page.resources,
  });

  const pageHtml = isInline
    ? await inlineSharedDependencies({
        annotate: true,
        config,
        dependencies: page.dependencies,
        html: page.html,
      })
    : page.html;

  const html = injectGeneratedResources({
    css: isInline ? resources.css : resources.css.length ? [publicResourcePath(page, "style.css")] : [],
    cssSources: isInline ? page.resources.css.map((path) => sourcePathFromProject({ config, path })) : [],
    html: pageHtml,
    inline: isInline,
    js: isInline ? resources.js : resources.js.length ? [publicResourcePath(page, "script.js")] : [],
    jsSources: isInline ? page.resources.js.map((path) => sourcePathFromProject({ config, path })) : [],
  });

  const output = isBody ? bodyOutput({ config, html }) : html;

  await writeText(join(temporary, page.outputPath), config.minify.html ? await minifyHtml(output) : output);

  if (isInline) return;

  if (resources.css.length) {
    await writeText(join(temporary, page.outputDir, "style.css"), resources.css.join("\n"));
  }

  if (resources.js.length) {
    await writeText(join(temporary, page.outputDir, "script.js"), resources.js.join("\n"));
  }

  manifest[page.outputPath] = {
    css: resources.css.length ? [outputResourcePath(page.outputDir, "style.css")] : [],
    js: resources.js.length ? [outputResourcePath(page.outputDir, "script.js")] : [],
  };
};

export const writeHybridBuild = async ({ config, copyAssets, mode, pages, temporary }: WriteHybridBuildProps) => {
  if (copyAssets) await copyTree(config.assetsPath, join(temporary, config.baseRoute, "assets"));

  const isInline = mode === "inline" || mode === "body";
  const isBody = mode === "body";

  if (!isInline) await writeSharedDependencies({ config, pages, temporary });

  const manifest: BuildManifest = {};
  const resourceCache: AssetCache = { css: new Map(), js: new Map() };

  for (const page of pages) {
    await writePage({
      config,
      isBody,
      isInline,
      manifest,
      page,
      resourceCache,
      temporary,
    });
  }

  if (mode === "split") {
    await writeText(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
};

export const writeDevPage = async ({ config, page }: WriteDevPageProps) => {
  await writeSharedDependencies({
    config,
    pages: [page],
    temporary: config.outPath,
  });

  await writePage({
    config,
    isBody: false,
    isInline: false,
    manifest: {},
    page,
    resourceCache: { css: new Map(), js: new Map() },
    temporary: config.outPath,
  });
};
