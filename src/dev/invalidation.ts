import { resolve } from "node:path";

import type { BuiltPage } from "@/types";

export type DependencyGraph = {
  dependenciesByPage: Map<string, Set<string>>;
  pagesByDependency: Map<string, Set<string>>;
};

export type IncrementalBuildState = DependencyGraph & {
  dirtyPages: Set<string>;
  generations: Map<string, number>;
  rebuildingPages: Map<string, Promise<void>>;
};

const dependencyPath = (path: string) => resolve(path);

const removePageDependencies = (graph: DependencyGraph, route: string) => {
  const dependencies = graph.dependenciesByPage.get(route);

  if (!dependencies) return;

  for (const dependency of dependencies) {
    const pages = graph.pagesByDependency.get(dependency);

    if (!pages) continue;

    pages.delete(route);

    if (!pages.size) {
      graph.pagesByDependency.delete(dependency);
    }
  }

  graph.dependenciesByPage.delete(route);
};

export const createIncrementalBuildState = (pages: BuiltPage[]): IncrementalBuildState => {
  const state: IncrementalBuildState = {
    dependenciesByPage: new Map(),
    dirtyPages: new Set(),
    generations: new Map(),
    pagesByDependency: new Map(),
    rebuildingPages: new Map(),
  };

  for (const page of pages) {
    replacePageDependencies(state, page);
  }

  return state;
};

export const replacePageDependencies = (graph: DependencyGraph, page: BuiltPage) => {
  removePageDependencies(graph, page.publicRoute);

  const dependencies = new Set(page.sourceDependencies.map(dependencyPath));

  graph.dependenciesByPage.set(page.publicRoute, dependencies);

  for (const dependency of dependencies) {
    const pages = graph.pagesByDependency.get(dependency) ?? new Set<string>();

    pages.add(page.publicRoute);
    graph.pagesByDependency.set(dependency, pages);
  }
};

export const removePage = (graph: DependencyGraph, route: string) => {
  removePageDependencies(graph, route);
};

const invalidate = (state: IncrementalBuildState, routes: Iterable<string>) => {
  const affected = new Set(routes);

  for (const route of affected) {
    state.dirtyPages.add(route);
    state.generations.set(route, (state.generations.get(route) ?? 0) + 1);
  }

  return affected;
};

export const invalidateDependency = (state: IncrementalBuildState, path: string) => {
  const routes = state.pagesByDependency.get(dependencyPath(path)) ?? "";

  return invalidate(state, routes);
};

export const invalidatePages = (state: IncrementalBuildState, routes: Iterable<string>) => {
  return invalidate(state, routes);
};
