# Nabi Builder

`@nabilabs/builder` is a deterministic static HTML builder for landing pages and multi-page websites. Components are resolved at build time, so the output contains plain HTML, CSS, JavaScript, and assets with no client runtime.

## Installation

```bash
bun add -d @nabilabs/builder
```

## Initialize a project

Create a small Nabi starter project in the current directory:

```bash
bunx -p @nabilabs/builder nabi init
```

Pass a directory to create the starter there:

```bash
bunx -p @nabilabs/builder nabi init my-site
```

The starter contains two pages, three shared components, shared CSS, and a shared JavaScript file. It also adds missing Nabi scripts to `package.json` without replacing existing scripts. When `package.json` is absent, Nabi runs `bun init -y` and installs `@nabilabs/builder` as a development dependency. The command is safe to run repeatedly and never overwrites existing starter files:

```text
src/
  pages/
    index.html
    project/
      index.html
  shared/
    components/
      button/
        index.html
        style.css
      head/
        index.html
      footer/
        index.html
        style.css
    styles/
      base.css
    js/
      site.js
```

The generated package scripts are:

```json
{
  "scripts": {
    "dev": "nabi dev",
    "build": "nabi build",
    "build:inline": "nabi build --mode inline"
  }
}
```

## Commands

```bash
bun run dev
bun run build
nabi init [directory]
nabi build --mode inline
nabi clean
```

## Project structure

```text
src/
  pages/
    index.html
    about/
      index.html
    components/             # Optional components local to this page directory
  shared/
    components/
      button/
        index.html
        style.css
        script.js
    styles/
      base.css
    js/
      site.js
    assets/
      img/
        logo.svg
nabi.config.js
```

Components in `pages/**/components` override components with the same ref from `shared/components` for pages in that directory. Shared components remain the fallback.

## File routing

Routes are generated directly from files:

| Source file                        | URL                | Output file                       |
| ---------------------------------- | ------------------ | --------------------------------- |
| `pages/index.html`                 | `/`                | `dist/index.html`                 |
| `pages/about.html`                 | `/about`           | `dist/about/index.html`           |
| `pages/rabota/index.html`          | `/rabota`          | `dist/rabota/index.html`          |
| `pages/rabota/students/index.html` | `/rabota/students` | `dist/rabota/students/index.html` |

Both `/about` and `/about/` resolve to the same page. Route collisions stop the build with a source-file error.

## Components

Use the HTML-only `<use>` DSL:

```html
<use ref="button" href="/rabota" variant="primary">Open jobs</use>
```

`ref` selects the component and is not forwarded to the output. Every other attribute becomes a component prop.

`shared/components/button/index.html`:

```html
---
variants: primary | secondary
---

<a class="button button--{{variant}}" href="{{href}}" {{...props}}>
  <slot></slot>
</a>
```

The frontmatter block is build metadata and is removed from the generated HTML. `{{...props}}` forwards attributes that are not consumed by `{{prop}}` placeholders.

Build output:

```html
<a class="button button--primary" href="/rabota">Open jobs</a>
```

Components can be nested. Missing refs, invalid refs, circular dependencies, and invalid slots stop the build with file and location details. HTML `<use>` is compiled; native SVG `<use href="#icon">` remains unchanged.

### Prop options

Component frontmatter can declare finite prop values for editor completion:

```html
---
variants: primary | secondary
size: compact | spacious
---

<a class="button button--{{variant}}" data-size="{{size}}"><slot></slot></a>
```

`variants` defines options for the `variant` prop. Any other key defines options for a prop with the same name. The Language Server suggests `primary` and `secondary` inside `variant=""`.

## Slots

Default content is rendered by `<slot></slot>`. Named content is rendered by `<slot name="..."></slot>`.

```html
<use ref="card" title="Pro plan">
  <p slot="header">Recommended</p>
  <p>Default card content.</p>
  <use ref="button" slot="footer" href="/students" variant="primary">Continue</use>
</use>
```

```html
<article class="card">
  <header>
    <slot name="header"></slot>
  </header>
  <h2>{{title}}</h2>
  <main>
    <slot></slot>
  </main>
  <footer>
    <slot name="footer"></slot>
  </footer>
</article>
```

Slot attributes are removed from the final HTML. Slots accept text, HTML, comments, and nested components. Fallback content is supported:

```html
<slot name="header"><h2>Default title</h2></slot>
```

Each component invocation has an isolated slot scope. Named slots must be direct children of the calling `<use>` element.

