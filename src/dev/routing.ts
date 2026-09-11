import { join } from "node:path";

import { requestRoute } from "@/routing";
import type { BuiltPage, NabiConfig } from "@/types";
import { resolveWithin } from "@/utils/paths";

type OutputPathForRequestProps = {
  config: NabiConfig;
  pages: Map<string, BuiltPage>;
  requested: string;
};

type AssetPathForRequestProps = {
  config: NabiConfig;
  requested: string;
};

const sharedOutputPathForRoute = (config: NabiConfig, route: string) => {
  for (const directory of ["assets", "styles", "js"]) {
    const prefix = [config.baseRoute, directory].filter(Boolean).join("/");

    if (route === prefix || route.startsWith(`${prefix}/`)) return route;
  }
};

const pageResourcePathForRoute = (pages: Map<string, BuiltPage>, route: string) => {
  for (const page of pages.values()) {
    if (page.resources.css.length && route === [page.publicRoute, "style.css"].filter(Boolean).join("/")) {
      return [page.outputDir, "style.css"].filter((part) => part !== ".").join("/");
    }

    if (page.resources.js.length && route === [page.publicRoute, "script.js"].filter(Boolean).join("/")) {
      return [page.outputDir, "script.js"].filter((part) => part !== ".").join("/");
    }
  }
};

export const outputPathForRequest = ({ config, pages, requested }: OutputPathForRequestProps) => {
  const route = requestRoute(requested);

  return (
    pages.get(route)?.outputPath ?? sharedOutputPathForRoute(config, route) ?? pageResourcePathForRoute(pages, route)
  );
};

export const assetPathForRequest = ({ config, requested }: AssetPathForRequestProps) => {
  const route = requestRoute(requested);
  const prefix = [config.baseRoute, "assets"].filter(Boolean).join("/");

  if (!route.startsWith(`${prefix}/`)) return;

  return resolveWithin(config.assetsPath, route.slice(prefix.length + 1), "Asset");
};

export const requestPath = (url: string | undefined) => {
  try {
    return decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname);
  } catch {
    return;
  }
};

export const outputFilePath = (config: NabiConfig, outputPath: string) => join(config.outPath, outputPath);
