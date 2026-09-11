import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { minifyCss, minifyHtml, minifyJs } from "@/build/minify";
import type { AssetCache } from "@/build/types";
import { injectGeneratedResources } from "@/compiler/dependencies";
import type { BuildMode, BuiltPage, NabiConfig, SharedDependencyType } from "@/types";
import { copyTree, fileExists, writeText } from "@/utils/files";

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
  types?: SharedDependencyType[];
};

type BuildManifest = Record<string, { css: string[]; js: string[] }>;

type WritePageProps = {
  bodyDirectoryRoutes: Set<string>;
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

type BodyDirectoryRoutesForProps = {
  config: NabiConfig;
  pages: BuiltPage[];
  temporary: string;
};

type BodyPageOutputPathProps = {
  directoryRoutes: Set<string>;
  page: BuiltPage;
  scripts: string[];
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

const writeSharedDependencies = async ({ config, pages, temporary, types }: WriteSharedDependenciesProps) => {
  const sharedTypes = types ?? ["script", "stylesheet"];
  const styles = sharedTypes.includes("stylesheet")
    ? [...new Set(pages.flatMap((page) => page.dependencies.styles))]
    : [];
  const scripts = sharedTypes.includes("script")
    ? [...new Set(pages.flatMap((page) => page.dependencies.scripts))]
    : [];

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

const bodyDirectoryRoutesFor = async (props: BodyDirectoryRoutesForProps) => {
  const { config, pages, temporary } = props;
  const routes = new Set<string>();
  const baseRoutePath = join(temporary, config.baseRoute);

  for (const page of pages) {
    const segments = page.publicRoute.split("/").filter(Boolean);

    for (let index = 1; index < segments.length; index += 1) {
      routes.add(segments.slice(0, index).join("/"));
    }
  }

  if (config.baseRoute && (await fileExists(baseRoutePath))) {
    routes.add(config.baseRoute);
  }

  return routes;
};

const bodyPageOutputPath = (props: BodyPageOutputPathProps) => {
  const { directoryRoutes, page, scripts } = props;

  if (scripts.length || !page.publicRoute || directoryRoutes.has(page.publicRoute)) {
    return page.outputPath;
  }

  return `${page.publicRoute}.html`;
};

const writePage = async (props: WritePageProps) => {
  const { bodyDirectoryRoutes, config, isBody, isInline, manifest, page, resourceCache, temporary } = props;
  const inlineStyles = isBody || isInline;
  const resources = await readResources({
    cache: resourceCache,
    config,
    minify: config.minify,
    resources: page.resources,
  });

  const pageHtml = inlineStyles
    ? await inlineSharedDependencies({
        annotate: true,
        config,
        dependencies: page.dependencies,
        html: page.html,
        types: isBody ? ["stylesheet"] : undefined,
      })
    : page.html;

  const html = injectGeneratedResources({
    css: inlineStyles ? resources.css : resources.css.length ? [publicResourcePath(page, "style.css")] : [],
    cssSources: inlineStyles ? page.resources.css.map((path) => sourcePathFromProject({ config, path })) : [],
    html: pageHtml,
    inline: inlineStyles,
    js: isInline ? resources.js : resources.js.length && !isBody ? [publicResourcePath(page, "script.js")] : [],
    jsSources: isInline ? page.resources.js.map((path) => sourcePathFromProject({ config, path })) : [],
  });

  const output = isBody ? bodyOutput({ config, html }) : html;
  const outputPath = isBody
    ? bodyPageOutputPath({ directoryRoutes: bodyDirectoryRoutes, page, scripts: resources.js })
    : page.outputPath;

  await writeText(join(temporary, outputPath), config.minify.html ? await minifyHtml(output) : output);

  if (inlineStyles) {
    if (isBody && resources.js.length) {
      await writeText(join(temporary, page.outputDir, "script.js"), resources.js.join("\n"));
    }

    return;
  }

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

  const isInline = mode === "inline";
  const isBody = mode === "body";

  if (mode === "split") {
    await writeSharedDependencies({ config, pages, temporary });
  }

  if (isBody) {
    await writeSharedDependencies({ config, pages, temporary, types: ["script"] });
  }

  const manifest: BuildManifest = {};
  const bodyDirectoryRoutes = isBody ? await bodyDirectoryRoutesFor({ config, pages, temporary }) : new Set<string>();
  const resourceCache: AssetCache = { css: new Map(), js: new Map() };

  for (const page of pages) {
    await writePage({
      bodyDirectoryRoutes,
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
    types: ["script", "stylesheet"],
  });

  await writePage({
    bodyDirectoryRoutes: new Set(),
    config,
    isBody: false,
    isInline: false,
    manifest: {},
    page,
    resourceCache: { css: new Map(), js: new Map() },
    temporary: config.outPath,
  });
};
