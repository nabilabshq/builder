# Nabi Builder

@nabilabs/builder is a deterministic static HTML builder for landing pages and multi-page websites. Components are resolved during the build, so the output is plain HTML, CSS, JavaScript, and assets with no client component runtime.

## Create a project

```bash
bun create @nabilabs/builder my-site
cd my-site
bun run dev
```

This command runs the dedicated @nabilabs/create-builder package and creates a ready-to-use Nabi project.

## Migrate from 0.1

Version 0.2 removes `nabi init`; create new projects with `bun create @nabilabs/builder` instead.

Global component refs must now be namespaced. Move each old component and update its ref:

```text
src/shared/components/button/index.html -> src/ui/button/index.html
<use ref="button" />                    -> <use ref="ui/button" />
```

Page-local components now use `@` directories and refs:

```text
src/pages/jobs/components/card/index.html -> src/pages/jobs/@card/index.html
<use ref="card" />                       -> <use ref="@card" />
```

The `build()` result no longer includes `routes`; use `pages`. The `dev.open` option was removed, and `sharedDir`
must remain inside `srcDir`.

## Add Builder to an existing project

```bash
bun add -d @nabilabs/builder
```

Add the project commands to package.json:

```json
{
  "scripts": {
    "build": "nabi build",
    "dev": "nabi dev"
  }
}
```

## Commands

```bash
nabi build [--mode split|inline|body]
nabi dev [--port <port>]
nabi clean
```

The build command defaults to split mode. The dev server starts on port 2111 unless a port is configured or passed with --port.

## Project structure

```text
src/
  data/
    posts.json
  pages/
    index.html
    about/
      index.html
    blog/
      [post]/
        _route.json
        index.html
        404.html
      @card/
        index.html
  ui/
    button/
      index.html
      style.css
  modules/
    hero/
      index.html
  shared/
    assets/
      img/
        logo.svg
    js/
      site.js
    styles/
      base.css
nabi.config.js
```

Pages are stored in src/pages. Global components can live in any other top-level namespace under src, except shared and pages. Shared styles, scripts, and assets are opt-in resources.

## Components

Use the HTML-only use element:

```html
<use ref="ui/button" variant="primary" size="fill" href="/jobs">Open jobs</use>
```

Global component refs are namespaced. The source file src/ui/button/index.html is referenced as ui/button. A component can also be a file, for example src/modules/hero.html becomes modules/hero.

```html
---
variant: primary | filled
size: hug | fill
---

<button class="button {{class}}" data-variant="{{variant}}" data-size="{{size}}" {{...props}}>
  <slot />
</button>
```

The frontmatter declares optional prop values for editor completion. The variants key declares values for variant; every other key declares values for a prop with the same name. The ref attribute is not emitted. Other attributes become props, and {{...props}} forwards attributes that were not consumed by a placeholder.

Components support default and named slots:

```html
<use ref="ui/card" title="Pro">
  <p slot="header">Recommended</p>
  <p>Default content</p>
</use>
```

```html
<article>
  <header>
    <slot name="header" />
  </header>
  <h2>{{title}}</h2>
  <main>
    <slot />
  </main>
</article>
```

Use self-closing syntax when no content is projected:

```html
<use ref="ui/button" href="/jobs" />
```

Components whose root element is head contribute their contents to the page head.

### Local components

A directory beginning with @ inside pages defines components local to that page subtree. The nearest matching component wins:

```text
src/pages/
  @header/index.html              -> @header
  partners/
    @header/index.html            -> @header for partners pages
    index.html
```

```html
<use ref="@header" />
```

Local components are private to their owner directory and its descendants. Use a global namespaced component when it must be available outside that subtree.

## CSS and JavaScript resources

Page resources are colocated with a page:

```text
pages/jobs/index.html
pages/jobs/style.css
pages/jobs/script.js

pages/about.html
pages/about.css
pages/about.js
```

Component resources follow the same convention:

```text
ui/card/index.html
ui/card/style.css
ui/card/script.js
```

Only resources for components used by a page are emitted. Their order follows component resolution.

### CSS Modules

Put module.css or a file ending in .module.css next to a page or component:

```text
pages/jobs/index.html
pages/jobs/module.css
ui/card/index.html
ui/card/card.module.css
```

Class names declared in those files are automatically scoped and rewritten in the corresponding page or component HTML. Module CSS is emitted only for pages that use it.

## Shared resources

Shared files are explicit dependencies rather than global injections:

```html
<link use="base.css" />
<link use="core/normalize.css" media="screen" />

<script use="site.js" defer></script>
<script use="core/utm.js" type="module"></script>
```

They resolve relative to src/shared/styles and src/shared/js:

```text
shared/styles/core/normalize.css
shared/js/core/utm.js
```

The build preserves other attributes and writes normal resource URLs in split mode. The use attribute cannot be combined with href on link or src on script.

## Assets

Place binary assets in src/shared/assets and reference them with @assets:

```html
<img src="@assets/img/logo.svg" alt="Nabi" />
```

Assets are copied to dist/assets. A CDN base URL is optional:

```js
export default {
  assets: {
    baseUrl: "https://cdn.example.com/site-assets",
    mode: "copy",
  },
};
```

## Static routes

Routes are generated from page files:

| Source file                    | URL            | Output file                   |
| ------------------------------ | -------------- | ----------------------------- |
| pages/index.html               | /              | dist/index.html               |
| pages/about.html               | /about         | dist/about/index.html         |
| pages/jobs/index.html          | /jobs          | dist/jobs/index.html          |
| pages/jobs/students/index.html | /jobs/students | dist/jobs/students/index.html |

