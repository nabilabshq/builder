import { basename, dirname, join, relative } from "node:path";

import { NabiError } from "@/utils/errors";

import type { DynamicSegment } from "./types";

type DynamicSegmentsProps = {
  path: string;
  rootPath: string;
  routeFileName: string;
};

export const dynamicSegmentName = (segment: string) => {
  const match = /^\[([^\]]+)\]$/.exec(segment);

  if (!match) return;

  const name = match[1];

  if (!/^[A-Za-z]+$/.test(name)) {
    throw new NabiError(`Invalid dynamic route segment: "${segment}". Use a single word such as "[city]".`);
  }

  return name;
};

export const dynamicSegmentsFor = (props: DynamicSegmentsProps) => {
  const { path, rootPath, routeFileName } = props;

  const source = relative(rootPath, path).replaceAll("\\", "/");
  const fileName = basename(source);
  const directory = dirname(source);
  const directorySegments = directory === "." ? [] : directory.split("/");
  const routeSegments = fileName === "index.html" ? directorySegments : [...directorySegments, fileName.slice(0, -5)];
  const dynamicSegments: DynamicSegment[] = [];
  const names = new Set<string>();

  for (const [index, segment] of routeSegments.entries()) {
    const name = dynamicSegmentName(segment);

    if (!name) continue;

    if (names.has(name)) {
      throw new NabiError(`Dynamic route parameter "${name}" is used more than once: ${source}`);
    }

    const parentNames = [...names];

    names.add(name);

    const pathSegments = index < directorySegments.length ? directorySegments.slice(0, index + 1) : directorySegments;
    const routeFilePath = join(rootPath, ...pathSegments, routeFileName);

    dynamicSegments.push({
      hookPath: `${routeFilePath}.js`,
      name,
      parentNames,
      routeConfigPath: `${routeFilePath}.json`,
    });
  }

  return {
    dynamicSegments,
    routeSegments,
  };
};
