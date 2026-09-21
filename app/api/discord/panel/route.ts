import { NextRequest, NextResponse } from "next/server";

const CHANNEL_ID = "1551620868432601298";

export async function POST(req: NextRequest) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const configuredChannel = process.env.DISCORD_PURCHASE_CHANNEL_ID || CHANNEL_ID;
  const authorization = req.headers.get("authorization");

  if (!token) {
    return NextResponse.json({ error: "Bot não configurado" }, { status: 500 });
  }

  // Esta rota publica o painel e não deve ficar aberta na internet.
  if (authorization !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const channelId = body.channelId || configuredChannel;

  if (channelId !== configuredChannel) {
    return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  }

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

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(message)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Discord panel error:", response.status, data);
    return NextResponse.json(
      { error: "Não foi possível publicar o painel", details: data },
      { status: response.status }
    );
  }

  return NextResponse.json({ ok: true, messageId: data.id, channelId });
}
