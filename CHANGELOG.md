# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-19

### Added

- Added namespaced global component refs such as ui/button and page-local refs such as @button.
- Added page-local component discovery, nearest-scope resolution, privacy diagnostics, and editor support for local components.
- Added the body build mode for wrapper-free HTML fragments.
- Added CSS Modules through module.css and *.module.css files, with scoped class names rewritten in page and component HTML.
- Added dynamic routes using bracketed segments, local route records, external JSON data sources, route hooks, and @when conditions.
- Added {{:segment.property}} interpolation for dynamic route data.
- Added configurable, nearest-match error pages and dynamic error-page output.
- Added dependency-aware incremental dev rebuilds, lazy rebuilding for inactive pages, event batching, and live-reload reconnection after server restarts.
- Added a development supervisor for linked Builder packages, local Git hooks, TypeScript declarations, and project editor settings.

### Changed

- Migrated the runtime, tests, ESLint configuration, and Prettier configuration from JavaScript to TypeScript.
- Reorganized build output, compiler, routing, dev-server, and Language Server code into focused typed modules.
- Switched tests to bun:test and package development tooling to Bun.
- Build output now has safer filesystem handling, direct source-asset serving in development, resource caching, and clearer CLI progress reporting.
- Extended Language Server completion, diagnostics, definitions, and document links for components and dynamic route data.
- Updated inline and body-mode output so shared resources are ordered and minified correctly.

### Removed

- Removed nabi init, the public init API, starter fixtures, and the bundled basic example. Project creation now belongs to a dedicated package.
- Removed bare global component refs. Global components must use a namespace.
- Removed the `routes` alias from the `build()` result. Use `pages` instead.
- Removed the `dev.open` configuration field.

### Migration

- Move a former global component from `src/shared/components/button/index.html` to a namespace such as
  `src/ui/button/index.html`, then change `<use ref="button" />` to `<use ref="ui/button" />`.
- Move a former page-local component from `src/pages/jobs/components/card/index.html` to
  `src/pages/jobs/@card/index.html`, then change `<use ref="card" />` to `<use ref="@card" />`.
- `sharedDir` must now remain inside `srcDir`. Move an external shared directory into `src` before upgrading.

### Fixed

- Prevented unsafe or overlapping project directories, dev-server path traversal, and unreliable Windows output replacement.
- Corrected body-mode paths for nested pages, base routes, copied assets, inline JSON scripts, and shared resources.

## [0.1.2] - 2026-08-16

### Added

- Added the `nabi init` CLI command for creating a Nabi starter project.
- Added a two-page starter with shared `button`, `head`, and `footer` components.
- Added starter shared CSS and JavaScript resources.
- Exported the `init` function from the public package API.
- Added `nabi init <directory>`, `nabi --help`, and command-specific CLI help.
- Added Bun project bootstrap, local builder installation, and package scripts to `nabi init`.
- Added a Husky pre-commit hook that runs the complete quality check.
- Added `bun run pack:check` for package-content validation.

### Changed

- Documented the project initialization workflow and public API in the README.
- Run the `node:test` suite through Node from `bun run check`.

## [0.1.1] - 2026-08-14

### Changed

- Updated repository URLs in package metadata.

## [0.1.0]

### Added

- Initial Nabi Builder release with static site builds, development server, component compilation, routing, and language-server support.
