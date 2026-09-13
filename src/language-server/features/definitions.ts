import type { Location, Position } from "vscode-languageserver/node.js";

import { resolveSharedDependency } from "@/compiler/dependencies";

import type { HtmlAttribute, HtmlElement } from "../html";
import { attributeValueOffsets, isHtmlElement, offsetAt, parseHtml, rangeAt, visitElements } from "../html";
import { pathFromUri, ProjectManager, uriFromPath } from "../project";
import { routeDataLinkAt } from "./route-data-links";
import { isAvailableComponent, sharedElements } from "./shared";

type AttributeMatch = {
  attribute: HtmlAttribute;
  node: HtmlElement;
};

type DefinitionFor = {
  position: Position;
  projects: ProjectManager;
  text: string;
  uri: string;
};

const attributeAt = ({ position, text }: { position: Position; text: string }) => {
  const offset = offsetAt(text, position);

  let result: AttributeMatch | undefined;

  visitElements(parseHtml(text), (node) => {
    for (const attribute of node.attrs ?? []) {
      const range = attributeValueOffsets({ attribute, node, text });

      if (offset >= range.start && offset <= range.end) result = { attribute, node };
    }
  });

  return result;
};

export const definitionFor = async ({ position, projects, text, uri }: DefinitionFor): Promise<Location[]> => {
  const context = await projects.contextForUri(uri);
  const filePath = pathFromUri(uri);

  if (filePath.endsWith(`${context.config.routeFileName}.json`)) {
    const link = await routeDataLinkAt({ context, position, text });

    return link
      ? [
          {
            range: rangeAt("", 0, 0),
            uri: uriFromPath(link.path),
          },
        ]
      : [];
  }

  const found = attributeAt({ position, text });

  if (!found) return [];

  if (isHtmlElement(found.node, "use") && found.attribute.name === "ref") {
    try {
      const component = (await context.registryFor(filePath)).get(found.attribute.value);
      const owner = await context.localComponentOwner(filePath);

      if (component && !isAvailableComponent({ component, owner })) return [];

      return component ? [{ range: rangeAt("", 0, 0), uri: uriFromPath(component.path) }] : [];
    } catch {
      return [];
    }
  }

  const type =
    found.attribute.name === "use"
      ? sharedElements.find(([tag]) => {
          return isHtmlElement(found.node, tag);
        })?.[1]
      : undefined;

  if (!type) return [];

  try {
    const path = await resolveSharedDependency({
      config: context.config,
      page: filePath,
      type,
      value: found.attribute.value,
    });

    return [
      {
        range: rangeAt("", 0, 0),
        uri: uriFromPath(path),
      },
    ];
  } catch {
    return [];
  }
};
