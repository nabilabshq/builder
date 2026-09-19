import { minify as minifyMarkup } from "html-minifier-terser";
import { transform } from "lightningcss";
import { minify as minifyJavaScript } from "terser";

export const minifyCss = (css: string) =>
  transform({
    code: Buffer.from(css),
    filename: "nabi.css",
    minify: true,
  }).code.toString();

export const minifyHtml = (html: string) =>
  minifyMarkup(html, {
    collapseWhitespace: true,
    minifyCSS: false,
    minifyJS: false,
    removeAttributeQuotes: false,
    removeComments: true,
    removeOptionalTags: false,
    removeRedundantAttributes: false,
    useShortDoctype: true,
  });

export const minifyJs = async (javascript: string): Promise<string> => {
  const result = await minifyJavaScript(javascript, {
    compress: true,
    mangle: true,
  });

  if (!result.code) {
    throw new Error("JavaScript minifier produced no output.");
  }

  return result.code;
};
