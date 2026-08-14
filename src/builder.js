import { writeBuild } from "./build/output.js";
import { resolveSharedDependencies, rewriteAssetReferences, rewriteInternalLinks } from "./compiler/dependencies.js";
import { compilePage } from "./compiler/page.js";
import { createHybridComponentRegistry } from "./compiler/registry.js";
import { collectHybridResources } from "./compiler/resources.js";
import { loadConfig } from "./config.js";
import { discoverPages as discoverPageRoutes } from "./routing/pages.js";
import { NabiError } from "./utils/errors.js";
import { readText } from "./utils/files.js";

export const discoverPages = async (config) =>
  discoverPageRoutes({
    rootPath: config.pagesPath,
    cwd: config.cwd,
    baseRoute: config.baseRoute,
    ignoredPaths: [config.sharedPath],
  });

export const build = async ({ cwd, config: configOverrides, mode, write = true } = {}) => {
  const config = await loadConfig({ cwd, config: configOverrides });
  const buildMode = mode ?? config.defaultBuildMode;
  if (!["split", "inline"].includes(buildMode))
    throw new NabiError(`Unknown build mode: ${buildMode}. Use split or inline.`);
  const entries = await discoverPages(config);
  if (!entries.length) throw new NabiError(`No HTML pages found in ${config.pagesDir}`);
  const pages = [];
  const componentTags = new Set();
  for (const entry of entries) {
    const source = await readText(entry.path);
    const registry = await createHybridComponentRegistry({
      localComponentsPath: entry.localComponentsPath,
      sharedComponentsPath: config.sharedComponentsPath,
    });
    for (const tag of registry.components.keys()) componentTags.add(tag);
    const resolvedComponents = [];
    const compiled = await compilePage({
      source,
      registry,
      page: entry.path,
      onComponentResolved: (component) => resolvedComponents.push(component),
    });
    const assetHtml = rewriteAssetReferences({ html: compiled, config, page: entry.outputPath });
    const linkedHtml = rewriteInternalLinks({ html: assetHtml, config, pageRoute: entry.publicRoute });
    const { html, dependencies } = await resolveSharedDependencies({ html: linkedHtml, config, page: entry.path });
    const resources = await collectHybridResources({
      config,
      pagePath: entry.path,
      stylePath: entry.stylePath,
      scriptPath: entry.scriptPath,
      components: resolvedComponents,
    });
    pages.push({ html, ...entry, sourcePath: entry.path, outputPath: entry.outputPath, resources, dependencies });
  }
  if (write) await writeBuild({ config, pages, mode: buildMode });
  return { config, mode: buildMode, pages, routes: pages, componentCount: componentTags.size };
};

export const clean = async ({ cwd, config: configOverrides } = {}) => {
  const config = await loadConfig({ cwd, config: configOverrides });
  const { remove } = await import("./utils/files.js");
  await Promise.all([
    remove(config.outPath),
    remove(`${config.cwd}/.nabi-cache`),
    remove(`${config.cwd}/.nabi-build-temp`),
    remove(`${config.cwd}/.nabi-build-backup`),
  ]);
};
