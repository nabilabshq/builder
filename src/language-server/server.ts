import {
  createConnection,
  DidChangeWatchedFilesNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import type { TextDocument as TextDocumentType } from "vscode-languageserver-textdocument";
import { TextDocument } from "vscode-languageserver-textdocument";

import { completionsFor } from "./features/completions";
import { definitionFor } from "./features/definitions";
import { diagnosticsFor } from "./features/diagnostics";
import { documentLinksFor } from "./features/document-links";
import { createProjectManager } from "./project";

const routeDataDependency = /\.(?:js|json)$/;

export const startLanguageServer = () => {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  let projects = createProjectManager();

  const publishDiagnostics = async (document: TextDocumentType) => {
    try {
      connection.sendDiagnostics({
        diagnostics: await diagnosticsFor({
          projects,
          text: document.getText(),
          uri: document.uri,
        }),
        uri: document.uri,
      });
    } catch (error) {
      console.error(`Nabi language server: ${error instanceof Error ? error.message : String(error)}`);

      connection.sendDiagnostics({
        diagnostics: [],
        uri: document.uri,
      });
    }
  };

  const refreshOpenDocuments = async () => Promise.all(documents.all().map(publishDiagnostics));

  connection.onInitialize((params) => {
    const workspaceFolders = (params.workspaceFolders ?? []).map((folder) => folder.uri);

    projects = createProjectManager({ workspaceFolders });

    return {
      capabilities: {
        completionProvider: { triggerCharacters: ['"', "'", " ", "/", "@", ":", "."] },
        definitionProvider: true,
        documentLinkProvider: { resolveProvider: false },
        textDocumentSync: TextDocumentSyncKind.Incremental,
      },
    };
  });

  connection.onInitialized(async () => {
    try {
      await connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [{ globPattern: "**/nabi.config.js" }, { globPattern: "**/src/**" }],
      });
    } catch (error) {
      console.error(
        `Nabi language server watcher registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  connection.onCompletion(async (params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) return [];

    return completionsFor({
      position: params.position,
      projects,
      text: document.getText(),
      uri: document.uri,
    });
  });

  connection.onDefinition(async (params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) return [];

    return definitionFor({
      position: params.position,
      projects,
      text: document.getText(),
      uri: document.uri,
    });
  });

  connection.onDocumentLinks(async (params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) return [];

    return documentLinksFor({ projects, text: document.getText(), uri: document.uri });
  });

  connection.onDidChangeWatchedFiles(async () => {
    projects.invalidate();
    await refreshOpenDocuments();
  });

  documents.onDidOpen((event) => publishDiagnostics(event.document));
  documents.onDidChangeContent((event) => publishDiagnostics(event.document));
  documents.onDidSave((event) => {
    if (routeDataDependency.test(event.document.uri)) {
      projects.invalidate();
    }

    return publishDiagnostics(event.document);
  });
  documents.onDidClose((event) => connection.sendDiagnostics({ diagnostics: [], uri: event.document.uri }));
  documents.listen(connection);

  connection.listen();
};
