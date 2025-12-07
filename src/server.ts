import 'dotenv/config';
import WebSocket, { WebSocketServer } from 'ws';
import { Client } from 'pg';

// ---- SETTINGS TO REDUCE BANDWIDTH ----
const MAX_CLIENTS_PER_IP = 20;         // Limit open WS connections per IP
const MAX_MSGS_PER_MIN = 100;          // Throttle broadcast rate (per client)
const HEARTBEAT_INTERVAL = 20000;     // 20s ping to close dead clients
const MAX_CONNECTION_DURATION = 30 * 60 * 1000; // Auto-close after 1 hour

const port = parseInt(process.env.PORT || "3001");
const wss = new WebSocketServer({ port });

// Track rate-limit and IP usage
const ipConnectionCount = new Map<string, number>();
const clientMessageCount = new Map<WebSocket, number>();

// PostgreSQL client
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function startPostgresListener() {
  await pgClient.connect();
  await pgClient.query("LISTEN note_changes");

  pgClient.on("notification", (msg) => {
    if (!msg.payload) return;

    const payload = msg.payload;

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const count = clientMessageCount.get(client) ?? 0;

        // Throttle egress to control cost
        if (count < MAX_MSGS_PER_MIN) {
          client.send(payload);
          clientMessageCount.set(client, count + 1);
        }
      }
    });
  });

  console.log('Postgres notifications on "note_changes" listening…');
}

// Reset per-minute throttles
setInterval(() => {
  clientMessageCount.clear();
}, 60 * 1000);

startPostgresListener().catch(console.error);

// WebSocket connections
wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";

  // Count connections per IP to prevent abuse & reduce egress
  const existing = ipConnectionCount.get(ip) || 0;
  if (existing >= MAX_CLIENTS_PER_IP) {
    ws.close(4001, "Too many connections from same IP");
    return;
  }
  ipConnectionCount.set(ip, existing + 1);

  console.log(`Client connected (${ip})`);

  // Heartbeat to clear dead connections
  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }
    ws.ping();
  }, HEARTBEAT_INTERVAL);

  // Auto-close to prevent infinite idle connections
  const autoClose = setTimeout(() => ws.close(4002, "Max duration reached"), MAX_CONNECTION_DURATION);

  ws.on("close", () => {
    clearInterval(interval);
    clearTimeout(autoClose);
    ipConnectionCount.set(ip, Math.max(0, (ipConnectionCount.get(ip) || 1) - 1));
    console.log(`Client disconnected (${ip})`);
  });
});

console.log(`WebSocket running on ws://0.0.0.0:${port}`);
