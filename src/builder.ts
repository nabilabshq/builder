import { writeBuild } from "@/build/output";
import { cssModuleClassNames, cssModulePathsFor } from "@/compiler/css-modules";
import { resolveSharedDependencies, rewriteAssetReferences, rewriteInternalLinks } from "@/compiler/dependencies";
import { compilePage } from "@/compiler/page";
import { ComponentRegistry, createGlobalComponentRegistry, createHybridComponentRegistry } from "@/compiler/registry";
import { collectHybridResources } from "@/compiler/resources";
import { loadConfig } from "@/config";
import { discoverPages as discoverPageRoutes, interpolateRouteData } from "@/routing";
import type { BuildMode, BuiltPage, Component, NabiConfig, NabiConfigInput, PageEntry } from "@/types";
import { NabiError } from "@/utils/errors";
import { readText, remove } from "@/utils/files";
import { isBuildMode } from "@/utils/paths";

type CssModuleData = {
  classes: Map<string, string>;
  paths: string[];
};
type CssModuleCache = Map<string, Promise<CssModuleData>>;
type CssModulesForOptions = {
  cache: CssModuleCache;
  path: string;
  sourcePath: string;
};
type LoadCssModulesOptions = {
  cache: CssModuleCache;
  components: Map<string, Component>;
  sourcePath: string;
};

type BuildPageOptions = {
  config: NabiConfig;
  cssModuleCache: CssModuleCache;
  entry: PageEntry;
  registry: ComponentRegistry;
};
type BuildOptions = {
  atomic?: boolean;
  config?: NabiConfigInput;
  copyAssets?: boolean;
  cwd?: string;
  mode?: BuildMode;
  write?: boolean;
};

type CleanOptions = {
  config?: NabiConfigInput;
  cwd?: string;
};

const createCssModuleData = async (path: string, sourcePath: string): Promise<CssModuleData> => {
  const paths = await cssModulePathsFor(path);

  return {
    classes: await cssModuleClassNames({ paths, sourcePath }),
    paths,
  };
};

const cssModulesFor = ({ cache, path, sourcePath }: CssModulesForOptions) => {
  const existing = cache.get(path);

  if (existing) return existing;

  const promiseModuleData = createCssModuleData(path, sourcePath);
  cache.set(path, promiseModuleData);

  return promiseModuleData;
};

const loadComponentCssModules = async ({ cache, components, sourcePath }: LoadCssModulesOptions) => {
  await Promise.all(
    [...components.values()]
      .filter((component) => !component.cssModuleClasses)
      .map(async (component) => {
        const modules = await cssModulesFor({ cache, path: component.path, sourcePath });

        component.cssModuleClasses = modules.classes;
        component.cssModulePaths = modules.paths;
      }),
  );
};

const buildPage = async ({ config, cssModuleCache, entry, registry }: BuildPageOptions): Promise<BuiltPage> => {
  const source = interpolateRouteData({
    routeContext: entry.routeContext,
    routeData: entry.routeData,
    source: await readText(entry.path),
  });

  const pageModules = await cssModulesFor({
    cache: cssModuleCache,
    path: entry.path,
    sourcePath: config.srcPath,
  });

  const resolvedComponents: Component[] = [];

  const compiled = await compilePage({
    cssModuleClasses: pageModules.classes,
    onComponentResolved: (component) => resolvedComponents.push(component),
    page: entry.path,
    registry,
    source,
  });

  const assetHtml = rewriteAssetReferences({ config, html: compiled });
  const linkedHtml = rewriteInternalLinks({
    config,
    html: assetHtml,
    pageRoute: entry.publicRoute,
  });

  const { dependencies, html } = await resolveSharedDependencies({
    config,
    html: linkedHtml,
    page: entry.path,
  });

  const resources = await collectHybridResources({
    components: resolvedComponents,
    pageModulePaths: pageModules.paths,
    pagePath: entry.path,
    scriptPath: entry.scriptPath,
    stylePath: entry.stylePath,
  });

  return {
    ...entry,
    dependencies,
    html,
    resources,
    sourcePath: entry.path,
  };
};

export const discoverPages = async (config: NabiConfig) =>
  discoverPageRoutes({
    baseRoute: config.baseRoute,
    cwd: config.cwd,
    dataPath: config.dataPath,
    ignoredPaths: [config.sharedPath],
    rootPath: config.pagesPath,
    routeFileName: config.routeFileName,
  });

export const build = async (props: BuildOptions = {}) => {
  const { atomic = true, config: configOverrides, copyAssets = true, cwd, mode, write = true } = props;

  const config = await loadConfig({ config: configOverrides, cwd });
  const buildMode = mode ?? config.defaultBuildMode;

  if (!isBuildMode(buildMode)) {
    throw new NabiError(`Unknown build mode: ${buildMode}. Use split, inline, or body.`);
  }

  const entries = await discoverPages(config);

  if (entries.length === 0) {
    throw new NabiError(`No HTML pages found in ${config.pagesDir}`);
  }

  const pages: BuiltPage[] = [];
  const cssModuleCache: CssModuleCache = new Map();
  const ignoredComponentPaths: string[] = [config.pagesPath, config.sharedPath];

  const globalComponents = await createGlobalComponentRegistry({
    ignoredPaths: ignoredComponentPaths,
    reservedSourceDirectories: [config.pagesDir, config.sharedDir],
    sourcePath: config.srcPath,
  });

  await loadComponentCssModules({
    cache: cssModuleCache,
    components: globalComponents,
    sourcePath: config.srcPath,
  });

  const componentTags = new Set(globalComponents.keys());

  for (const entry of entries) {
    const registry = await createHybridComponentRegistry({
      globalComponents,
      ignoredPaths: ignoredComponentPaths,
      localComponentPaths: entry.localComponentPaths,
      pagesDir: config.pagesDir,
      reservedSourceDirectories: [config.pagesDir, config.sharedDir],
      sourcePath: config.srcPath,
    });

    await loadComponentCssModules({
      cache: cssModuleCache,
      components: registry.components,
      sourcePath: config.srcPath,
    });

    for (const tag of registry.components.keys()) {
      componentTags.add(tag);
    }

    const page = await buildPage({
      config,
      cssModuleCache,
      entry,
      registry,
    });

    pages.push(page);
  }

  if (write) {
    await writeBuild({
      atomic,
      config,
      copyAssets,
      mode: buildMode,
      pages,
    });
  }

  return {
    componentCount: componentTags.size,
    config,
    mode: buildMode,
    pages,
  };
};

export const clean = async ({ config: configOverrides, cwd }: CleanOptions = {}) => {
  const config = await loadConfig({ config: configOverrides, cwd });

  await Promise.all([
    remove(config.outPath),
    remove(`${config.cwd}/.nabi-cache`),
    remove(`${config.cwd}/.nabi-build-temp`),
    remove(`${config.cwd}/.nabi-build-backup`),
  ]);
};
