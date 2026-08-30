import type { Component } from "@/types";
import type { HtmlNode } from "@/utils/html";

import type { ComponentRegistry } from "../registry";

export type CompilationState = {
  headNodes: HtmlNode[];
  readonly onComponentResolved?: (component: Component) => void;
  readonly owner?: string;
  readonly page: string;
  readonly registry: ComponentRegistry;
  readonly source: string;
  readonly stack: readonly string[];
};

export type CompilePageOptions = {
  cssModuleClasses?: Map<string, string>;
  onComponentResolved?: (component: Component) => void;
  page?: string;
  registry: ComponentRegistry;
  source: string;
};
