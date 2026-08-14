import { relative, resolve, sep } from "node:path";

import { NabiError } from "./errors.js";

export const inside = (root, target) => {
  const relation = relative(resolve(root), resolve(target));
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
};

export const resolveWithin = (root, requested, label) => {
  const path = resolve(root, requested);
  if (!inside(root, path)) throw new NabiError(`${label} path escapes its configured directory: ${requested}`);
  return path;
};
