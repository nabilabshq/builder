import { writeBuild } from "./build/output.js";
import { cssModuleClassNames, cssModulePathsFor } from "./compiler/css-modules.js";
import { resolveSharedDependencies, rewriteAssetReferences, rewriteInternalLinks } from "./compiler/dependencies.js";
import { compilePage } from "./compiler/page.js";
import { createGlobalComponentRegistry, createHybridComponentRegistry } from "./compiler/registry.js";
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

const cssModulesFor = ({ path, sourcePath, cache }) => {
  const existing = cache.get(path);
  if (existing) return existing;
  const moduleData = (async () => {
    const paths = await cssModulePathsFor(path);
    return { paths, classes: await cssModuleClassNames({ paths, sourcePath }) };
  })();
  cache.set(path, moduleData);
  return moduleData;
};

const loadComponentCssModules = async ({ components, sourcePath, cache }) => {
  await Promise.all(
    [...components.values()].filter((component) => !component.cssModuleClasses).map(async (component) => {
      const modules = await cssModulesFor({ path: component.path, sourcePath, cache });
      component.cssModuleClasses = modules.classes;
      component.cssModulePaths = modules.paths;
    }),
  );
};

export const build = async ({ cwd, config: configOverrides, mode, write = true, copyAssets = true, atomic = true } = {}) => {
  const config = await loadConfig({ cwd, config: configOverrides });
  const buildMode = mode ?? config.defaultBuildMode;
  if (!["split", "inline", "body"].includes(buildMode))
    throw new NabiError(`Unknown build mode: ${buildMode}. Use split, inline, or body.`);
  const entries = await discoverPages(config);
  if (!entries.length) throw new NabiError(`No HTML pages found in ${config.pagesDir}`);
  const pages = [];
  const cssModuleCache = new Map();
  const ignoredComponentPaths = [config.pagesPath, config.sharedPath];
  const globalComponents = await createGlobalComponentRegistry({
    sourcePath: config.srcPath,
    ignoredPaths: ignoredComponentPaths,
  });
  await loadComponentCssModules({ components: globalComponents, sourcePath: config.srcPath, cache: cssModuleCache });
  const componentTags = new Set(globalComponents.keys());
  for (const entry of entries) {
    const source = await readText(entry.path);
    const registry = await createHybridComponentRegistry({
      localComponentPaths: entry.localComponentPaths,
      sourcePath: config.srcPath,
      globalComponents,
      ignoredPaths: ignoredComponentPaths,
    });
    await loadComponentCssModules({ components: registry.components, sourcePath: config.srcPath, cache: cssModuleCache });
    for (const tag of registry.components.keys()) componentTags.add(tag);
    const pageModules = await cssModulesFor({ path: entry.path, sourcePath: config.srcPath, cache: cssModuleCache });
    const resolvedComponents = [];
    const compiled = await compilePage({
      source,
      registry,
      page: entry.path,
      cssModuleClasses: pageModules.classes,
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
      pageModulePaths: pageModules.paths,
    });
    pages.push({ html, ...entry, sourcePath: entry.path, outputPath: entry.outputPath, resources, dependencies });
  }
  if (write) await writeBuild({ config, pages, mode: buildMode, copyAssets, atomic });
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
