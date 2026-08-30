export type BuildMode = "split" | "inline" | "body";

export type DevConfig = { port: number };
export type AssetsConfig = { baseUrl: string; mode: "copy" };
export type MinifyConfig = { css: boolean; html: boolean; js: boolean };
export type ImagesConfig = { optimize: boolean };

export type NabiConfigInput = {
  assets?: Partial<AssetsConfig>;
  baseRoute?: string;
  defaultBuildMode?: BuildMode;
  dev?: Partial<DevConfig>;
  images?: Partial<ImagesConfig>;
  minify?: Partial<MinifyConfig>;
  outDir?: string;
  pagesDir?: string;
  sharedDir?: string;
  srcDir?: string;
};

export type NabiConfig = Omit<Required<NabiConfigInput>, "dev" | "assets" | "minify" | "images"> & {
  assets: AssetsConfig;
  assetsPath: string;
  cwd: string;
  dev: DevConfig;
  images: ImagesConfig;
  jsPath: string;
  minify: MinifyConfig;
  outPath: string;
  pagesPath: string;
  sharedPath: string;
  srcPath: string;
  stylesPath: string;
};

export type ComponentScope = "global" | "local";
export type Component = {
  cssModuleClasses?: Map<string, string>;
  cssModulePaths?: string[];
  isHeadTemplate: boolean;
  path: string;
  props: Set<string>;
  propValues: Record<string, string[]>;
  ref: string;
  root: string;
  scope: ComponentScope;
  scriptPath: string;
  stylePath: string;
  template: string;
};

export type PageResources = { css: string[]; cssModules: string[]; js: string[] };
export type SharedDependencyType = "script" | "stylesheet";
export type SharedDependencies = { scripts: string[]; styles: string[] };

export type PageEntry = {
  localComponentPaths: string[];
  outputDir: string;
  outputPath: string;
  path: string;
  publicRoute: string;
  route: string;
  scriptPath: string;
  stylePath: string;
};

export type BuiltPage = PageEntry & {
  dependencies: SharedDependencies;
  html: string;
  resources: PageResources;
  sourcePath: string;
};
