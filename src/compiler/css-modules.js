import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { transform } from "lightningcss";

import { readText } from "../utils/files.js";

const isModuleFile = (path) => {
  const name = basename(path);
  return name === "module.css" || name.endsWith(".module.css");
};

const filenameFrom = ({ path, sourcePath }) => relative(sourcePath, path).replaceAll("\\", "/");

export const cssModulePathsFor = async (path) => {
  const directory = dirname(path);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isModuleFile(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

const transformModule = ({ source, path, sourcePath, minify = false }) =>
  transform({
    filename: filenameFrom({ path, sourcePath }),
    code: Buffer.from(source),
    cssModules: { pattern: "[local]--[hash]" },
    minify,
  });

export const cssModuleClassNames = async ({ paths, sourcePath }) => {
  const classes = new Map();
  for (const path of paths) {
    const source = await readText(path);
    const { exports = {} } = transformModule({ source, path, sourcePath });
    for (const [localName, value] of Object.entries(exports)) classes.set(localName, value.name);
  }
  return classes;
};

export const compileCssModule = ({ source, path, sourcePath, minify }) =>
  transformModule({ source, path, sourcePath, minify }).code.toString("utf8");
