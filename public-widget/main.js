class GeminiChat extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div style="font-family:Arial;padding:8px;height:100%;display:flex;flex-direction:column;">
        <div id="msgs" style="flex:1;border:1px solid #ccc;padding:6px;overflow:auto;margin-bottom:6px;"></div>
        <input id="inp" placeholder="Escribe tu pregunta..." />
        <button id="btn">Enviar</button>
      </div>
    `;

    this.querySelector("#btn").onclick = async () => {
      const input = this.querySelector("#inp");
      const text = input.value.trim();
      if (!text) return;

      this._add("Tú: " + text, true);
      input.value = "";

      try {
        const res = await fetch(this.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        this._add("Bot: " + data.reply, false);
      } catch {
        this._add("Bot: Error conectando al backend", false);
      }
    };
  }

  _add(txt, user) {
    const div = document.createElement("div");
    div.style.margin = "4px 0";
    if (!user) div.style.color = "#0b5ed7";
    div.textContent = txt;
    const msgs = this.querySelector("#msgs");
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }
}

customElements.define("gemini-chat", GeminiChat);
