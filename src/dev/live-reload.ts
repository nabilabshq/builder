import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

const liveReloadClient = `<script data-nabi-live-reload>(function () {
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__nabi_live_reload');
  const refreshStyles = () => {
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const url = new URL(link.href, location.href);
      url.searchParams.set('nabi', Date.now());
      const replacement = link.cloneNode();
      replacement.href = url.href;
      replacement.addEventListener('load', () => link.remove(), { once: true });
      replacement.addEventListener('error', () => replacement.remove(), { once: true });
      link.after(replacement);
    });
  };
  socket.addEventListener('message', event => {
    if (event.data !== 'css') return location.reload();
    refreshStyles();
  });
}());</script>`;

export const injectReloadClient = (html: string) => {
  if (html.includes("data-nabi-live-reload")) return html;

  return html.replace(/<\/body\s*>/i, `${liveReloadClient}</body>`);
};

export const createLiveReload = (server: Server) => {
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/__nabi_live_reload") {
      return socket.destroy();
    }

    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client, request));
  });

  return {
    broadcast: (message: "css" | "reload") => {
      for (const client of sockets.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    },
    close: () => {
      for (const client of sockets.clients) {
        client.close();
      }
    },
  };
};
