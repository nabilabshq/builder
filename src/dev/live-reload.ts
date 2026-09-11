import type { IncomingMessage, Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

type CreateLiveReloadProps = {
  onRouteActive: (route: string) => void;
  onRouteInactive: (route: string) => void;
  server: Server;
};

const liveReloadClient = `<script data-nabi-live-reload>(function () {
  let connected = false;
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
  const connect = () => {
    const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__nabi_live_reload');
    socket.addEventListener('open', () => {
      if (connected) return location.reload();
      connected = true;
      socket.send(location.pathname);
    });
    socket.addEventListener('message', event => {
      if (event.data !== 'css') return location.reload();
      refreshStyles();
    });
    socket.addEventListener('close', () => setTimeout(connect, 250));
    socket.addEventListener('error', () => socket.close());
  };
  connect();
}());</script>`;

export const injectReloadClient = (html: string) => {
  if (html.includes("data-nabi-live-reload")) return html;

  return html.replace(/<\/body\s*>/i, `${liveReloadClient}</body>`);
};

const routeMessage = (request: IncomingMessage, value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("/")) return;

  try {
    return new URL(value, `http://${request.headers.host ?? "localhost"}`).pathname;
  } catch {
    return;
  }
};

export const createLiveReload = ({ onRouteActive, onRouteInactive, server }: CreateLiveReloadProps) => {
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/__nabi_live_reload") {
      return socket.destroy();
    }

    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client, request));
  });

  sockets.on("connection", (client, request) => {
    let route: string | undefined;

    client.on("message", (value) => {
      const nextRoute = routeMessage(request, value.toString());

      if (!nextRoute || nextRoute === route) return;

      if (route) {
        onRouteInactive(route);
      }

      route = nextRoute;
      onRouteActive(route);
    });

    client.once("close", () => {
      if (route) onRouteInactive(route);
    });
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
