import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RouteData } from "@/types";
import { NabiError } from "@/utils/errors";
import { inside } from "@/utils/paths";

import type { ParsedRouteRecord, RouteConditions, RouteConfigCache, RouteContext, RouteDataCache } from "./types";

type RouteDataForProps = {
  configCache: RouteConfigCache;
  dataCache: RouteDataCache;
  dataPath: string;
  parentNames: string[];
  routeConfigPath: string;
  segment: string;
};

const dataKey = "@data";
const slugKey = "@slug";
const whenKey = "@when";

const isPlainObject = (value: unknown): value is RouteData =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const isRouteValue = (value: unknown): value is string =>
  typeof value === "string" && (value === "" || /^[\p{L}\p{N}_-]+$/u.test(value));

const readJson = async (path: string, label: string): Promise<unknown> => {
  let source: string;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NabiError(`${label} not found: ${path}`);
    }

    throw error;
  }

  try {
    return JSON.parse(source);
  } catch {
    throw new NabiError(`Invalid JSON in ${label}: ${path}`);
  }
};

const parseWhen = (value: unknown, parentNames: string[], path: string): RouteConditions | undefined => {
  if (value === undefined) return;

  if (!isPlainObject(value)) {
    throw new NabiError(`"${whenKey}" must be an object: ${path}`);
  }

  const conditions: RouteConditions = {};

  for (const [name, condition] of Object.entries(value)) {
    if (!parentNames.includes(name)) {
      throw new NabiError(`Unknown "${whenKey}" parameter "${name}": ${path}`);
    }

    const values = Array.isArray(condition) ? condition : [condition];

    if (!values.length || !values.every(isRouteValue)) {
      throw new NabiError(`"${whenKey}.${name}" must be a valid route value or non-empty array: ${path}`);
    }

    conditions[name] = values;
  }

  return conditions;
};

const dataPathsFor = (value: unknown, dataPath: string, path: string) => {
  if (value === undefined) return [];

  const values = typeof value === "string" ? [value] : value;

  if (!Array.isArray(values) || !values.length || !values.every((item) => typeof item === "string" && item)) {
    throw new NabiError(`"@data" must be a path or non-empty array of paths: ${path}`);
  }

  return values.map((item) => {
    const resolved = resolve(dataPath, item);

    if (!inside(dataPath, resolved) || !item.endsWith(".json")) {
      throw new NabiError(`"@data" path must stay inside dataDir: ${item}`);
    }

    return resolved;
  });
};

const sourceDataFor = async (path: string, cache: RouteConfigCache): Promise<Record<string, RouteData>> => {
  const existing = cache.get(path);

  if (existing) {
    return existing as Promise<Record<string, RouteData>>;
  }

  const data = readJson(path, "Route data source").then((value) => {
    if (!isPlainObject(value)) {
      throw new NabiError(`Route data source must be an object: ${path}`);
    }

    for (const [slug, record] of Object.entries(value)) {
      if (!isRouteValue(slug)) {
        throw new NabiError(`Invalid route data source slug "${slug}": ${path}`);
      }

      if (!isPlainObject(record)) {
        throw new NabiError(`Route data source record "${slug}" must be an object: ${path}`);
      }
    }

    return value as Record<string, RouteData>;
  });

  cache.set(path, data);

  return data;
};

const parseRouteRecords = async (props: RouteDataForProps): Promise<ParsedRouteRecord[]> => {
  const { configCache, dataPath, parentNames, routeConfigPath, segment } = props;

  const value = await readJson(routeConfigPath, "Route config");

  if (Array.isArray(value)) {
    if (!value.every(isRouteValue)) {
      throw new NabiError(`Route config must be an array of valid slugs: ${routeConfigPath}`);
    }

    return value.map((slug) => ({ slug }));
  }

  if (!isPlainObject(value)) {
    throw new NabiError(`Route config must be an array or object: ${routeConfigPath}`);
  }

  const dataPaths = dataPathsFor(value[dataKey], dataPath, routeConfigPath);

  for (const key of Object.keys(value)) {
    if (key === slugKey) {
      throw new NabiError(`"${slugKey}" is reserved. Use the object key as the route slug: ${routeConfigPath}`);
    }

    if (key.startsWith("@") && key !== dataKey) {
      throw new NabiError(`Unknown route metadata "${key}": ${routeConfigPath}`);
    }
  }

  const sources = await Promise.all(dataPaths.map((path) => sourceDataFor(path, configCache)));
  const records = new Map<string, ParsedRouteRecord>();

  for (const source of sources) {
    for (const [slug, sourceProps] of Object.entries(source)) {
      const previous = records.get(slug);

      records.set(slug, {
        props: { ...previous?.props, ...sourceProps },
        slug,
      });
    }
  }

  for (const [slug, local] of Object.entries(value)) {
    if (slug === dataKey) continue;

    if (!isRouteValue(slug)) {
      throw new NabiError(`Invalid route slug "${slug}" for "[${segment}]": ${routeConfigPath}`);
    }

    if (!isPlainObject(local)) {
      throw new NabiError(`Route props for "${slug}" must be an object: ${routeConfigPath}`);
    }

    const { [whenKey]: whenValue, ...localProps } = local;
    const previous = records.get(slug);

    records.set(slug, {
      props: { ...previous?.props, ...localProps },
      slug,
      ...(whenValue === undefined ? {} : { when: parseWhen(whenValue, parentNames, routeConfigPath) }),
    });
  }

  return [...records.values()];
};

export const routeDataFor = (props: RouteDataForProps): Promise<ParsedRouteRecord[]> => {
  const existing = props.dataCache.get(props.routeConfigPath);

  if (existing) return existing;

  const records = parseRouteRecords(props);

  props.dataCache.set(props.routeConfigPath, records);

  return records;
};

export const matchesWhen = (context: RouteContext, conditions: RouteConditions | undefined) => {
  if (!conditions) return true;

  return Object.entries(conditions).every(([name, values]) => {
    const value = context[name];

    return value !== undefined && values.includes(value);
  });
};