## Head components

A component whose root element is `<head>` contributes its content to the document head:

```html
<use ref="head"></use>
```

This is useful for shared metadata, fonts, and page-level resource declarations.

## CSS and JavaScript

Page resources are colocated with their page:

```text
pages/rabota/index.html
pages/rabota/style.css
pages/rabota/script.js
```

Regular page files use matching filenames instead:

```text
pages/about.html
pages/about.css
pages/about.js
```

Component resources are colocated with the component:

```text
shared/components/card/style.css
shared/components/card/script.js
```

Only resources used by a page are emitted for that page. CSS and JavaScript follow deterministic component resolution order.

## Shared CSS and JavaScript

Shared files are explicit dependencies, not global injections:

```html
<link use="base.css" />
<link use="core/normalize.css" media="screen" />

<script use="site.js" defer></script>
<script use="core/utm.js" type="module"></script>
```

Resolution:

```text
<link use="core/normalize.css">  → shared/styles/core/normalize.css
<script use="core/utm.js">       → shared/js/core/utm.js
```

The final HTML keeps ordinary URLs and all other attributes:

```html
<link rel="stylesheet" media="screen" href="/styles/core/normalize.css" />
<script defer src="/js/site.js"></script>
```

Only declared shared files are copied. `use` cannot be combined with `href` on `<link>` or `src` on `<script>`.

## Assets

Place binary assets in `shared/assets` and reference them with `@assets`:

```html
<img src="@assets/img/logo.svg" alt="Nabi" />
```

Assets are copied to `dist/assets` without transformation. A CDN base URL is optional:

```js
export default {
  assets: {
    mode: "copy",
    baseUrl: "https://cdn.example.com/site-assets",
  },
};
```

## Base route and links

Mount a project below a path:

```js
export default {
  baseRoute: "/partner/rabota",
};
```

Then `pages/students/index.html` serves at `/partner/rabota/students`. Internal root-relative links are rewritten automatically:

```html
<a href="/">Home</a>
<a href="/students">Students</a>
```

```html
<a href="/partner/rabota">Home</a>
<a href="/partner/rabota/students">Students</a>
```

Relative links resolve from the current page route. External URLs, hashes, `mailto:`, `tel:`, and CDN URLs are unchanged.

## Development server

```bash
nabi dev --port 2111
```

The development server uses the same routing, component, and dependency pipeline as the production build. It watches `src`, serves unminified output, and injects live reload. CSS updates use an atomic stylesheet swap; HTML and JavaScript updates reload the page.

## Build modes

`split` is the default mode. It writes page HTML and generated `style.css` and `script.js` files.

```bash
nabi build
```

`inline` embeds page and component CSS and JavaScript into HTML. Explicit shared dependencies remain external URLs.

```bash
nabi build --mode inline
```

## Configuration

All fields are optional:

```js
export default {
  pagesDir: "src/pages",
  sharedDir: "src/shared",
  outDir: "dist",
  baseRoute: "",
  defaultBuildMode: "split",
  dev: {
    port: 2111,
    open: false,
  },
  assets: {
    mode: "copy",
    baseUrl: "",
  },
  minify: {
    html: false,
    css: true,
    js: false,
  },
  images: {
    optimize: false,
  },
};
```

`nabi build` minifies CSS by default. Set `minify.html` or `minify.js` to `true` when needed. Development output remains readable.

## Language Server

`@nabilabs/builder` includes a standard Language Server Protocol server:

```bash
nabi-language-server --stdio
```

It provides completion for component refs, props, prop values, named slots, shared CSS, and shared JavaScript. It also provides definitions and diagnostics using the same project rules as `nabi build`.

For VS Code, install the Nabi extension. It finds the nearest local `@nabilabs/builder` package and starts its matching Language Server automatically.

## JavaScript quality checks

```bash
bun run lint
bun run format:check
bun run check
bun run pack:check
```

`bun run check` runs ESLint, Prettier validation, and the complete test suite. `bun run pack:check` verifies the npm package contents. The same quality check runs automatically before publishing.

## Public API

```js
import { build, clean, compilePage, discoverPages, init, loadConfig, startDev } from "@nabilabs/builder";

await build({ mode: "split" });
```

## Limits

Nabi intentionally has no client component runtime, hydration, JSX, template expressions, loops, implicit JavaScript execution, SCSS/PostCSS pipeline, filename hashing, or automatic image optimization.
