const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Proxy DexScreener
  if (req.url.startsWith('/.netlify/functions/dex-proxy')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing token parameter' }));
      return;
    }

    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${token}`;
    
    fetch(dexUrl)
      .then(r => r.json())
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        console.error('DexScreener error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'DexScreener API error' }));
      });
    return;
  }

  // Telegram alert (mock)
  if (req.url === '/.netlify/functions/send-alert' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('📨 Alert:', data.message.split('\n')[0]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Alert sent (local mock)' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Serve static files
  // Extraire le chemin sans les paramètres de query
  const urlPath = req.url.split('?')[0];
  // Utiliser le répertoire courant de lancement du serveur
  let filePath = path.join(process.cwd(), urlPath === '/' ? 'index.html' : urlPath);
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error(`404 - File not found: ${filePath}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found', path: urlPath }));
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.css': 'text/css'
    }[ext] || 'text/plain';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Local server running at http://localhost:${PORT}`);
  console.log('📡 DexScreener proxy: /.netlify/functions/dex-proxy?token=...');
  console.log('📨 Telegram mock: /.netlify/functions/send-alert');
  console.log(`📁 Serving files from: ${process.cwd()}`);
  console.log(`✅ site_data.json path: ${path.join(process.cwd(), 'site_data.json')}`);
});
