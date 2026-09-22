"use client";

import { useState } from "react";

export default function Publisher() {
  const [template, setTemplate] = useState("purchase_panel");
  const [channelId, setChannelId] = useState("1551620868432601298");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");

  async function publish() {
    setStatus("Publicando...");
    const res = await fetch("/api/discord/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, channelId, title, content })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setStatus("🔐 Faça login com sua conta do Discord que tenha permissão de moderação/admin.");
      return;
    }
    setStatus(res.ok ? `✅ Publicado com sucesso. Mensagem: ${data.messageId}` : `❌ ${data.error || "Erro ao publicar"}`);
  }

  return <main className="shell"><section className="card" style={{maxWidth:720}}>
    <div className="logo">🚀 SPACE REWARDS</div>
    <h1 className="title">Central de Postagens</h1>
    <p className="muted">Publique painéis e mensagens no Discord sem mexer no código.</p>

    <a className="button" href="/api/discord/publisher" style={{display:"inline-block",marginBottom:20}}>
      🔐 Entrar com Discord para publicar
    </a>

    <label>Modelo</label>
    <select value={template} onChange={e=>setTemplate(e.target.value)} style={{width:"100%",padding:12,margin:"8px 0 16px"}}>
      <option value="purchase_panel">🛒 Painel de compra de Robux</option>
      <option value="announcement">📢 Anúncio</option>
      <option value="rules">📜 Regras</option>
      <option value="giveaway">🎁 Giveaway</option>
      <option value="custom">✏️ Postagem personalizada</option>
    </select>

    <label>ID do canal do Discord</label>
    <input value={channelId} onChange={e=>setChannelId(e.target.value)} placeholder="Ex.: 1551620868432601298" style={{width:"100%",padding:12,margin:"8px 0 16px"}}/>

    {template !== "purchase_panel" && <><label>Título</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Título da postagem" style={{width:"100%",padding:12,margin:"8px 0 16px"}}/><label>Conteúdo</label><textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Escreva a mensagem..." rows={8} style={{width:"100%",padding:12,margin:"8px 0 16px"}}/></>}

    <button className="button" onClick={publish}>🚀 Publicar no Discord</button>
    {status && <p className="muted" style={{marginTop:16}}>{status}</p>}

    <hr style={{margin:"24px 0"}}/>
    <p className="muted">A estrutura já está preparada para receber novos modelos de postagem no futuro.</p>
  </section></main>
}