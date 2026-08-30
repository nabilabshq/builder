import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { NabiConfig, NabiConfigInput } from "@/types";
import { NabiError } from "@/utils/errors";
import { fileExists } from "@/utils/files";
import { inside, isBuildMode, isDotSegment } from "@/utils/paths";

type LoadConfigOptions = {
  config?: NabiConfigInput;
  cwd?: string;
};

type NormaliseProjectDirOptions = {
  example: string;
  name: string;
  value: unknown;
};

const defaults: Required<NabiConfigInput> = {
  assets: { baseUrl: "", mode: "copy" },
  baseRoute: "",
  defaultBuildMode: "split",
  dev: { port: 2111 },
  images: { optimize: false },
  minify: { css: true, html: false, js: false },
  outDir: "dist",
  pagesDir: "pages",
  sharedDir: "shared",
  srcDir: "src",
};

const isSafeRelativePath = (value: unknown): value is string =>
  typeof value === "string" &&
  Boolean(value) &&
  value === value.trim() &&
  !isAbsolute(value) &&
  !value.split(/[\\/]/).some((segment) => !segment || isDotSegment(segment));

const normaliseBaseRoute = (value: unknown) => {
  if (typeof value !== "string") {
    throw new NabiError("baseRoute must be a string.");
  }

  const route = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");

  if (!route) return "";

  const segments = route.split("/");

  if (segments.some((segment) => !segment || isDotSegment(segment))) {
    throw new NabiError(`Invalid baseRoute: ${value}`);
  }

  return segments.join("/");
};

const normalisePagesDir = (value: unknown) => {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\\/]/.test(value) || isDotSegment(value)) {
    throw new NabiError('pagesDir must be a single directory name inside srcPath, for example "pages".');
  }

  return value;
};

const normaliseSharedDir = (value: unknown) => {
  if (!isSafeRelativePath(value)) {
    throw new NabiError('sharedDir is relative to srcPath, for example "shared".');
  }

  return value;
};

const normaliseProjectDir = ({ example, name, value }: NormaliseProjectDirOptions) => {
  if (!isSafeRelativePath(value)) {
    throw new NabiError(`${name} must be a relative directory, for example "${example}".`);
  }

  return value;
};

export const loadConfig = async (props: LoadConfigOptions = {}): Promise<NabiConfig> => {
  const { config: overrides = {}, cwd = process.cwd() } = props;

  const configPath = resolve(cwd, "nabi.config.js");
  let userConfig: NabiConfigInput = {};

  if (await fileExists(configPath)) {
    const module: unknown = await import(`${pathToFileURL(configPath).href}?v=${Date.now()}`);
    const candidate = (module as { default?: unknown }).default;

    if (candidate !== undefined && (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))) {
      throw new NabiError("nabi.config.js must export an object.");
    }

    userConfig = (candidate ?? {}) as NabiConfigInput;
  }

  const raw = {
    ...defaults,
    ...userConfig,
    ...overrides,
    assets: { ...defaults.assets, ...userConfig.assets, ...overrides.assets },
    dev: { ...defaults.dev, ...userConfig.dev, ...overrides.dev },
    images: { ...defaults.images, ...userConfig.images, ...overrides.images },
    minify: { ...defaults.minify, ...userConfig.minify, ...overrides.minify },
  };

  const { css, html, js } = raw.minify;
  const port = raw.dev.port;
  const { baseUrl, mode } = raw.assets;
  const { optimize } = raw.images;

  if (!isBuildMode(raw.defaultBuildMode)) {
    throw new NabiError(`Invalid defaultBuildMode: ${raw.defaultBuildMode}`);
  }

  if (typeof html !== "boolean" || typeof css !== "boolean" || typeof js !== "boolean") {
    throw new NabiError("minify.html, minify.css, and minify.js must be booleans.");
  }

  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new NabiError("dev.port must be an integer between 1 and 65535.");
  }

  if (mode !== "copy" || typeof baseUrl !== "string") {
    throw new NabiError("assets.mode must be copy and assets.baseUrl must be a string.");
  }

  if (typeof optimize !== "boolean") {
    throw new NabiError("images.optimize must be a boolean.");
  }

  const baseRoute = normaliseBaseRoute(raw.baseRoute);
  const pagesDir = normalisePagesDir(raw.pagesDir);
  const sharedDir = normaliseSharedDir(raw.sharedDir);
  const srcDir = normaliseProjectDir({ example: "src", name: "srcDir", value: raw.srcDir });
  const outDir = normaliseProjectDir({ example: "dist", name: "outDir", value: raw.outDir });
  const cwdPath = resolve(cwd);
  const srcPath = resolve(cwdPath, srcDir);
  const outPath = resolve(cwdPath, outDir);

  if (inside(srcPath, outPath) || inside(outPath, srcPath)) {
    throw new NabiError("srcDir and outDir must not overlap.");
  }

  return {
    ...raw,
    assets: { baseUrl, mode },
    assetsPath: resolve(srcPath, sharedDir, "assets"),
    baseRoute,
    cwd: cwdPath,
    dev: { port },
    images: { optimize },
    jsPath: resolve(srcPath, sharedDir, "js"),
    minify: { css, html, js },
    outDir,
    outPath,
    pagesDir,
    pagesPath: resolve(srcPath, pagesDir),
    sharedDir,
    sharedPath: resolve(srcPath, sharedDir),
    srcDir,
    srcPath,
    stylesPath: resolve(srcPath, sharedDir, "styles"),
  };
};

export const defineConfig = (value: NabiConfigInput): NabiConfigInput => value;
