import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";

// Start the relay server as a subprocess and test it with real WebSocket connections.

let relayProcess: Subprocess;
const PORT = 3056; // Use a different port to avoid conflicts with a running relay
const BUN = process.execPath; // Use the same bun binary running the tests

beforeAll(async () => {
  relayProcess = Bun.spawn([BUN, "run", "src/socket.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Wait for the server to start
  await new Promise((resolve) => setTimeout(resolve, 500));
});

afterAll(() => {
  relayProcess.kill();
});

/** A WebSocket wrapper that queues incoming messages for reliable test consumption. */
class TestClient {
  ws: WebSocket;
  private queue: any[] = [];
  private waiters: Array<(msg: any) => void> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string);
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(data);
      } else {
        this.queue.push(data);
      }
    };
  }

  nextMessage(timeout = 2000): Promise<any> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the list
        const idx = this.waiters.indexOf(wrappedResolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error("Timed out waiting for message"));
      }, timeout);

      const wrappedResolve = (msg: any) => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.waiters.push(wrappedResolve);
    });
  }

  /** Expect no message within the given time. */
  async expectNoMessage(ms = 300): Promise<void> {
    const msg = await this.nextMessage(ms).catch(() => null);
    expect(msg).toBeNull();
  }

  send(data: any) {
    this.ws.send(JSON.stringify(data));
  }

  close() {
    this.ws.close();
  }
}

async function connect(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.onopen = () => resolve(new TestClient(ws));
    ws.onerror = (e) => reject(e);
  });
}

async function connectAndJoin(channel: string): Promise<TestClient> {
  const client = await connect();
  await client.nextMessage(); // welcome
  client.send({ type: "join", channel });
  await client.nextMessage(); // join confirm
  await client.nextMessage(); // join result
  return client;
}

describe("WebSocket Relay", () => {
  test("sends welcome message on connect", async () => {
    const client = await connect();
    const msg = await client.nextMessage();
    expect(msg.type).toBe("system");
    expect(msg.message).toContain("join a channel");
    client.close();
  });

  test("join channel succeeds", async () => {
    const client = await connect();
    await client.nextMessage(); // welcome

    client.send({ type: "join", channel: "test-ch" });

    const msg1 = await client.nextMessage();
    expect(msg1.type).toBe("system");
    expect(msg1.channel).toBe("test-ch");

    const msg2 = await client.nextMessage();
    expect(msg2.type).toBe("system");
    expect(msg2.message.result).toContain("test-ch");

    client.close();
  });

  test("join without channel name returns error", async () => {
    const client = await connect();
    await client.nextMessage(); // welcome

    client.send({ type: "join" });
    const msg = await client.nextMessage();
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("Channel name is required");
    client.close();
  });

  test("message before joining returns error", async () => {
    const client = await connect();
    await client.nextMessage(); // welcome

    client.send({ type: "message", channel: "no-join-ch", message: { id: "1" } });
    const msg = await client.nextMessage();
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("join the channel first");
    client.close();
  });

  test("broadcasts messages between peers in same channel", async () => {
    const client1 = await connectAndJoin("bcast-ch");
    const client2 = await connectAndJoin("bcast-ch");
    // client1 gets a "new user joined" notification when client2 joins
    await client1.nextMessage();

    // client1 sends a command message
    client1.send({
      type: "message",
      channel: "bcast-ch",
      id: "cmd-123",
      message: { id: "cmd-123", command: "get_document_info", params: {} },
    });

    // client2 should receive the broadcast
    const broadcast = await client2.nextMessage();
    expect(broadcast.type).toBe("broadcast");
    expect(broadcast.message.command).toBe("get_document_info");
    expect(broadcast.message.id).toBe("cmd-123");
    expect(broadcast.channel).toBe("bcast-ch");

    client1.close();
    client2.close();
  });

  test("does not broadcast to clients in different channels", async () => {
    const client1 = await connectAndJoin("iso-a");
    const client2 = await connectAndJoin("iso-b");

    // client1 sends a message in iso-a
    client1.send({
      type: "message",
      channel: "iso-a",
      message: { id: "iso-1", command: "test" },
    });

    // client2 should NOT receive it
    await client2.expectNoMessage();

    client1.close();
    client2.close();
  });

  test("forwards progress_update messages between peers", async () => {
    const client1 = await connectAndJoin("prog-ch");
    const client2 = await connectAndJoin("prog-ch");
    await client1.nextMessage(); // peer joined

    // client2 (plugin) sends a progress update
    client2.send({
      type: "progress_update",
      channel: "prog-ch",
      id: "cmd-456",
      message: {
        id: "cmd-456",
        type: "progress_update",
        data: { commandType: "scan_text_nodes", progress: 50, message: "Halfway done" },
      },
    });

    // client1 (server) should receive it as a broadcast
    const broadcast = await client1.nextMessage();
    expect(broadcast.type).toBe("broadcast");
    expect(broadcast.message.type).toBe("progress_update");
    expect(broadcast.message.data.progress).toBe(50);

    client1.close();
    client2.close();
  });

  test("does not echo messages back to sender", async () => {
    const client1 = await connectAndJoin("echo-ch");
    const client2 = await connectAndJoin("echo-ch");
    await client1.nextMessage(); // peer joined

    // client1 sends a message
    client1.send({
      type: "message",
      channel: "echo-ch",
      message: { id: "echo-1", command: "test" },
    });

    // client2 gets it
    const broadcast = await client2.nextMessage();
    expect(broadcast.type).toBe("broadcast");

    // client1 should NOT get it back
    await client1.expectNoMessage();

    client1.close();
    client2.close();
  });
});
