import { posix } from "node:path";

import type { NabiConfig } from "@/types";
import type { HtmlNode } from "@/utils/html";
import { parseDocument, serializeHtml } from "@/utils/html";
import { resolveWithin } from "@/utils/paths";

type RewriteAssetReferencesProps = { config: NabiConfig; html: string };
type RewriteInternalLinksProps = {
  config: NabiConfig;
  html: string;
  pageRoute: string;
};
type InternalLinkProps = {
  config: NabiConfig;
  pageRoute: string;
  value: string;
};

const assetValue = (value: string, config: NabiConfig) =>
  value.replace(/@assets\/([^\s,]+)/g, (_match, path: string) => {
    resolveWithin(config.assetsPath, path, "Asset");

    const clean = path.replaceAll("\\", "/");
    const outputPath = [config.baseRoute, "assets", clean].filter(Boolean).join("/");

    return config.assets.baseUrl ? `${config.assets.baseUrl.replace(/\/$/, "")}/${clean}` : `/${outputPath}`;
  });

export const rewriteAssetReferences = ({ config, html }: RewriteAssetReferencesProps) => {
  const document = parseDocument(html);

  const visit = (node: HtmlNode) => {
    for (const attribute of node.attrs ?? []) {
      if (attribute.value.includes("@assets/")) {
        attribute.value = assetValue(attribute.value, config);
      }
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };

  visit(document);

  return serializeHtml(document);
};

const isExternalReference = (value: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);
const splitReference = (value: string) => {
  const match = value.match(/^([^?#]*)([?#][\s\S]*)?$/);

  return {
    path: match?.[1] ?? value,
    suffix: match?.[2] ?? "",
  };
};

const internalLink = ({ config, pageRoute, value }: InternalLinkProps) => {
  if (!value || isExternalReference(value)) return value;

  const { path, suffix } = splitReference(value);

  if (!path || (!path.startsWith("/") && !path.startsWith("./") && !path.startsWith("../"))) {
    return value;
  }

  const baseRoute = config.baseRoute;

  if (path.startsWith("/")) {
    const target = path.replace(/^\/+|\/+$/g, "");

    if (!baseRoute || target === baseRoute || target.startsWith(`${baseRoute}/`)) {
      return `/${target}${suffix}`;
    }

    return `/${[baseRoute, target].filter(Boolean).join("/")}${suffix}`;
  }

  const localPageRoute =
    baseRoute && (pageRoute === baseRoute || pageRoute.startsWith(`${baseRoute}/`))
      ? pageRoute.slice(baseRoute.length).replace(/^\/+/, "")
      : pageRoute;

  const target = posix.normalize(`/${localPageRoute}/${path}`).replace(/^\/+|\/+$/g, "");

  return `/${[baseRoute, target].filter(Boolean).join("/")}${suffix}`;
};

export const rewriteInternalLinks = ({ config, html, pageRoute }: RewriteInternalLinksProps) => {
  const document = parseDocument(html);

  const visit = (node: HtmlNode) => {
    if (node.tagName === "a") {
      const href = node.attrs?.find((attribute) => attribute.name === "href");

      if (href) {
        href.value = internalLink({
          config,
          pageRoute,
          value: href.value,
        });
      }
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };

  visit(document);

  return serializeHtml(document);
};
