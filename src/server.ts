import 'dotenv/config'; // automatically loads .env
import WebSocket, { WebSocketServer } from 'ws';
import { Client } from 'pg';

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

// PostgreSQL client
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL, 
});

async function startPostgresListener() {
  await pgClient.connect();

  // Listen to the "note_changes" channel
  await pgClient.query('LISTEN note_changes');

  pgClient.on('notification', (msg) => {
    if (msg.channel === 'note_changes' && msg.payload) {
      const payload = msg.payload; // Guaranteed string
      console.log('Postgres notification:', payload);

      // Broadcast to all WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload); // safe
        }
      });
    }
  });

  console.log('Listening for Postgres notifications on "note_changes"');
}

startPostgresListener().catch(console.error);

// WebSocket connections
wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  ws.on('message', (message: WebSocket.RawData) => {
    const msg = message.toString();
    console.log(`Received from client: ${msg}`);
  });

  ws.on('close', () => console.log('Client disconnected'));
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);
