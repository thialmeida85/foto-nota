const clients = new Set();
const history = [];
const maxHistory = 200;

export function addLog(message) {
  const entry = {
    id: Date.now(),
    time: new Date().toISOString(),
    message
  };

  history.push(entry);
  if (history.length > maxHistory) history.shift();

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }

  console.log(`[automacao] ${message}`);
}

export function streamLogs(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  for (const entry of history.slice(-50)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  clients.add(res);
  req.on('close', () => clients.delete(res));
}

