import { basename, dirname, relative } from "node:path";

import { transform } from "lightningcss";

import { listFiles, readText } from "../utils/files.js";

const isModuleFile = (path) => {
  const name = basename(path);
  return name === "module.css" || name.endsWith(".module.css");
};

const filenameFrom = ({ path, sourcePath }) => relative(sourcePath, path).replaceAll("\\", "/");

export const cssModulePathsFor = async (path) => {
  const directory = dirname(path);
  return (await listFiles(directory, [".css"])).filter((candidate) => dirname(candidate) === directory && isModuleFile(candidate));
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
