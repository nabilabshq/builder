# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
