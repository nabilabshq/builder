import { resolve } from "node:path";

import type { Position, Range } from "vscode-languageserver/node.js";

import { fileExists } from "@/utils/files";
import { inside } from "@/utils/paths";

import { offsetAt, rangeAt } from "../html";
import type { ProjectContext } from "../project";

type RouteDataLink = {
  path: string;
  range: Range;
};

type SourceLinks = {
  end: number;
  start: number;
  value: string;
};

type RouteDataLinksFor = {
  context: ProjectContext;
  text: string;
};

type RouteDataLinkAt = {
  context: ProjectContext;
  position: Position;
  text: string;
};

const stringValue = /"((?:[^"\\]|\\.)*)"/g;
const scalarData = /"@data"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const arrayData = /"@data"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)+\s*)\]/g;

const valueFor = (source: string) => {
  try {
    return JSON.parse(`"${source}"`) as unknown;
  } catch {
    return;
  }
};

const linksForSource = (source: string, start: number) => {
  const links: SourceLinks[] = [];

  for (const match of source.matchAll(stringValue)) {
    const value = valueFor(match[1]!);

    if (typeof value !== "string") continue;

    const stringStart = start + match.index!;
    links.push({
      end: stringStart + match[0].length,
      start: stringStart,
      value,
    });
  }

  return links;
};

export const routeDataLinksFor = async ({ context, text }: RouteDataLinksFor) => {
  const sources = [
    ...[...text.matchAll(scalarData)].flatMap((match) => linksForSource(match[0], match.index!)),
    ...[...text.matchAll(arrayData)].flatMap((match) => {
      const values = match[1]!;
      const start = match.index! + match[0].indexOf(values);

      return linksForSource(values, start);
    }),
  ];

  const links: RouteDataLink[] = [];

  for (const source of sources) {
    const path = resolve(context.config.dataPath, source.value);

    if (!source.value.endsWith(".json")) {
      continue;
    }

    if (!inside(context.config.dataPath, path) || !(await fileExists(path))) {
      continue;
    }

    links.push({
      path,
      range: rangeAt(text, source.start, source.end),
    });
  }

  return links;
};

export const routeDataLinkAt = async ({ context, position, text }: RouteDataLinkAt) => {
  const offset = offsetAt(text, position);
  const links = await routeDataLinksFor({ context, text });

  return links.find((link) => {
    const start = offsetAt(text, link.range.start);
    const end = offsetAt(text, link.range.end);

    return offset >= start && offset <= end;
  });
};
