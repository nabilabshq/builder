import { minify as minifyMarkup } from "html-minifier-terser";
import { transform } from "lightningcss";
import { minify as minifyJavaScript } from "terser";

export const minifyCss = (css) =>
  transform({
    filename: "nabi.css",
    code: Buffer.from(css),
    minify: true,
  }).code.toString("utf8");

export const minifyHtml = (html) =>
  minifyMarkup(html, {
    collapseWhitespace: "conservative",
    removeComments: true,
    removeOptionalTags: false,
    removeAttributeQuotes: false,
    removeRedundantAttributes: false,
    minifyCSS: false,
    minifyJS: false,
    useShortDoctype: true,
  });

export const minifyJs = async (javascript) => {
  const result = await minifyJavaScript(javascript, { compress: true, mangle: true });
  if (!result.code) throw new Error("JavaScript minifier produced no output.");
  return result.code;
};
