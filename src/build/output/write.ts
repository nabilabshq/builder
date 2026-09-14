import { join } from "node:path";

import type { BuildMode, BuiltPage, NabiConfig } from "@/types";
import { copyTree } from "@/utils/files";

import type { SharedSourceCache } from "./html/inline";
import { type ManifestEntry, writeManifest } from "./manifest";
import { bodyDirectoryRoutes, writeDevPageOutput, writePages } from "./pages";
import { writeSharedDependencies } from "./shared";

type WriteHybridBuildProps = {
  config: NabiConfig;
  copyAssets: boolean;
  mode: BuildMode;
  pages: BuiltPage[];
  temporary: string;
};

export const writeHybridBuild = async ({ config, copyAssets, mode, pages, temporary }: WriteHybridBuildProps) => {
  if (copyAssets) {
    await copyTree(config.assetsPath, join(temporary, config.baseRoute, "assets"));
  }

  const isInline = mode === "inline";
  const isBody = mode === "body";

  if (mode === "split") {
    await writeSharedDependencies({ config, pages, temporary });
  }

  if (isBody) {
    await writeSharedDependencies({ config, pages, temporary, types: ["script"] });
  }

  const bodyRoutes = isBody
    ? await bodyDirectoryRoutes({
        config,
        pages,
        temporary,
      })
    : new Set<string>();

  const resourceCache = { css: new Map(), js: new Map() };
  const sharedSourceCache: SharedSourceCache = new Map();

  const manifestEntries = await writePages(
    {
      bodyDirectoryRoutes: bodyRoutes,
      config,
      isBody,
      isInline,
      resourceCache,
      sharedSourceCache,
      temporary,
    },
    pages,
  );

  if (mode === "split") {
    await writeManifest(
      temporary,
      manifestEntries.filter((entry): entry is ManifestEntry => entry !== undefined),
    );
  }
};

export const writeDevPage = async ({ config, page }: { config: NabiConfig; page: BuiltPage }) => {
  await writeSharedDependencies({
    config,
    pages: [page],
    temporary: config.outPath,
    types: ["script", "stylesheet"],
  });

  await writeDevPageOutput({ config, page });
};
