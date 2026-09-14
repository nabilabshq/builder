import { join } from "node:path";

import { minifyHtml } from "@/build/minify";
import type { AssetCache } from "@/build/types";
import { injectGeneratedResources } from "@/compiler/dependencies";
import type { BuiltPage, NabiConfig } from "@/types";
import { fileExists, writeText } from "@/utils/files";

import { bodyOutput } from "./html/body";
import type { SharedSourceCache } from "./html/inline";
import { inlineSharedDependencies } from "./html/inline";
import { type ManifestEntry, outputResourcePath } from "./manifest";
import { publicResourcePath, readResources, sourcePathFromProject } from "./resources";

type WritePageProps = {
  bodyDirectoryRoutes: Set<string>;
  config: NabiConfig;
  isBody: boolean;
  isInline: boolean;
  page: BuiltPage;
  resourceCache: AssetCache;
  sharedSourceCache: SharedSourceCache;
  temporary: string;
};

type WritePagesProps = Omit<WritePageProps, "page">;

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

const writePage = async (props: WritePageProps): Promise<ManifestEntry | undefined> => {
  const { bodyDirectoryRoutes, config, isBody, isInline, page, resourceCache, sharedSourceCache, temporary } = props;

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
        cache: sharedSourceCache,
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
    ? bodyPageOutputPath({
        directoryRoutes: bodyDirectoryRoutes,
        page,
        scripts: resources.js,
      })
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

  return [
    page.outputPath,
    {
      css: resources.css.length ? [outputResourcePath(page.outputDir, "style.css")] : [],
      js: resources.js.length ? [outputResourcePath(page.outputDir, "script.js")] : [],
    },
  ];
};

const writeConcurrency = 32;

export const writePages = async (props: WritePagesProps, pages: BuiltPage[]) => {
  const entries: (ManifestEntry | undefined)[] = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < pages.length) {
      const index = nextIndex;
      nextIndex += 1;
      entries[index] = await writePage({ ...props, page: pages[index] });
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(writeConcurrency, pages.length),
      },
      worker,
    ),
  );

  return entries;
};

export const bodyDirectoryRoutes = (props: BodyDirectoryRoutesForProps) => bodyDirectoryRoutesFor(props);

export const writeDevPageOutput = async ({ config, page }: { config: NabiConfig; page: BuiltPage }) => {
  await writePage({
    bodyDirectoryRoutes: new Set(),
    config,
    isBody: false,
    isInline: false,
    page,
    resourceCache: { css: new Map(), js: new Map() },
    sharedSourceCache: new Map(),
    temporary: config.outPath,
  });
};
