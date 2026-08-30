import type { Diagnostic, Range } from "vscode-languageserver/node.js";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";

import { resolveSharedDependency } from "@/compiler/dependencies";

import type { HtmlAttribute, HtmlElement } from "../html";
import { attributeValueRange, elementRange, isHtmlElement, parseHtml, rangeAt, visitElements } from "../html";
import type { DependencyType, ProjectContext } from "../project";
import { pathFromUri, ProjectManager } from "../project";
import { isAvailableComponent, sharedElements, unavailableComponentMessage } from "./shared";

type DiagnosticsFor = {
  projects: ProjectManager;
  text: string;
  uri: string;
};

type CheckShared = {
  attribute: HtmlAttribute;
  node: HtmlElement;
  type: DependencyType;
};

const diagnostic = ({ message, range }: { message: string; range: Range }): Diagnostic => ({
  message,
  range,
  severity: DiagnosticSeverity.Error,
  source: "nabi",
});

const readableError = (error: unknown) => (error instanceof Error ? error.message.split("\n")[0] : String(error));
const hasDefaultSlotContent = (node: HtmlElement) =>
  (node.childNodes ?? []).some((child) => {
    const slot = child.attrs?.find((attribute) => attribute.name === "slot");

    if (slot?.value) return false;

    return child.nodeName !== "#text" || Boolean(child.value?.trim());
  });

const hasSlotContent = (node: HtmlElement) =>
  (node.childNodes ?? []).some((child) => child.nodeName !== "#text" || Boolean(child.value?.trim()));

const isSelfClosingUse = ({ node, text }: { node: HtmlElement; text: string }) => {
  const tag = node.sourceCodeLocation?.startTag;

  return tag ? /\/\s*>$/.test(text.slice(tag.startOffset, tag.endOffset)) : false;
};

export const diagnosticsFor = async ({ projects, text, uri }: DiagnosticsFor) => {
  let context: ProjectContext;

  try {
    context = await projects.contextForUri(uri);
  } catch (error) {
    return [diagnostic({ message: readableError(error), range: rangeAt(text, 0, 0) })];
  }

  const filePath = pathFromUri(uri);
  const diagnostics: Diagnostic[] = [];
  const document = parseHtml(text);
  const registry = await context.registryFor(filePath);
  const owner = await context.localComponentOwner(filePath);
  const componentMetadata = await context.componentMetadata(filePath);

  const checkShared = async ({ attribute, node, type }: CheckShared) => {
    try {
      await resolveSharedDependency({
        config: context.config,
        page: filePath,
        type,
        value: attribute.value,
      });
    } catch (error) {
      diagnostics.push(
        diagnostic({
          message: readableError(error),
          range: attributeValueRange({ attribute, node, text }),
        }),
      );
    }
  };

  const pending: Promise<void>[] = [];

  visitElements(document, (node, parent) => {
    if (isHtmlElement(node, "use")) {
      const ref = node.attrs?.find((attribute) => attribute.name === "ref");

      if (!ref) {
        diagnostics.push(
          diagnostic({
            message: 'Missing required attribute "ref"',
            range: elementRange({ node, text }),
          }),
        );
      } else {
        try {
          const component = registry.get(ref.value);

          if (!component) {
            diagnostics.push(
              diagnostic({
                message: `Component not found: "${ref.value}"`,
                range: attributeValueRange({ attribute: ref, node, text }),
              }),
            );
          } else if (!isAvailableComponent({ component, owner })) {
            diagnostics.push(
              diagnostic({
                message: unavailableComponentMessage({ component, owner }),
                range: attributeValueRange({ attribute: ref, node, text }),
              }),
            );
          } else {
            const metadata = componentMetadata.get(component.ref);

            if (metadata && !metadata.slots.includes("default") && !isSelfClosingUse({ node, text })) {
              const range = elementRange({ node, text });

              if (hasDefaultSlotContent(node)) {
                diagnostics.push(
                  diagnostic({
                    message: `Component "${component.ref}" does not define a default slot`,
                    range,
                  }),
                );
              } else if (!hasSlotContent(node)) {
                diagnostics.push(
                  diagnostic({
                    message: `Component "${component.ref}" does not define a default slot. Use <use ref="${component.ref}" />.`,
                    range,
                  }),
                );
              }
            }
          }
        } catch (error) {
          diagnostics.push(
            diagnostic({
              message: readableError(error),
              range: attributeValueRange({ attribute: ref, node, text }),
            }),
          );
        }
      }
    }

    for (const [tag, type] of sharedElements) {
      if (isHtmlElement(node, tag)) {
        const use = node.attrs?.find((attribute) => attribute.name === "use");

        if (use) {
          pending.push(checkShared({ attribute: use, node, type }));
        }
      }
    }

    const slot = node.attrs?.find((attribute) => attribute.name === "slot");

    if (!slot || !isHtmlElement(parent ?? {}, "use")) return;

    const parentRef = parent?.attrs?.find((attribute) => attribute.name === "ref");
    const component = parentRef ? componentMetadata.get(parentRef.value) : undefined;

    if (component && !component.slots.includes(slot.value)) {
      diagnostics.push(
        diagnostic({
          message: `Unknown slot "${slot.value}" in component "${component.name}"`,
          range: attributeValueRange({ attribute: slot, node, text }),
        }),
      );
    }
  });

  await Promise.all(pending);

  return diagnostics.sort(
    ({ range: left }, { range: right }) =>
      left.start.line - right.start.line || left.start.character - right.start.character,
  );
};
