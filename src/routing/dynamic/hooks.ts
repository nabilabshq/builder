import { register } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RouteData } from "@/types";
import { NabiError } from "@/utils/errors";
import { fileExists, readText } from "@/utils/files";

import type { RouteHook, RouteHookCache, RouteHookProps } from "./types";

type RouteHookDependenciesProps = {
  pagePath: string;
  pagesPath: string;
  routeFileName: string;
  sourcePath: string;
};

const importSpecifier = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

const scriptPathFor = async (path: string) => {
  const candidates = extname(path)
    ? [path]
    : [path, `${path}.js`, `${path}.mjs`, `${path}.json`, join(path, "index.js")];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
};

const importedPathFor = (specifier: string, sourcePath: string, path: string) => {
  if (specifier.startsWith("@/")) {
    return resolve(sourcePath, specifier.slice(2));
  }

  if (specifier.startsWith(".")) {
    return resolve(dirname(path), specifier);
  }
};

export const routeHookDependencies = async (props: RouteHookDependenciesProps) => {
  const { pagePath, pagesPath, routeFileName, sourcePath } = props;

  const dependencies = new Set<string>();

  const visit = async (path: string): Promise<void> => {
    if (dependencies.has(path)) return;

    dependencies.add(path);
    const source = await readText(path);

    for (const [, specifier] of source.matchAll(importSpecifier)) {
      const importedSourcePath = importedPathFor(specifier, sourcePath, path);

      if (!importedSourcePath) continue;

      const imported = await scriptPathFor(importedSourcePath);

      if (imported) {
        await visit(imported);
      }
    }
  };

  let directory = dirname(pagePath);

  while (!relative(pagesPath, directory).startsWith("..")) {
    const hookPath = join(directory, `${routeFileName}.js`);

    if (await fileExists(hookPath)) {
      await visit(hookPath);
    }

    if (directory === pagesPath) break;

    directory = dirname(directory);
  }

  return [...dependencies];
};

const routeAliasLoader = String.raw`
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const compilerConfigs = new Map();

const isMissing = (error) => error && typeof error === "object" && error.code === "ENOENT";

const filePathFor = async (path) => {
  const candidates = extname(path)
    ? [path]
    : [path, path + ".js", path + ".mjs", path + ".json", join(path, "index.js")];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
};

const compilerAliasesFor = async (path) => {
  let directory = dirname(path);

  while (true) {
    const cached = compilerConfigs.get(directory);

    if (cached) return cached;

    for (const name of ["jsconfig.json", "tsconfig.json"]) {
      const configPath = join(directory, name);

      try {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        const paths = config.compilerOptions?.paths;
        const aliases =
          paths && typeof paths === "object"
            ? Object.entries(paths)
                .filter(
                  ([, targets]) => Array.isArray(targets) && targets.every((target) => typeof target === "string"),
                )
                .map(([pattern, targets]) => ({
                  pattern,
                  targets: targets.map((target) => resolvePath(directory, target)),
                }))
                .sort((left, right) => right.pattern.replace("*", "").length - left.pattern.replace("*", "").length)
            : [];

        compilerConfigs.set(directory, aliases);

        return aliases;
      } catch (error) {
        if (!isMissing(error)) throw new Error("Invalid project compiler config: " + configPath);
      }
    }

    const parent = dirname(directory);

    if (parent === directory) {
      compilerConfigs.set(directory, []);

      return [];
    }

    directory = parent;
  }
};

const aliasPathFor = async (specifier, aliases) => {
  for (const alias of aliases) {
    const star = alias.pattern.indexOf("*");
    const prefix = star === -1 ? alias.pattern : alias.pattern.slice(0, star);
    const suffix = star === -1 ? "" : alias.pattern.slice(star + 1);
    const matches = star === -1 ? specifier === alias.pattern : specifier.startsWith(prefix) && specifier.endsWith(suffix);

    if (!matches) continue;

    const wildcard = star === -1 ? "" : specifier.slice(prefix.length, specifier.length - suffix.length);

    for (const target of alias.targets) {
      const path = await filePathFor(target.replace("*", wildcard));

      if (path) return path;
    }
  }
};

export const resolve = async (specifier, context, nextResolve) => {
  if (!context.parentURL?.startsWith("file:") || specifier.startsWith("/") || specifier.includes(":")) {
    return nextResolve(specifier, context);
  }

  const token = new URL(context.parentURL).searchParams.get("nabi");

  if (specifier.startsWith(".")) {
    const result = await nextResolve(specifier, context);

    if (!token || !result.url.startsWith("file:")) {
      return result;
    }

    const url = new URL(result.url);
    url.searchParams.set("nabi", token);

    return {
      ...result,
      shortCircuit: true,
      url: url.href,
    };
  }

  const aliases = await compilerAliasesFor(fileURLToPath(context.parentURL));
  const path = await aliasPathFor(specifier, aliases);

  if (!path) {
    return nextResolve(specifier, context);
  }

  const details = stat(path);
  const url = new URL(pathToFileURL(path));

  url.searchParams.set("nabi", token ?? String((await details).mtimeMs));

  return {
    shortCircuit: true,
    url: url.href,
  };
};

export const load = async (url, context, nextLoad) => {
  if (!new URL(url).pathname.endsWith(".json")) return nextLoad(url, context);

  const source = await readFile(fileURLToPath(url), "utf8");

  try {
    JSON.parse(source);
  } catch {
    throw new Error("Invalid JSON module: " + fileURLToPath(url));
  }

  return {
    format: "module",
    shortCircuit: true,
    source: "export default " + source + ";",
  };
};
`;

let aliasLoaderRegistered = false;

const registerAliasLoader = () => {
  if (aliasLoaderRegistered) return;

  register(`data:text/javascript,${encodeURIComponent(routeAliasLoader)}`, import.meta.url);
  aliasLoaderRegistered = true;
};

const isPlainObject = (value: unknown): value is RouteData => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
};

const hookModuleFor = async (path: string) => {
  registerAliasLoader();

  return import(`${pathToFileURL(path).href}?nabi=${Date.now()}`);
};

export const routeHookFor = async (path: string, cache: RouteHookCache): Promise<RouteHook | undefined> => {
  const existing = cache.get(path);

  if (existing) return existing;

  const hook = (async () => {
    if (!(await fileExists(path))) return;

    let module: unknown;

    try {
      module = await hookModuleFor(path);
    } catch (error) {
      throw new NabiError(
        `Unable to load route hook: ${path}\n${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const candidate = (module as { default?: unknown }).default;

    if (typeof candidate !== "function") throw new NabiError(`Route hook must export a default function: ${path}`);

    return candidate as RouteHook;
  })();

  cache.set(path, hook);

  return hook;
};

export const routePropsFromHook = async (
  path: string,
  hook: RouteHook,
  props: RouteHookProps,
): Promise<RouteData | undefined> => {
  let result: unknown;

  try {
    result = await hook({
      ...(props.props ? { props: Object.freeze({ ...props.props }) } : {}),
      route: Object.freeze({ ...props.route }),
    });
  } catch (error) {
    throw new NabiError(`Route hook failed: ${path}\n${error instanceof Error ? error.message : String(error)}`);
  }

  if (result === null || result === undefined) return;

  if (!isPlainObject(result)) throw new NabiError(`Route hook must return an object, null, or undefined: ${path}`);

  return result;
};
