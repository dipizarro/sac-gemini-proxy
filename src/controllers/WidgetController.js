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
    // Podemos mover el HTML a un archivo separado, pero lo mantenemos inline por ahora como en el original
    // excepto que ahora está en el controlador
    res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Gemini Chat Demo</title>
  <style>
    html,body{height:100%;margin:0;font-family:Arial}
    .wrap{height:100%;display:flex;flex-direction:column;padding:10px;box-sizing:border-box}
    #msgs{flex:1;border:1px solid #ccc;border-radius:8px;padding:10px;overflow:auto;background:#fff}
    .m{margin:6px 0}
    .u{font-weight:700}
    .b{color:#0b5ed7}
    .row{display:flex;gap:8px;margin-top:8px}
    #inp{flex:1;padding:10px;border:1px solid #ccc;border-radius:8px}
    #btn{padding:10px 14px;border:0;border-radius:8px;background:#0b5ed7;color:#fff;cursor:pointer}
    #btn:disabled{opacity:.6;cursor:not-allowed}
  </style>
</head>
<body>
  <div class="wrap">
    <div id="msgs"></div>
    <div class="row">
      <input id="inp" placeholder="Escribe tu pregunta..." />
      <button id="btn">Enviar</button>
    </div>
  </div>

  <script>
    const CHAT_URL = new URL("/chat", window.location.origin).toString();
    const msgs = document.getElementById("msgs");
    const inp = document.getElementById("inp");
    const btn = document.getElementById("btn");

    function add(text, cls){
      const d=document.createElement("div");
      d.className="m " + cls;
      d.textContent=text;
      msgs.appendChild(d);
      msgs.scrollTop=msgs.scrollHeight;
    }

    async function send(){
      const text = (inp.value||"").trim();
      if(!text) return;
      add("Tú: " + text, "u");
      inp.value="";
      btn.disabled=true;

      try{
        const r = await fetch(CHAT_URL, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ message: text })
        });
        const data = await r.json();
        add("Bot: " + (data.reply || "(sin respuesta)"), "b");
      }catch(e){
        add("Bot: Error conectando al backend", "b");
      }finally{
        btn.disabled=false;
        inp.focus();
      }
    }

    btn.onclick = send;
    inp.addEventListener("keydown", (e)=>{ if(e.key==="Enter") send(); });
    add("Bot: Hola 👋 Pregúntame sobre SAC.", "b");
  </script>
</body>
</html>`);
  }
}

module.exports = new WidgetController();
