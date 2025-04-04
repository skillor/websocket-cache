import { WebSocketServer } from 'ws';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'node:fs';
import https from 'https';
import path from 'path';

// Argument parsing for port and certificates path
const argv = yargs(hideBin(process.argv))
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'The port on which the WebSocket Server will launch',
  })
  .check((argv) => {
    if (isNaN(argv.port) || argv.port < 1 || argv.port > 65535) {
      throw new Error('Port must be a number between 1 and 65535');
    }
    return true;
  })
  .option('token', {
    alias: 't',
    type: 'string',
    description: 'The token for authorization with the room service',
  })
  .check((argv) => {
    if (argv.token.includes(' ')) {
      throw new Error('❌ Token cannot contain spaces.');
    }
    return true;
  })
  .option('certsPath', {
    alias: 'c',
    type: 'string',
    description: 'Path to the directory containing SSL certificate files',
  })
  .help()
  .argv;

// Verify if certificates are provided
let wss;
if (argv.certsPath) {
  // SSL cert paths
  const certsDir = path.resolve(argv.certsPath);

  try {
    const cert = fs.readFileSync(path.join(certsDir, 'fullchain.pem'), 'utf8');
    const key = fs.readFileSync(path.join(certsDir, 'privkey.pem'), 'utf8');
    const ca = fs.existsSync(path.join(certsDir, 'chain.pem'))
      ? fs.readFileSync(path.join(certsDir, 'chain.pem'), 'utf8')
      : undefined;

    // Create HTTPS server with SSL certificates
    const httpsServer = https.createServer({
      cert,
      key,
      ca,
    });

    // Attach WebSocket server to the HTTPS server
    wss = new WebSocketServer({ server: httpsServer });

    // Start HTTPS server on provided port
    httpsServer.listen(argv.port, () => {
      console.log(`WebSocket server with SSL is running on wss://localhost:${argv.port}`);
    });

  } catch (err) {
    console.error('Error loading SSL certificates:', err);
    process.exit(1); // Exit if certificates are missing or invalid
  }
} else {
  // Fallback to an unsecured WebSocket server (ws://)
  wss = new WebSocketServer({
    port: argv.port,
  });
  console.log(`WebSocket server without SSL is running on ws://localhost:${argv.port}`);
}

// Rooms and other existing logic
let rooms = {};

try {
  rooms = Object.fromEntries(
    Object.entries(JSON.parse(fs.readFileSync('db.json')))
      .map(([key, value]) => {
        return [key, { state: value, clients: [] }];
      })
  );
  console.log('Loaded db', rooms);
} catch {
  console.error('Failed to load db');
}

function saveStateToDisk() {
  fs.writeFile('db.json', JSON.stringify(Object.fromEntries(Object.entries(rooms).map(([key, value]) => {
    return [key, value.state];
  }))), () => { });
}

setInterval(saveStateToDisk, 10_000);
saveStateToDisk();

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  ws.on('error', console.error);

  // Handle WebSocket message
  ws.on('message', (data) => {
    const lineSplit = data.toString().split(' ');

    if (lineSplit[0] === '/room' && lineSplit.length === 3) {
      const authToken = lineSplit[1];
      if (authToken !== argv.token) return;
      const roomId = lineSplit[2];
      if (roomId in rooms) {
        rooms[roomId].clients.push(ws);
        ws.send('/state ' + JSON.stringify(rooms[roomId].state));
      } else {
        rooms[roomId] = { state: undefined, clients: [ws] };
      }
      return;
    }

    if (lineSplit[0] === '/state' && lineSplit.length > 2) {
      const roomId = lineSplit[1];
      if (!(roomId in rooms)) return;
      try {
        const state = JSON.parse(lineSplit.slice(2).join(' '));
        rooms[roomId].state = state;
        rooms[roomId].clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send('/state ' + JSON.stringify(state));
          }
        });
      } catch (e) {
        console.error(e);
      }
    }
  });
});
