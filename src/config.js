import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NabiError } from "./utils/errors.js";
import { fileExists } from "./utils/files.js";

const defaults = {
  srcDir: "src",
  pagesDir: "pages",
  sharedDir: "shared",
  outDir: "dist",
  baseRoute: "",
  defaultBuildMode: "split",
  dev: { port: 2111, open: false },
  assets: { mode: "copy", baseUrl: "" },
  minify: { html: false, css: true, js: false },
  images: { optimize: false },
};

const normaliseBaseRoute = (value) => {
  if (typeof value !== "string") throw new NabiError("baseRoute must be a string.");
  const route = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  if (!route) return "";
  const segments = route.split("/");
  if (segments.some((segment) => !segment || [".", ".."].includes(segment)))
    throw new NabiError(`Invalid baseRoute: ${value}`);
  return segments.join("/");
};

const normalisePagesDir = (value) => {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\\/]/.test(value) ||
    [".", ".."].includes(value)
  )
    throw new NabiError('pagesDir must be a single directory name inside src, for example "pages".');
  return value;
};

const normaliseSharedDir = (value) => {
  if (typeof value !== "string" || !value || value !== value.trim() || /^(?:src)[\\/]/i.test(value))
    throw new NabiError('sharedDir is relative to src, for example "shared".');
  return value;
};

export const loadConfig = async ({ cwd = process.cwd(), config: overrides = {} } = {}) => {
  const configPath = resolve(cwd, "nabi.config.js");
  let userConfig = {};
  if (await fileExists(configPath)) {
    const module = await import(`${pathToFileURL(configPath).href}?v=${Date.now()}`);
    userConfig = module.default ?? {};
  }
  const raw = {
    ...defaults,
    ...userConfig,
    ...overrides,
    dev: { ...defaults.dev, ...userConfig.dev, ...overrides.dev },
    assets: { ...defaults.assets, ...userConfig.assets, ...overrides.assets },
    minify: { ...defaults.minify, ...userConfig.minify, ...overrides.minify },
    images: { ...defaults.images, ...userConfig.images, ...overrides.images },
  };
  if (!["split", "inline"].includes(raw.defaultBuildMode))
    throw new NabiError(`Invalid defaultBuildMode: ${raw.defaultBuildMode}`);
  if (Object.values(raw.minify).some((value) => typeof value !== "boolean"))
    throw new NabiError("minify.html, minify.css, and minify.js must be booleans.");
  if (typeof raw.images.optimize !== "boolean") throw new NabiError("images.optimize must be a boolean.");
  const baseRoute = normaliseBaseRoute(raw.baseRoute);
  const pagesDir = normalisePagesDir(raw.pagesDir);
  const sharedDir = normaliseSharedDir(raw.sharedDir);
  return {
    ...raw,
    baseRoute,
    pagesDir,
    sharedDir,
    cwd: resolve(cwd),
    srcPath: resolve(cwd, raw.srcDir),
    pagesPath: resolve(cwd, raw.srcDir, pagesDir),
    sharedPath: resolve(cwd, raw.srcDir, sharedDir),
    sharedStylesPath: resolve(cwd, raw.srcDir, sharedDir, "styles"),
    sharedJsPath: resolve(cwd, raw.srcDir, sharedDir, "js"),
    sharedAssetsPath: resolve(cwd, raw.srcDir, sharedDir, "assets"),
    assetsPath: resolve(cwd, raw.srcDir, sharedDir, "assets"),
    outPath: resolve(cwd, raw.outDir),
  };
};
