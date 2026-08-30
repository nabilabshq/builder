import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

export const fileExists = async (path: string) => {
  try {
    await stat(path);

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;

    throw error;
  }
};

export const readText = (path: string) => readFile(path, "utf8");
export const writeText = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
};

export const remove = (path: string) => rm(path, { force: true, maxRetries: 8, recursive: true, retryDelay: 100 });
export const copyTree = async (source: string, destination: string) => {
  if (!(await fileExists(source))) return;

  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { dereference: true, force: true, recursive: true });
};

export const listFiles = async (root: string, extensions?: string[]) => {
  const result: string[] = [];

  const visit = async (current: string) => {
    let entries: import("node:fs").Dirent[];

    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;

      throw error;
    }

    await Promise.all(
      entries.map(async (entry: import("node:fs").Dirent) => {
        const path = join(current, entry.name);

        if (entry.isDirectory()) return visit(path);

        if (entry.isFile() && (!extensions || extensions.includes(extname(entry.name)))) {
          result.push(path);
        }
      }),
    );
  };

  await visit(root);

  return result.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
};
