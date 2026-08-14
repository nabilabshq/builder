import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NabiError } from "./utils/errors.js";
import { fileExists } from "./utils/files.js";

const defaults = {
  srcDir: "src",
  pagesDir: "src/pages",
  sharedDir: "src/shared",
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
  return {
    ...raw,
    baseRoute,
    cwd: resolve(cwd),
    pagesPath: resolve(cwd, raw.pagesDir),
    sharedPath: resolve(cwd, raw.sharedDir),
    sharedComponentsPath: resolve(cwd, raw.sharedDir, "components"),
    sharedStylesPath: resolve(cwd, raw.sharedDir, "styles"),
    sharedJsPath: resolve(cwd, raw.sharedDir, "js"),
    sharedAssetsPath: resolve(cwd, raw.sharedDir, "assets"),
    assetsPath: resolve(cwd, raw.sharedDir, "assets"),
    outPath: resolve(cwd, raw.outDir),
  };
};
