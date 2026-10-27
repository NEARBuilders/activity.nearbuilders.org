import { once } from "node:events";
import { matchFilter } from "nostr-tools/filter";
import { finalizeEvent, generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { WebSocket, WebSocketServer } from "ws";
import type { NostrEvent, NostrFilter } from "../../src/nostr-core/types";

export function activityEvent(
  index: number,
  createdAt = Math.floor(Date.now() / 1_000),
): NostrEvent {
  return finalizeEvent(
    {
      kind: 1701,
      created_at: createdAt,
      tags: [
        ["s", "source"],
        ["t", "test.completed"],
        ["n", "alice.near"],
        ["i", `test:${index}`],
      ],
      content: JSON.stringify({ index }),
    },
    generateSecretKey(),
  );
}

type ClientMessage = ["EVENT", NostrEvent] | ["REQ", string, NostrFilter] | ["CLOSE", string];

export class TestRelay {
  readonly events = new Map<string, NostrEvent>();
  readonly requests: NostrFilter[] = [];
  readonly subscriptions = new Map<WebSocket, Map<string, NostrFilter>>();
  server!: WebSocketServer;
  port = 0;
  queryMode: "normal" | "close" | "stall" | "reject" = "normal";
  rejectPublish = false;

  get url() {
    return `ws://127.0.0.1:${this.port}`;
  }
  get subscriptionCount() {
    return [...this.subscriptions.values()].reduce((sum, subs) => sum + subs.size, 0);
  }

  async start() {
    this.server = new WebSocketServer({ host: "127.0.0.1", port: this.port });
    await once(this.server, "listening");
    const address = this.server.address();
    if (typeof address !== "object" || !address) throw new Error("Relay has no address");
    this.port = address.port;
    this.server.on("connection", (socket) => {
      const subscriptions = new Map<string, NostrFilter>();
      this.subscriptions.set(socket, subscriptions);
      socket.on("close", () => this.subscriptions.delete(socket));
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as ClientMessage;
        if (message[0] === "EVENT") {
          const event = message[1];
          const accepted = !this.rejectPublish && verifyEvent(event);
          socket.send(
            JSON.stringify(["OK", event.id, accepted, accepted ? "" : "blocked: publish rejected"]),
          );
          if (accepted) this.emit(event);
        } else if (message[0] === "REQ") {
          const [, id, filter] = message;
          subscriptions.set(id, filter);
          this.requests.push(filter);
          if (this.queryMode === "reject") {
            socket.send(
              JSON.stringify(["CLOSED", id, "auth-required: authenticate to this relay"]),
            );
            subscriptions.delete(id);
            return;
          }
          const history = [...this.events.values()]
            .filter((event) => matchFilter(filter, event))
            .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
            .slice(0, filter.limit ?? 1_000);
          for (const event of history) socket.send(JSON.stringify(["EVENT", id, event]));
          if (this.queryMode === "close") socket.terminate();
          else if (this.queryMode === "normal") socket.send(JSON.stringify(["EOSE", id]));
        } else subscriptions.delete(message[1]);
      });
    });
  }

  emit(event: NostrEvent) {
    this.events.set(event.id, event);
    for (const [socket, subscriptions] of this.subscriptions) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      for (const [id, filter] of subscriptions) {
        if (matchFilter(filter, event)) socket.send(JSON.stringify(["EVENT", id, event]));
      }
    }
  }

  async stop() {
    for (const socket of this.server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    this.subscriptions.clear();
  }
}
