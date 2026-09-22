import { NextRequest, NextResponse } from "next/server";

const CHANNEL_ID = "1551620868432601298";
const BANNER_URL = "https://space-gamma-blue.vercel.app/space-rewards-banner.png";

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
      title: "🚀 COMPRAR ROBUX",
      description:
        "**Rápido, seguro e sem complicação.**\n" +
        "Escolha a quantidade que deseja, selecione a forma de envio e finalize seu pagamento pelo PIX.\n\n" +
        "⚡ **Entrega rápida**\n" +
        "🔒 **Compra segura**\n" +
        "📦 **Diversas formas de envio**\n" +
        "🎫 **Suporte durante o pedido**\n\n" +
        "### 🛒 Como funciona?\n" +
        "1️⃣ Escolha a quantidade de Robux\n" +
        "2️⃣ Selecione a forma de envio\n" +
        "3️⃣ Informe seu usuário do Roblox\n" +
        "4️⃣ Confira o valor e conclua o pedido\n" +
        "5️⃣ Realize o pagamento via PIX\n\n" +
        "🪙 **Mínimo:** 150 Robux\n" +
        "🪙 **Máximo:** 1.000.000 Robux\n\n" +
        "🛡️ **Segurança**\n" +
        "Nunca pedimos sua senha do Roblox, códigos de segurança ou acesso à sua conta.",
      color: 0x8b5cf6,
      image: { url: BANNER_URL },
      fields: [
        {
          name: "💎 Formas de envio",
          value: "Plus • Gamepass + taxa • Gamepass sem taxa",
          inline: false
        },
        {
          name: "💳 Pagamento",
          value: "PIX com confirmação automática pelo sistema.",
          inline: true
        },
        {
          name: "🎫 Precisa de ajuda?",
          value: "Nossa equipe está disponível pelo suporte.",
          inline: true
        }
      ],
      footer: { text: "SPACE Rewards • Compra de Robux" }
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: "COMPRAR ROBUX",
        emoji: { name: "🛒" },
        custom_id: "space_buy_robux"
      }, {
        type: 2,
        style: 2,
        label: "MEU PERFIL",
        emoji: { name: "👤" },
        custom_id: "space_profile"
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
