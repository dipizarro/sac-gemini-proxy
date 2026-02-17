const path = require("path");
const fs = require("fs");

class WidgetController {
  serveWidget(req, res) {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-transform");
    // Leer archivo de forma síncrona es aceptable para esta escala, o se puede cachear el contenido.
    // El código original realizaba una lectura síncrona en cada solicitud.
    const widgetPath = path.join(process.cwd(), "public-widget", "main.js");
    try {
      const content = fs.readFileSync(widgetPath, "utf8");
      res.send(content);
    } catch (err) {
      res.status(404).send("Widget file not found");
    }
  }

  serveDemo(req, res) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SAC Gemini Proxy - Demo</title>
  <style>
    :root {
      --primary: #0a6ed1;
      --bg: #f5f7fa;
      --card-bg: #ffffff;
      --border: #d9d9d9;
      --text: #32363a;
    }
    body { margin: 0; font-family: "72", "72full", Arial, Helvetica, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
    .header { background: #354a5f; color: #fff; padding: 10px 20px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    .main { flex: 1; display: flex; overflow: hidden; }
    
    /* Sidebar */
    .sidebar { width: 300px; background: var(--card-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
    .panel { padding: 15px; border-bottom: 1px solid var(--border); }
    .panel h3 { margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; color: #666; }
    .stat-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 13px; }
    .stat-val { font-weight: bold; }
    .btn { width: 100%; padding: 8px; background: var(--primary); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }
    
    /* Mini Tables */
    .mini-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 5px; }
    .mini-table th { text-align: left; border-bottom: 1px solid var(--border); padding: 4px; color: #666; }
    .mini-table td { border-bottom: 1px solid #eee; padding: 4px; }
    .mini-table tr:last-child td { border-bottom: none; }

    /* Chat Area */
    .chat-area { flex: 1; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box; }
    #msgs { flex: 1; border: 1px solid var(--border); border-radius: 4px; padding: 15px; overflow-y: auto; background: var(--card-bg); margin-bottom: 10px; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 80%; padding: 10px; border-radius: 8px; font-size: 14px; line-height: 1.4; }
    .msg.u { align-self: flex-end; background: #e1f0fa; color: #000; border-bottom-right-radius: 0; }
    .msg.b { align-self: flex-start; background: #f0f0f0; color: #000; border-bottom-left-radius: 0; white-space: pre-wrap; }
    .input-row { display: flex; gap: 10px; }
    #inp { flex: 1; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: inherit; }
    #sendBtn { padding: 10px 20px; }

    /* Utilities */
    .badge { padding: 2px 6px; border-radius: 10px; font-size: 11px; background: #eee; }
    .badge.ok { background: #e5f9e7; color: #2b7d2b; }
    .badge.err { background: #fcebeb; color: #bb0000; }
  </style>
</head>
<body>
  <div class="header">
    <span>SAC Gemini Proxy</span>
    <span style="font-weight:normal; font-size:12px">v1.0</span>
  </div>
  
  <div class="main">
    <!-- Sidebar for CSV Management -->
    <div class="sidebar">
      
      <!-- Status Panel -->
      <div class="panel">
        <h3>Fuente de Datos CSV</h3>
        <div class="stat-row">
          <span>Estado:</span>
          <span id="fileStatus" class="badge">Checking...</span>
        </div>
        <div class="stat-row">
          <span>Filas (Cache):</span>
          <span id="rowCount" class="stat-val">-</span>
        </div>
        <div class="stat-row">
          <span>Última Mod:</span>
          <span id="fileDate" class="stat-val">-</span>
        </div>
        <button id="reloadBtn" class="btn" style="margin-top:10px">Recargar Datos (Disk -> Cache)</button>
      </div>

      <!-- Summary Panel: Centros -->
      <div class="panel">
        <h3>Top 5 Centros</h3>
        <table class="mini-table" id="tableCentros">
          <thead><tr><th>Centro</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody><tr><td colspan="2">Cargando...</td></tr></tbody>
        </table>
      </div>

      <!-- Summary Panel: Movimientos -->
      <div class="panel">
        <h3>Top 5 Movimientos</h3>
        <table class="mini-table" id="tableMovs">
          <thead><tr><th>Clase</th><th style="text-align:right">Freq</th></tr></thead>
          <tbody><tr><td colspan="2">Cargando...</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- Chat Interface -->
    <div class="chat-area">
      <div id="msgs"></div>
      <div class="input-row">
        <input id="inp" placeholder="Pregunta sobre movimientos, centros, materiales..." />
        <button id="sendBtn" class="btn">Enviar</button>
      </div>
    </div>
  </div>

  <script>
    // --- API Utils ---
    const API = {
      chat: '/chat',
      status: '/csv/status',
      reload: '/csv/reload',
      summary: '/csv/summary'
    };

    const $ = id => document.getElementById(id);

    // --- CSV Management Logic ---
    async function updateStatus() {
      try {
        const r = await fetch(API.status);
        const d = await r.json();
        
        const file = d.file || {};
        const cache = d.cache || {};

        $('fileStatus').textContent = file.exists ? 'OK' : 'MISSING';
        $('fileStatus').className = 'badge ' + (file.exists ? 'ok' : 'err');
        $('rowCount').textContent = cache.loaded ? cache.rows : '(No Cache)';
        
        if (file.mtime) {
          $('fileDate').textContent = new Date(file.mtime).toLocaleString();
        }
      } catch (e) {
        console.error(e);
        $('fileStatus').textContent = 'Error API';
      }
    }

    async function updateSummary() {
      try {
        const r = await fetch(API.summary);
        const d = await r.json();
        
        if (d.ok) {
          renderTable('tableCentros', d.topCentros);
          renderTable('tableMovs', d.topMovimientos);
          // Update row count from summary if available
          if (d.rowCount) $('rowCount').textContent = d.rowCount; 
        }
      } catch (e) {
        console.error(e);
      }
    }

    function renderTable(id, data) {
      const tbody = $(id).querySelector('tbody');
      tbody.innerHTML = '';
      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2">Sin datos</td></tr>';
        return;
      }
      data.forEach(([key, val]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`<td>\${key}</td><td style="text-align:right">\${val}</td>\`;
        tbody.appendChild(tr);
      });
    }

    async function reloadData() {
      const btn = $('reloadBtn');
      btn.disabled = true;
      btn.textContent = "Recargando...";
      try {
        const r = await fetch(API.reload, { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
          alert('Recarga exitosa: ' + d.rows + ' filas.');
          updateStatus();
          updateSummary();
        } else {
          alert('Error: ' + d.error);
        }
      } catch (e) {
        alert('Error de red');
      } finally {
        btn.disabled = false;
        btn.textContent = "Recargar Datos (Disk -> Cache)";
      }
    }

    // --- Chat Logic ---
    const msgs = $('msgs');
    const inp = $('inp');
    const sendBtn = $('sendBtn');

    function addMsg(text, type) {
      const div = document.createElement('div');
      div.className = 'msg ' + type;
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }

    async function sendChat() {
      const text = inp.value.trim();
      if (!text) return;
      
      addMsg(text, 'u');
      inp.value = '';
      sendBtn.disabled = true;

      try {
        const r = await fetch(API.chat, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const d = await r.json();
        addMsg(d.reply || "(Sin respuesta)", 'b');
      } catch (e) {
        addMsg("Error de conexión", 'b');
      } finally {
        sendBtn.disabled = false;
        inp.focus();
      }
    }

    // --- Init ---
    $('reloadBtn').onclick = reloadData;
    $('sendBtn').onclick = sendChat;
    inp.onkeydown = e => { if (e.key === 'Enter') sendChat(); };

    // Initial Load
    updateStatus();
    updateSummary();
    addMsg("Hola 👋. El contexto de datos se actualiza desde el panel izquierdo.", "b");

  </script>
</body>
</html>`);
  }
}

module.exports = new WidgetController();
