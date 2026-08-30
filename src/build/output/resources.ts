import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { minifyCss, minifyJs } from "@/build/minify";
import type { AssetCache } from "@/build/types";
import { compileCssModule } from "@/compiler/css-modules";
import type { BuiltPage, NabiConfig, PageResources } from "@/types";

type CachedReadProps = {
  cache: Map<string, Promise<string>>;
  path: string;
  read: () => Promise<string>;
};

type ReadResourcesProps = {
  cache: AssetCache;
  config: NabiConfig;
  minify: NabiConfig["minify"];
  resources: PageResources;
};

type ReadResourcesReturn = Promise<{ css: string[]; js: string[] }>;

const cachedRead = async ({ cache, path, read }: CachedReadProps) => {
  const existing = cache.get(path);

  if (existing) return existing;

  const value = read();

  cache.set(path, value);

  return value;
};

export const readResources = async ({ cache, config, minify, resources }: ReadResourcesProps): ReadResourcesReturn => ({
  css: await Promise.all(
    resources.css.map(async (path) => {
      const isModule = resources.cssModules.includes(path);

      return cachedRead({
        cache: cache.css,
        path,
        read: async () => {
          const source = await readFile(path, "utf8");

          if (isModule)
            return compileCssModule({
              minify: minify.css,
              path,
              source,
              sourcePath: config.srcPath,
            });

          return minify.css ? minifyCss(source) : source;
        },
      });
    }),
  ),
  js: await Promise.all(
    resources.js.map((path) =>
      cachedRead({
        cache: cache.js,
        path,
        read: async () => {
          const source = await readFile(path, "utf8");

          return minify.js ? minifyJs(source) : source;
        },
      }),
    ),
  ),
});

export const publicResourcePath = (page: BuiltPage, fileName: string) =>
  `/${[page.publicRoute, fileName].filter(Boolean).join("/")}`;

export const sourcePathFromProject = ({ config, path }: { config: NabiConfig; path: string }) =>
  relative(config.srcPath, path).replaceAll("\\", "/");
