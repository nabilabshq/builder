import type { Component } from "@/types";

import type { DependencyType } from "../project";

export const sharedElements = [
  ["script", "script"],
  ["link", "stylesheet"],
] as const satisfies readonly (readonly [string, DependencyType])[];

export const nestedLocalComponent = (component: Component) =>
  component.scope === "local" && component.ref.startsWith("@") && component.ref.split("/").length > 1;

export const localComponentRoot = (component: Component) => component.ref.split("/")[0] ?? component.ref;

export const isAvailableComponent = ({ component, owner }: { component: Component; owner?: string }) =>
  (!nestedLocalComponent(component) || owner === localComponentRoot(component)) && component.ref !== owner;

export const unavailableComponentMessage = ({ component, owner }: { component: Component; owner?: string }) =>
  component.ref === owner
    ? `Component "${component.ref}" cannot reference itself`
    : `Nested local component "${component.ref}" is private to "${localComponentRoot(component)}"`;
