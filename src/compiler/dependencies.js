import { extname, posix, relative } from "node:path";

import * as parse5 from "parse5";

import { NabiError } from "../utils/errors.js";
import { fileExists } from "../utils/files.js";
import { resolveWithin } from "../utils/paths.js";

const findElement = (node, tagName) => {
  if (node.tagName === tagName) return node;
  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);
    if (found) return found;
  }
};

const element = (tagName, attrs = [], childNodes = []) => ({
  nodeName: tagName,
  tagName,
  attrs,
  namespaceURI: "http://www.w3.org/1999/xhtml",
  childNodes,
});

export const injectGeneratedResources = ({ html, css = [], js = [], inline = false }) => {
  const document = parse5.parse(html);
  const rawBlocks = [];
  const rawBlock = (value) => {
    let marker = `__NABI_GENERATED_${rawBlocks.length}__`;
    while (html.includes(marker)) marker = `_${marker}_`;
    rawBlocks.push({ marker, value });
    return marker;
  };
  const head = findElement(document, "head");
  const body = findElement(document, "body");
  if (head && css.length) {
    head.childNodes.push(
      ...(inline
        ? css.map((value) =>
            element("style", [], [{ nodeName: "#text", value: rawBlock(value.replace(/<\/style/gi, "<\\/style")) }]),
          )
        : css.map((path) =>
            element("link", [
              { name: "rel", value: "stylesheet" },
              { name: "href", value: path },
            ]),
          )),
    );
  }
  if (body && js.length) {
    body.childNodes.push(
      ...(inline
        ? js.map((value) =>
            element("script", [], [{ nodeName: "#text", value: rawBlock(value.replace(/<\/script/gi, "<\\/script")) }]),
          )
        : js.map((path) => element("script", [{ name: "src", value: path }]))),
    );
  }
  return rawBlocks.reduce((output, { marker, value }) => output.replace(marker, value), parse5.serialize(document));
};

const assetValue = (value, config) =>
  value.replace(/@assets\/([^\s,]+)/g, (_, path) => {
    resolveWithin(config.assetsPath, path, "Asset");
    const clean = path.replaceAll("\\", "/");
    const outputPath = [config.baseRoute, "assets", clean].filter(Boolean).join("/");
    return config.assets.baseUrl ? `${config.assets.baseUrl.replace(/\/$/, "")}/${clean}` : `/${outputPath}`;
  });

export const rewriteAssetReferences = ({ html, config }) => {
  const document = parse5.parse(html);
  const visit = (node) => {
    for (const attribute of node.attrs ?? []) {
      if (attribute.value.includes("@assets/")) attribute.value = assetValue(attribute.value, config);
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  return parse5.serialize(document);
};

const isExternalReference = (value) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);
const splitReference = (value) => {
  const match = value.match(/^([^?#]*)([?#][\s\S]*)?$/);
  return { path: match?.[1] ?? value, suffix: match?.[2] ?? "" };
};

const internalLink = ({ value, config, pageRoute }) => {
  if (!value || isExternalReference(value)) return value;
  const { path, suffix } = splitReference(value);
  if (!path || (!path.startsWith("/") && !path.startsWith("./") && !path.startsWith("../"))) return value;
  const baseRoute = config.baseRoute;
  if (path.startsWith("/")) {
    const target = path.replace(/^\/+|\/+$/g, "");
    if (!baseRoute || target === baseRoute || target.startsWith(`${baseRoute}/`)) return `/${target}${suffix}`;
    return `/${[baseRoute, target].filter(Boolean).join("/")}${suffix}`;
  }
  const localPageRoute =
    baseRoute && pageRoute.startsWith(baseRoute) ? pageRoute.slice(baseRoute.length).replace(/^\/+/, "") : pageRoute;
  const target = posix.normalize(`/${localPageRoute}/${path}`).replace(/^\/+|\/+$/g, "");
  return `/${[baseRoute, target].filter(Boolean).join("/")}${suffix}`;
};

export const rewriteInternalLinks = ({ html, config, pageRoute }) => {
  const document = parse5.parse(html);
  const visit = (node) => {
    if (node.tagName === "a") {
      const href = node.attrs?.find((attribute) => attribute.name === "href");
      if (href) href.value = internalLink({ value: href.value, config, pageRoute });
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  return parse5.serialize(document);
};

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const sharedPath = ({ root, value, label }) => {
  if (!value || value.includes("\\") || value.split("/").some((segment) => !segment || [".", ".."].includes(segment)))
    throw new NabiError(`Invalid shared ${label} path: "${value}"`);
  return resolveWithin(root, value, `Shared ${label}`);
};

const referenceUrl = ({ config, directory, value }) =>
  `/${[config.baseRoute, directory, value].filter(Boolean).join("/")}`;
const attribute = (node, name) => node.attrs?.find((item) => item.name === name);
const removeAttribute = (node, name) => {
  const index = node.attrs?.findIndex((item) => item.name === name) ?? -1;
  if (index >= 0) node.attrs.splice(index, 1);
};
const addAttribute = (node, name, value) => node.attrs.push({ name, value });
const expectedPath = ({ config, path }) => relative(config.cwd, path).replaceAll("\\", "/");

const resolveSharedFile = async ({ config, value, root, extension, label, page }) => {
  if (extname(value).toLowerCase() !== extension)
    throw new NabiError(`Invalid shared ${label} type: "${value}"\n\nUsed in:\n${page}`);
  const path = sharedPath({ root, value, label });
  if (!(await fileExists(path)))
    throw new NabiError(
      `Shared ${label} not found: "${value}"\n\nUsed in:\n${page}\n\nExpected:\n${expectedPath({ config, path })}`,
    );
  return path;
};

export const resolveSharedDependency = async ({ config, value, type, page }) => {
  const definition = {
    script: { root: config.sharedJsPath, extension: ".js", label: "script" },
    stylesheet: { root: config.sharedStylesPath, extension: ".css", label: "stylesheet" },
  }[type];
  if (!definition) throw new NabiError(`Unknown shared dependency type: ${type}`);
  return resolveSharedFile({ config, value, page, ...definition });
};

export const resolveSharedDependencies = async ({ html, config, page }) => {
  const document = parse5.parse(html);
  const dependencies = { styles: [], scripts: [] };
  const visit = async (node) => {
    if (node.namespaceURI === htmlNamespace && node.tagName === "script") {
      const use = attribute(node, "use");
      if (use) {
        if (attribute(node, "src"))
          throw new NabiError(`Invalid <script>: "use" cannot be combined with "src"\n\nUsed in:\n${page}`);
        const path = await resolveSharedDependency({ config, value: use.value, type: "script", page });
        dependencies.scripts.push(path);
        removeAttribute(node, "use");
        addAttribute(node, "src", referenceUrl({ config, directory: "js", value: use.value }));
      }
    }
    if (node.namespaceURI === htmlNamespace && node.tagName === "link") {
      const use = attribute(node, "use");
      if (use) {
        if (attribute(node, "href"))
          throw new NabiError(`Invalid <link>: "use" cannot be combined with "href"\n\nUsed in:\n${page}`);
        const path = await resolveSharedDependency({ config, value: use.value, type: "stylesheet", page });
        dependencies.styles.push(path);
        removeAttribute(node, "use");
        if (!attribute(node, "rel")) addAttribute(node, "rel", "stylesheet");
        addAttribute(node, "href", referenceUrl({ config, directory: "styles", value: use.value }));
      }
    }
    for (const child of node.childNodes ?? []) await visit(child);
  };
  await visit(document);
  return { html: parse5.serialize(document), dependencies };
};
