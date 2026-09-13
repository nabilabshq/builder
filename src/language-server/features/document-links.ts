import type { DocumentLink } from "vscode-languageserver/node.js";

import { attributeValueRange, isHtmlElement, parseHtml, visitElements } from "../html";
import { pathFromUri, ProjectManager, uriFromPath } from "../project";
import { routeDataLinksFor } from "./route-data-links";
import { isAvailableComponent } from "./shared";

type DocumentLinksFor = {
  projects: ProjectManager;
  text: string;
  uri: string;
};

export const documentLinksFor = async ({ projects, text, uri }: DocumentLinksFor) => {
  const context = await projects.contextForUri(uri);
  const filePath = pathFromUri(uri);

  if (filePath.endsWith(`${context.config.routeFileName}.json`)) {
    return (await routeDataLinksFor({ context, text })).map((link) => ({
      range: link.range,
      target: uriFromPath(link.path),
    }));
  }

  const [registry, owner] = await Promise.all([context.registryFor(filePath), context.localComponentOwner(filePath)]);
  const links: DocumentLink[] = [];

  visitElements(parseHtml(text), (node) => {
    if (!isHtmlElement(node, "use")) return;

    const ref = node.attrs?.find((attribute) => attribute.name === "ref");

    if (!ref) return;

    try {
      const component = registry.get(ref.value);

      if (!component || !isAvailableComponent({ component, owner })) return;

      links.push({
        range: attributeValueRange({ attribute: ref, node, text }),
        target: uriFromPath(component.path),
      });
    } catch {
      // Diagnostics report invalid refs; they are not links.
    }
  });

  return links;
};