Both /about and /about/ resolve to the same page. A route collision stops the build and identifies every source that generated it.

### Base route

Mount the project below a path:

```js
export default {
  baseRoute: "/partner/jobs",
};
```

Root-relative internal links are rewritten automatically:

```html
<nav>
  <a href="/">Home</a>
  <a href="/students">Students</a>
</nav>
```

With the configuration above, the generated URLs become /partner/jobs and /partner/jobs/students. Relative links
such as ./students and ../ resolve from the current route. External URLs, hashes, mailto, tel, and CDN URLs are
unchanged.

## Dynamic routes

Use a bracketed directory or filename segment for a dynamic route. Every dynamic segment needs a JSON route file named _route.json by default.

```text
src/
  data/
    cities.json
  pages/
    jobs/
      [city]/
        _route.json
        index.html
```

```json
{
  "@data": "cities.json",
  "remote": {
    "name": "Remote"
  }
}
```

```json
{
  "almaty": {
    "name": "Almaty",
    "seo": {
      "title": "Jobs in Almaty"
    }
  },
  "astana": {
    "name": "Astana"
  }
}
```

The route file above generates /jobs/almaty, /jobs/astana, and /jobs/remote. Local records supplement or override records loaded through @data. A route file can also be a simple array of slugs.

Use route data in an HTML page or component attribute with {{:segment.property}}:

```html
<h1>{{:city.name}}</h1>
<meta property="og:title" content="{{:city.seo.title}}" />
```

### Route data and component props

The colon selects a dynamic route value. Use `{{:...}}` in a page when passing route data to a component:

```html
<use ref="ui/features" active="{{:page.features.combo}}"> Combo meals </use>
```

Inside the component, omit the colon. `{{active}}` is the component prop received from the use element:

```html
<article data-active="{{active}}">
  <slot />
</article>
```

For nested dynamic segments, use @when to limit a record to parent values:

```json
{
  "students": {
    "@when": {
      "city": ["almaty", "astana"]
    }
  }
}
```

An optional _route.js beside the JSON file may export a default function. It receives route and, when present, props. Return an object to merge more page data or null to omit that route.

```js
export default ({ props, route }) => {
  if (!props?.enabled) return null;

  return {
    title: props.title ?? route.city,
  };
};
```

The Language Server provides completion, diagnostics, document links, and route-data suggestions for dynamic routes.

## Conditional content

`<if>` keeps one branch at build time and removes the directive from the output. Its required `when` attribute must resolve to `true` or `false`; an empty or missing route value also selects the false branch. An optional `<else>` supplies that branch.

```html
<if when="{{:page.features.combo}}">
  <article id="feature-combo">Combo meals</article>
  <else>
    <article id="feature-default">Available benefits</article>
  </else>
</if>
```

To use route data inside a component, pass it as a prop from the page:

```html
<use ref="ui/features" active="{{:page.features.combo}}" />
```

src/ui/features/index.html:

```html
<if when="{{active}}">
  <article>Combo meals</article>
</if>
```

The selected branch is compiled before its components and resources are resolved. The Language Server suggests route paths in `when="{{:...}}"` and reports paths that are not present in route data.

## Error pages

Place a file named 404.html in pages or in a nested page directory:

```text
pages/
  404.html
  jobs/
    404.html
```

The build emits error pages without registering them as ordinary routes. The dev server selects the closest applicable error page for a missing request. Dynamic error pages receive the same route data as the matching dynamic page.

Configure another file name when needed:

```js
export default {
  errorPageFileName: "missing",
};
```

## Build modes

Split is the default mode. It writes complete page HTML plus generated style.css and script.js files, copied shared dependencies, assets, and manifest.json.

```bash
nabi build
```

Inline embeds page, component, and declared shared styles and scripts in a complete HTML document.

```bash
nabi build --mode inline
```

Body emits a wrapper-free HTML fragment. It inlines styles, retains JSON script elements in the fragment, and writes executable scripts as separate files.

```bash
nabi build --mode body
```

Set defaultBuildMode to select a mode without passing --mode.

## Development server

```bash
nabi dev --port 2111
```

The dev server uses the production routing and component pipeline, serves assets directly from source, and injects live reload. CSS changes swap stylesheets without a full reload. It tracks source dependencies, rebuilds active affected pages eagerly, and rebuilds inactive pages when requested. It remains available after an initial build error and recovers when the source is corrected.

When developing a linked Builder checkout, run bun run dev. It rebuilds dist after source changes and restarts the supervised Nabi dev worker.

## Configuration

All configuration fields are optional:

```js
export default {
  assets: {
    baseUrl: "",
    mode: "copy",
  },
  baseRoute: "",
  dataDir: "data",
  defaultBuildMode: "split",
  dev: {
    port: 2111,
  },
  errorPageFileName: "404",
  images: {
    optimize: false,
  },
  minify: {
    css: true,
    html: false,
    js: false,
  },
  outDir: "dist",
  pagesDir: "pages",
  routeFileName: "_route",
  sharedDir: "shared",
  srcDir: "src",
};
```

All configured directory paths must stay within the project. Source and output directories cannot overlap.

## Language Server

@nabilabs/builder includes a standard Language Server Protocol server:

```bash
nabi-language-server --stdio
```

It provides completion, definitions, diagnostics, document links, component prop values, named slots, shared resources, and dynamic-route metadata. The Nabi VS Code extension finds the nearest local Builder package and starts its matching server.

## Limits

Nabi intentionally has no client component runtime, hydration, JSX, template expressions, loops, implicit JavaScript execution in templates, SCSS or PostCSS pipeline, filename hashing, or automatic image optimization.
