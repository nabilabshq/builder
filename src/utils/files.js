import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

export const fileExists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const readText = (path) => readFile(path, "utf8");

export const writeText = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
};

export const remove = (path) => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });

export const copyTree = async (source, destination) => {
  if (!(await fileExists(source))) return;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
};

export const listFiles = async (root, extensions) => {
  const result = [];
  const visit = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(current, entry.name);
        if (entry.isDirectory()) return visit(path);
        if (entry.isFile() && (!extensions || extensions.includes(extname(entry.name)))) result.push(path);
      }),
    );
  };
  await visit(root);
  return result.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
};
