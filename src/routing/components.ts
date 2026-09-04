import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { inside } from "@/utils/paths";

import { toPosix } from "./paths";

type LocalComponentPathsProps = {
  directory: string;
  rootPath: string;
};
type ComponentSourceProps = {
  path: string;
  rootPath: string;
};

export const isComponentSource = ({ path, rootPath }: ComponentSourceProps) =>
  toPosix(relative(rootPath, path))
    .split("/")
    .some((segment) => segment.startsWith("@"));

export const localComponentPaths = async (props: LocalComponentPathsProps): Promise<string[]> => {
  const { directory, rootPath } = props;

  const paths: string[] = [];
  let current = directory;

  while (inside(rootPath, current)) {
    let entries: import("node:fs").Dirent[] = [];

    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    paths.push(
      ...entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("@"))
        .map((entry) => resolve(current, entry.name)),
    );

    if (current === rootPath) break;

    current = dirname(current);
  }

  return paths.reverse();
};
