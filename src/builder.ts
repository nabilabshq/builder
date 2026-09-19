import { writeBuild } from "@/build/output";
import type { BuildOutputStage } from "@/build/types";
import { cssModuleClassNames, cssModulePathsFor } from "@/compiler/css-modules";
import { resolveSharedDependencies, rewriteAssetReferences, rewriteInternalLinks } from "@/compiler/dependencies";
import { compilePage } from "@/compiler/page";
import { ComponentRegistry, createGlobalComponentRegistry, createHybridComponentRegistry } from "@/compiler/registry";
import { collectHybridResources } from "@/compiler/resources";
import { loadConfig } from "@/config";
import { discoverErrorPages, discoverPages as discoverPageRoutes, interpolateRouteData } from "@/routing";
import { routeHookDependencies } from "@/routing/dynamic/hooks";
import type {
  BuildMode,
  BuiltPage,
  Component,
  NabiConfig,
  NabiConfigInput,
  PageEntry,
  PageResources,
  SharedDependencies,
} from "@/types";
import { NabiError } from "@/utils/errors";
import { readText, remove } from "@/utils/files";
import { isBuildMode } from "@/utils/paths";

type CssModuleData = {
  classes: Map<string, string>;
  paths: string[];
};
type CssModuleCache = Map<string, Promise<CssModuleData>>;
type ComponentRegistryCache = Map<string, Promise<ComponentRegistry>>;
type PageTemplateCache = Map<string, Promise<PageTemplate>>;
type RouteHookDependenciesCache = Map<string, Promise<string[]>>;
type PageTemplate = {
  components: Component[];
  dependencies?: SharedDependencies;
  hasDeferredRouteConditions: boolean;
  hasRouteDependentLinks: boolean;
  html: string;
  resources?: PageResources;
};
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
type RegistryForOptions = {
  cache: ComponentRegistryCache;
  config: NabiConfig;
  entry: PageEntry;
  globalComponents: Map<string, Component>;
  ignoredComponentPaths: string[];
};
type DependenciesForRouteHookOptions = {
  cache: RouteHookDependenciesCache;
  config: NabiConfig;
  entry: PageEntry;
};
type PageTemplateForOptions = {
  cache: PageTemplateCache;
  config: NabiConfig;
  cssModuleCache: CssModuleCache;
  entry: PageEntry;
  registry: ComponentRegistry;
};

type BuildPageOptions = {
  config: NabiConfig;
  cssModuleCache: CssModuleCache;
  entry: PageEntry;
  registry: ComponentRegistry;
  routeHookDependenciesCache?: RouteHookDependenciesCache;
  template?: PageTemplate;
};
type BuildOptions = {
  atomic?: boolean;
  config?: NabiConfigInput;
  copyAssets?: boolean;
  cwd?: string;
  mode?: BuildMode;
  onBuildStarted?: (progress: BuildProgress) => void;
  onOutputStage?: (stage: BuildOutputStage) => void;
  onOutputWriting?: () => void;
  onPageBuilt?: (progress: BuildProgress) => void;
  write?: boolean;
};

export type BuildProgress = {
  completed: number;
  total: number;
};

type CleanOptions = {
  config?: NabiConfigInput;
  cwd?: string;
};

