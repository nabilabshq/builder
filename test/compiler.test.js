import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { compilePage } from "../src/compiler/page.js";
import { createHybridComponentRegistry } from "../src/compiler/registry.js";

const fixture = async (files) => {
  const root = await mkdtemp(join(tmpdir(), "nabi-test-"));
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const fullPath = join(root, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }),
  );
  return root;
};

const compile = async (components, source) => {
  const files = Object.fromEntries(
    Object.entries(components).map(([ref, template]) => [`shared/components/${ref}/index.html`, template]),
  );
  const root = await fixture(files);
  try {
    return await compilePage({
      source,
      page: "src/index.html",
      registry: await createHybridComponentRegistry({
        localComponentsPath: join(root, "pages/components"),
        sharedComponentsPath: join(root, "shared/components"),
      }),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("expands use refs, props, HTML children, and nested components", async () => {
  const html = await compile(
    {
      button: '<button class="button button--{{variant}}" type="{{type}}" {{...props}}><slot /></button>',
      card: '<article><use ref="button" variant="primary" type="button"><slot /></use><!-- preserved --></article>',
    },
    '<!doctype html><html><body><use ref="card"><strong data-id="15">Hello</strong></use></body></html>',
  );
  assert.match(
    html,
    /<button class="button button--primary" type="button"><strong data-id="15">Hello<\/strong><\/button>/,
  );
  assert.match(html, /<!-- preserved -->/);
});

test("supports boolean, data, aria, empty props, and omits ref from forwarded attributes", async () => {
  const html = await compile(
    {
      button:
        '<button disabled="{{disabled}}" data-state="{{data-state}}" aria-label="{{aria-label}}" {{...props}}><slot /></button>',
    },
    '<html><body><use ref="button" disabled data-state="ready" aria-label="Continue" title=""></use></body></html>',
  );
  assert.match(html, /disabled="true" data-state="ready" aria-label="Continue" title=""><\/button>/);
  assert.doesNotMatch(html, /ref=/);
});

test("supports named slots", async () => {
  const html = await compile(
    { card: '<article><header><slot name="header"></slot></header><div><slot /></div></article>' },
    '<html><body><use ref="card"><h2 slot="header">Title</h2><p>Body</p></use></body></html>',
  );
  assert.match(html, /<header><h2>Title<\/h2><\/header><div><p>Body<\/p><\/div>/);
});

test("projects multiple named slots, text nodes, and nested components without slot attributes", async () => {
  const html = await compile(
    {
      card: '<section class="card" data-variant="{{variant}}"><header><slot name="header"></slot></header><main><slot></slot></main><footer><slot name="footer"></slot></footer></section>',
      button: '<button data-variant="{{variant}}"><slot /></button>',
    },
    '<html><body><use ref="card" variant="outlined">Hello <h3 slot="header">Pro plan</h3><p>For growing teams.</p><use ref="button" variant="primary" slot="footer">Upgrade</use><span slot="footer">Later</span></use></body></html>',
  );
  assert.match(
    html,
    /<section class="card" data-variant="outlined"><header><h3>Pro plan<\/h3><\/header><main>Hello <p>For growing teams.<\/p><\/main><footer><button data-variant="primary">Upgrade<\/button><span>Later<\/span><\/footer><\/section>/,
  );
  assert.doesNotMatch(html, / slot=/);
  assert.doesNotMatch(html, /<use ref=|<slot/);
});

test("uses fallback slot content and keeps invocation slot scopes isolated", async () => {
  const html = await compile(
    {
      card: '<section><header><slot name="header"><h3>Fallback</h3></slot></header><main><slot>Default body</slot></main></section>',
    },
    '<html><body><use ref="card"><h3 slot="header">First</h3></use><use ref="card"><p>Second body</p></use><use ref="card"></use></body></html>',
  );
  assert.match(html, /<section><header><h3>First<\/h3><\/header><main>Default body<\/main><\/section>/);
  assert.match(html, /<section><header><h3>Fallback<\/h3><\/header><main><p>Second body<\/p><\/main><\/section>/);
  assert.match(html, /<section><header><h3>Fallback<\/h3><\/header><main>Default body<\/main><\/section>/);
});

test("rejects unknown slots and default content without a default slot", async () => {
  await assert.rejects(
    () =>
      compile(
        { card: '<section><slot name="footer"></slot></section>' },
        '<html><body><use ref="card"><p slot="header">Title</p></use></body></html>',
      ),
    /Unknown slot "header" in component "card"[\s\S]*Available slots:\n- footer/,
  );
  await assert.rejects(
    () => compile({ icon: "<svg></svg>" }, '<html><body><use ref="icon">Save</use></body></html>'),
    /Component "icon" does not define a default slot/,
  );
});

test("rejects missing refs, unknown components, circular refs, and path traversal", async () => {
  await assert.rejects(
    () => compile({}, "<html><body><use></use></body></html>"),
    /Invalid component invocation: required attribute "ref" is missing/,
  );
  await assert.rejects(
    () => compile({}, '<html><body><use ref="unknown"></use></body></html>'),
    /Component not found: "unknown"/,
  );
  await assert.rejects(
    () =>
      compile({ a: '<use ref="b"></use>', b: '<use ref="a"></use>' }, '<html><body><use ref="a"></use></body></html>'),
    /Circular component dependency:\n\na → b → a/,
  );
  await assert.rejects(
    () => compile({}, '<html><body><use ref="../../secret"></use></body></html>'),
    /Invalid component ref: "\.\.\/\.\.\/secret"/,
  );
});

test("leaves SVG use elements untouched while expanding HTML use elements", async () => {
  const html = await compile(
    { button: "<button><slot /></button>" },
    '<html><body><use ref="button">Continue</use><svg><symbol id="arrow"><path d="M0 0"></path></symbol><use href="#arrow"></use></svg></body></html>',
  );
  assert.match(html, /<button>Continue<\/button>/);
  assert.match(html, /<svg><symbol id="arrow"><path d="M0 0"><\/path><\/symbol><use href="#arrow"><\/use><\/svg>/);
});

test("inserts head templates into the document head", async () => {
  const html = await compile(
    {
      head: '<head><meta name="theme-color" content="{{theme-color}}"><title>{{title}}</title><slot /></head>',
    },
    '<!doctype html><html lang="ru"><use ref="head" theme-color="#fff" title="Nabi"></use><body><h1>Page</h1></body></html>',
  );
  assert.match(html, /<head><meta name="theme-color" content="#fff"><title>Nabi<\/title><\/head>/);
  assert.doesNotMatch(html, /<body><meta|<body><title/);
});
