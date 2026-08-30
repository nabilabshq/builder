import { relative, resolve, sep } from "node:path";

import { BuildMode } from "@/types";

import { NabiError } from "./errors";

export const inside = (root: string, target: string) => {
  const relation = relative(resolve(root), resolve(target));

  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
};

export const resolveWithin = (root: string, requested: string, label: string) => {
  const path = resolve(root, requested);

  if (!inside(root, path)) {
    throw new NabiError(`${label} path escapes its configured directory: ${requested}`);
  }

  return path;
};

export const isDotSegment = (value: string) => value === "." || value === "..";
export const isBuildMode = (value: unknown): value is BuildMode => {
  return value === "split" || value === "inline" || value === "body";
};
