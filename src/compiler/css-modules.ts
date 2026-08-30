import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { transform } from "lightningcss";

import { readText } from "@/utils/files";

type TransformModule = {
  minify?: boolean;
  path: string;
  source: string;
  sourcePath: string;
};

type CssModuleClassNames = {
  paths: string[];
  sourcePath: string;
};

type CompileCssModule = {
  minify: boolean;
  path: string;
  source: string;
  sourcePath: string;
};

const isModuleFile = (path: string) => {
  const name = basename(path);

  return name === "module.css" || name.endsWith(".module.css");
};

const filenameFrom = ({ path, sourcePath }: { path: string; sourcePath: string }) =>
  relative(sourcePath, path).replaceAll("\\", "/");

export const cssModulePathsFor = async (path: string) => {
  const directory = dirname(path);

  try {
    const entries = await readdir(directory, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && isModuleFile(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const transformModule = ({ minify = false, path, source, sourcePath }: TransformModule) =>
  transform({
    code: Buffer.from(source),
    cssModules: { pattern: "[local]--[hash]" },
    filename: filenameFrom({ path, sourcePath }),
    minify,
  });

export const cssModuleClassNames = async ({ paths, sourcePath }: CssModuleClassNames) => {
  const classes = new Map<string, string>();

  for (const path of paths) {
    const source = await readText(path);
    const { exports = {} } = transformModule({ path, source, sourcePath });

    for (const [localName, value] of Object.entries(exports)) {
      classes.set(localName, value.name);
    }
  }

  return classes;
};

export const compileCssModule = ({ minify, path, source, sourcePath }: CompileCssModule) =>
  transformModule({ minify, path, source, sourcePath }).code.toString();