type BuildDevPageProps = {
  config: NabiConfig;
  entry: PageEntry;
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

const componentRegistryKey = (entry: PageEntry) => entry.localComponentPaths.join("\0");

const registryFor = (props: RegistryForOptions) => {
  const { cache, config, entry, globalComponents, ignoredComponentPaths } = props;
  const key = componentRegistryKey(entry);
  const existing = cache.get(key);

  if (existing) return existing;

  const registry = createHybridComponentRegistry({
    globalComponents,
    ignoredPaths: ignoredComponentPaths,
    localComponentPaths: entry.localComponentPaths,
    pagesDir: config.pagesDir,
    reservedSourceDirectories: [config.pagesDir, config.sharedDir],
    sourcePath: config.srcPath,
  });

  cache.set(key, registry);

  return registry;
};

const dependenciesForRouteHook = (props: DependenciesForRouteHookOptions) => {
  const { cache, config, entry } = props;
  const existing = cache.get(entry.path);

  if (existing) return existing;

  const dependencies = routeHookDependencies({
    pagePath: entry.path,
    pagesPath: config.pagesPath,
    routeFileName: config.routeFileName,
    sourcePath: config.srcPath,
  });

  cache.set(entry.path, dependencies);

  return dependencies;
};

const pageTemplateFor = (props: PageTemplateForOptions) => {
  const { cache, config, cssModuleCache, entry, registry } = props;
  const existing = cache.get(entry.path);

  if (existing) return existing;

  const template = (async (): Promise<PageTemplate> => {
    const pageModules = await cssModulesFor({
      cache: cssModuleCache,
      path: entry.path,
      sourcePath: config.srcPath,
    });

    const components: Component[] = [];
    let hasDeferredRouteConditions = false;

    const compiled = await compilePage({
      cssModuleClasses: pageModules.classes,
      deferRouteConditions: true,
      onComponentResolved: (component) => components.push(component),
      onDeferredRouteCondition: () => {
        hasDeferredRouteConditions = true;
      },
      page: entry.path,
      registry,
      source: await readText(entry.path),
    });

    const resources = hasDeferredRouteConditions
      ? undefined
      : await collectHybridResources({
          components,
          pageModulePaths: pageModules.paths,
          pagePath: entry.path,
          scriptPath: entry.scriptPath,
          stylePath: entry.stylePath,
        });
    const canReuseTransforms = !hasDeferredRouteConditions;
    const hasDynamicAssetReference = /@assets\/[^"'\s>]*{{:/.test(compiled);
    const hasDynamicSharedDependency = /\buse="[^">]*{{:/.test(compiled);
    const hasRouteDependentLinks = /\bhref="(?:\.\/|\.\.\/)/.test(compiled);
    const assetHtml =
      !canReuseTransforms || hasDynamicAssetReference ? compiled : rewriteAssetReferences({ config, html: compiled });
    const shared =
      !canReuseTransforms || hasDynamicSharedDependency
        ? undefined
        : await resolveSharedDependencies({ config, html: assetHtml, page: entry.path });

    return {
      components,
      dependencies: shared?.dependencies,
      hasDeferredRouteConditions,
      hasRouteDependentLinks,
      html: shared?.html ?? assetHtml,
      resources,
    };
  })();

  cache.set(entry.path, template);

  return template;
};

const buildPage = async (props: BuildPageOptions): Promise<BuiltPage> => {
  const { config, cssModuleCache, entry, registry, routeHookDependenciesCache, template } = props;

  const source = interpolateRouteData({
    routeContext: entry.routeContext,
    routeData: entry.routeData,
    source: template?.html ?? (await readText(entry.path)),
  });

  const pageModules = await cssModulesFor({
    cache: cssModuleCache,
    path: entry.path,
    sourcePath: config.srcPath,
  });

  const resolvedComponents = [...(template?.components ?? [])];
  const compiled =
    template && !template.hasDeferredRouteConditions
      ? source
      : await compilePage({
          cssModuleClasses: pageModules.classes,
          onComponentResolved: (component) => resolvedComponents.push(component),
          page: entry.path,
          registry,
          source,
        });

  const assetHtml = template?.dependencies ? compiled : rewriteAssetReferences({ config, html: compiled });
  const linkedHtml =
    template && !template.hasRouteDependentLinks
      ? assetHtml
      : rewriteInternalLinks({
          config,
          html: assetHtml,
          pageRoute: entry.publicRoute,
        });

  const shared = template?.dependencies
    ? { dependencies: template.dependencies, html: linkedHtml }
    : await resolveSharedDependencies({
        config,
        html: linkedHtml,
        page: entry.path,
      });
  const { dependencies, html } = shared;

  const resources =
    template?.resources ??
    (await collectHybridResources({
      components: resolvedComponents,
      pageModulePaths: pageModules.paths,
      pagePath: entry.path,
      scriptPath: entry.scriptPath,
      stylePath: entry.stylePath,
    }));

  const sourceDependencies = [
    entry.path,
    entry.scriptPath,
    entry.stylePath,
    ...resolvedComponents.flatMap((component) => [
      component.path,
      component.scriptPath,
      component.stylePath,
      ...(component.cssModulePaths ?? []),
    ]),
    ...pageModules.paths,
    ...resources.css,
    ...resources.cssModules,
    ...resources.js,
    ...dependencies.scripts,
    ...dependencies.styles,
    ...(routeHookDependenciesCache
      ? await dependenciesForRouteHook({ cache: routeHookDependenciesCache, config, entry })
      : await routeHookDependencies({
          pagePath: entry.path,
          pagesPath: config.pagesPath,
          routeFileName: config.routeFileName,
          sourcePath: config.srcPath,
        })),
  ];

  return {
    ...entry,
    dependencies,
    html,
    resources,
    sourceDependencies: [...new Set(sourceDependencies)],
    sourcePath: entry.path,
  };
};

export const buildDevPage = async ({ config, entry }: BuildDevPageProps): Promise<BuiltPage> => {
  const cssModuleCache: CssModuleCache = new Map();
  const ignoredComponentPaths = [config.pagesPath, config.sharedPath];

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

  return buildPage({
    config,
    cssModuleCache,
    entry,
    registry,
  });
};

export const discoverPages = async (config: NabiConfig) =>
  discoverPageRoutes({
    baseRoute: config.baseRoute,
    cwd: config.cwd,
    dataPath: config.dataPath,
    errorPageFileName: config.errorPageFileName,
    ignoredPaths: [config.sharedPath],
    rootPath: config.pagesPath,
    routeFileName: config.routeFileName,
  });

const discoverErrors = async (config: NabiConfig) =>
  discoverErrorPages({
    baseRoute: config.baseRoute,
    cwd: config.cwd,
    dataPath: config.dataPath,
    errorPageFileName: config.errorPageFileName,
    ignoredPaths: [config.sharedPath],
    rootPath: config.pagesPath,
    routeFileName: config.routeFileName,
  });

export const build = async (props: BuildOptions = {}) => {
  const {
    atomic = true,
    config: configOverrides,
    copyAssets = true,
    cwd,
    mode,
    onBuildStarted,
    onOutputStage,
    onOutputWriting,
    onPageBuilt,
    write = true,
  } = props;

  const config = await loadConfig({ config: configOverrides, cwd });
  const buildMode = mode ?? config.defaultBuildMode;

  if (!isBuildMode(buildMode)) {
    throw new NabiError(`Unknown build mode: ${buildMode}. Use split, inline, or body.`);
  }

  const entries = await discoverPages(config);
  const errorEntries = await discoverErrors(config);

  if (entries.length === 0) {
    throw new NabiError(`No HTML pages found in ${config.pagesDir}`);
  }

  const pages: BuiltPage[] = [];
  const errorPages: BuiltPage[] = [];
  const totalPages = entries.length + errorEntries.length;
  const cssModuleCache: CssModuleCache = new Map();
  const componentRegistryCache: ComponentRegistryCache = new Map();
  const pageTemplateCache: PageTemplateCache = new Map();
  const ignoredComponentPaths: string[] = [config.pagesPath, config.sharedPath];
  const routeHookDependenciesCache: RouteHookDependenciesCache = new Map();

  onBuildStarted?.({ completed: 0, total: totalPages });

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

  for (const [entry, isErrorPage] of [
    ...entries.map((entry) => [entry, false] as const),
    ...errorEntries.map((entry) => [entry, true] as const),
  ]) {
    const registry = await registryFor({
      cache: componentRegistryCache,
      config,
      entry,
      globalComponents,
      ignoredComponentPaths,
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
      routeHookDependenciesCache,
      ...(entry.routeData
        ? {
            template: await pageTemplateFor({
              cache: pageTemplateCache,
              config,
              cssModuleCache,
              entry,
              registry,
            }),
          }
        : {}),
    });

    (isErrorPage ? errorPages : pages).push(page);
    onPageBuilt?.({ completed: pages.length + errorPages.length, total: totalPages });
  }

  if (write) {
    onOutputWriting?.();
    await writeBuild({
      atomic,
      config,
      copyAssets,
      mode: buildMode,
      onStage: onOutputStage,
      pages: [...pages, ...errorPages],
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
