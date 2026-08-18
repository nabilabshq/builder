import {
  createConnection,
  DidChangeWatchedFilesNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import { completionsFor, definitionFor, diagnosticsFor, documentLinksFor } from "./features.js";
import { createProjectManager } from "./project.js";

export const startLanguageServer = () => {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);
  let projects = createProjectManager();
  const publishDiagnostics = async (document) => {
    try {
      connection.sendDiagnostics({
        uri: document.uri,
        diagnostics: await diagnosticsFor({ projects, uri: document.uri, text: document.getText() }),
      });
    } catch (error) {
      console.error(`Nabi language server: ${error.message}`);
      connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    }
  };
  const refreshOpenDocuments = async () => Promise.all(documents.all().map(publishDiagnostics));

  connection.onInitialize((params) => {
    const workspaceFolders = (params.workspaceFolders ?? []).map((folder) => folder.uri);
    projects = createProjectManager({ workspaceFolders });
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ['"', "'", " ", "/"] },
        definitionProvider: true,
        documentLinkProvider: { resolveProvider: false },
      },
    };
  });

  connection.onInitialized(async () => {
    try {
      await connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [{ globPattern: "**/nabi.config.js" }, { globPattern: "**/src/**" }],
      });
    } catch (error) {
      console.error(`Nabi language server watcher registration failed: ${error.message}`);
    }
  });

  connection.onCompletion(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return completionsFor({ projects, uri: document.uri, text: document.getText(), position: params.position });
  });

  connection.onDefinition(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return definitionFor({ projects, uri: document.uri, text: document.getText(), position: params.position });
  });

  connection.onDocumentLinks(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return documentLinksFor({ projects, uri: document.uri, text: document.getText() });
  });

  connection.onDidChangeWatchedFiles(async () => {
    projects.invalidate();
    await refreshOpenDocuments();
  });

  documents.onDidOpen((event) => publishDiagnostics(event.document));
  documents.onDidChangeContent((event) => publishDiagnostics(event.document));
  documents.onDidSave((event) => publishDiagnostics(event.document));
  documents.onDidClose((event) => connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] }));
  documents.listen(connection);
  connection.listen();
};
