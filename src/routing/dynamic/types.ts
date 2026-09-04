import type { RouteData } from "@/types";

export type DynamicPageProps = {
  dataPath: string;
  path: string;
  rootPath: string;
  routeConfigCache: RouteConfigCache;
  routeDataCache: RouteDataCache;
  routeFileName: string;
  routeHookCache: RouteHookCache;
};

export type DynamicPage = {
  context: RouteContext;
  route: string;
  routeData: Record<string, RouteData | string>;
};

export type DynamicSegment = {
  hookPath: string;
  name: string;
  parentNames: string[];
  routeConfigPath: string;
};

export type ParsedRouteRecord = {
  props?: RouteData;
  slug: string;
  when?: RouteConditions;
};

export type RouteConditions = Record<string, string[]>;
export type RouteContext = Record<string, string>;
export type RouteDataCache = Map<string, Promise<ParsedRouteRecord[]>>;
export type RouteConfigCache = Map<string, Promise<unknown>>;
export type RouteHook = (props: RouteHookProps) => RouteData | null | undefined | Promise<RouteData | null | undefined>;
export type RouteHookCache = Map<string, Promise<RouteHook | undefined>>;
export type RouteHookProps = { props?: RouteData; route: RouteContext };
