import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { minifyCss, minifyJs } from "@/build/minify";
import type { BuiltPage, NabiConfig, SharedDependencyType } from "@/types";
import { writeText } from "@/utils/files";

type WriteSharedFilesProps = {
  directory: string;
  paths: string[];
  root: string;
  temporary: string;
  transform: (source: string) => Promise<string> | string;
};

type WriteSharedDependenciesProps = {
  config: NabiConfig;
  pages: BuiltPage[];
  temporary: string;
  types?: SharedDependencyType[];
};

const writeSharedFiles = async (props: WriteSharedFilesProps) => {
  const { directory, paths, root, temporary, transform } = props;

  await Promise.all(
    paths.map(async (path) => {
      const output = join(temporary, directory, relative(root, path));
      const source = await readFile(path, "utf8");

      await writeText(output, await transform(source));
    }),
  );
};

export const writeSharedDependencies = async (props: WriteSharedDependenciesProps) => {
  const { config, pages, temporary, types } = props;

  const sharedTypes = types ?? ["script", "stylesheet"];

  const styles = sharedTypes.includes("stylesheet")
    ? [...new Set(pages.flatMap((page) => page.dependencies.styles))]
    : [];
  const scripts = sharedTypes.includes("script")
    ? [...new Set(pages.flatMap((page) => page.dependencies.scripts))]
    : [];

  await Promise.all([
    writeSharedFiles({
      directory: join(config.baseRoute, "styles"),
      paths: styles,
      root: config.stylesPath,
      temporary,
      transform: (source) => (config.minify.css ? minifyCss(source) : source),
    }),
    writeSharedFiles({
      directory: join(config.baseRoute, "js"),
      paths: scripts,
      root: config.jsPath,
      temporary,
      transform: (source) => (config.minify.js ? minifyJs(source) : source),
    }),
  ]);
};
