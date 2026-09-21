import { NextResponse } from "next/server";

const SETUP_KEY = "space-panel-2026-09-21";
const CHANNEL_ID = "1551620868432601298";

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== SETUP_KEY) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Bot não configurado" }, { status: 500 });

  const message = {
    embeds: [{
      title: "🚀 SPACE REWARDS",
      description:
        "**Compre seus Robux de forma simples e segura.**\n\n" +
        "🪙 **Quantidade mínima:** 150 Robux\n" +
        "⚡ Entrega rápida\n" +
        "🔒 Compra segura\n\n" +
        "Clique no botão abaixo para começar sua compra.",
      color: 0x5865f2,
      footer: { text: "SPACE Rewards • Robux" }
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: "COMPRAR ROBUX",
        emoji: { name: "🛒" },
        custom_id: "space_buy_robux"
      }]
    }]
  };

  const response = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: "Falha no Discord", details: data }, { status: response.status });

  return NextResponse.json({ ok: true, messageId: data.id });
}