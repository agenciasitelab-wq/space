import { NextRequest, NextResponse } from "next/server";
import { PUBLISHER_COOKIE, verifyPublisherSession } from "../../../../lib/discord/publisher";

const DEFAULT_CHANNEL = "1551620868432601298";
const BANNER_URL = "https://space-gamma-blue.vercel.app/space-rewards-banner.png";

function purchasePanel() {
  return {
    embeds: [{
      title: "🚀 COMPRAR ROBUX",
      description:
        "**Rápido, seguro e sem complicação.**\n" +
        "Escolha a quantidade, selecione a forma de envio e finalize pelo PIX.\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "🛒 **COMPRE AGORA**\n" +
        "• Escolha a quantidade de Robux desejada\n" +
        "• Selecione a forma de envio\n" +
        "• Informe seu usuário do Roblox\n" +
        "• Confira o valor e finalize o pedido\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "💎 **Formas de envio**\n" +
        "Plus • Gamepass + taxa • Gamepass sem taxa\n\n" +
        "💳 **Pagamento**\n" +
        "PIX com confirmação automática pelo sistema.\n\n" +
        "🛡️ **Segurança**\n" +
        "Nunca pedimos sua senha, códigos de segurança ou acesso à sua conta.\n\n" +
        "🪙 **Mínimo:** 150 Robux  •  **Máximo:** 1.000.000 Robux",
      color: 0x8b5cf6,
      image: { url: BANNER_URL },
      footer: { text: "SPACE Rewards • Compra de Robux" }
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: "COMPRAR ROBUX", emoji: { name: "🛒" }, custom_id: "space_buy_robux" },
        { type: 2, style: 2, label: "MEU PERFIL", emoji: { name: "👤" }, custom_id: "space_profile" }
      ]
    }]
  };
}
function announcement(title: string, content: string) {
  return { embeds: [{ title: title || "📢 ANÚNCIO", description: content, color: 0x8b5cf6, footer: { text: "SPACE Rewards • Anúncios" } }] };
}

function rules(content: string) {
  return { embeds: [{ title: "📜 REGRAS", description: content, color: 0x8b5cf6, footer: { text: "SPACE Rewards • Regras" } }] };
}

function giveaway(content: string) {
  return { embeds: [{ title: "🎁 GIVEAWAY", description: content, color: 0xf59e0b, footer: { text: "SPACE Rewards • Eventos" } }] };
}

export async function POST(req: NextRequest) {
  const session = verifyPublisherSession(req.cookies.get(PUBLISHER_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Sessão de publicação inválida ou expirada." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const template = body.template;
  const channelId = body.channelId || DEFAULT_CHANNEL;

  if (!["purchase_panel", "announcement", "rules", "giveaway", "custom"].includes(template)) {
    return NextResponse.json({ error: "Modelo de postagem inválido." }, { status: 400 });
  }

  let message: any;
  if (template === "purchase_panel") message = purchasePanel();
  else if (template === "announcement") message = announcement(body.title, body.content);
  else if (template === "rules") message = rules(body.content);
  else if (template === "giveaway") message = giveaway(body.content);
  else message = announcement(body.title, body.content);

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Bot não configurado." }, { status: 500 });

  if (template === "purchase_panel") {
    const bannerResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(message.banner)
    });
    if (!bannerResponse.ok) {
      const bannerData = await bannerResponse.json().catch(() => ({}));
      console.error("Discord banner error:", bannerResponse.status, bannerData);
      return NextResponse.json({ error: "Não foi possível publicar o banner.", details: bannerData }, { status: bannerResponse.status });
    }
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(message.panel || message)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Discord publisher error:", response.status, data);
    return NextResponse.json({ error: "Discord recusou a publicação.", details: data }, { status: response.status });
  }

  return NextResponse.json({ ok: true, messageId: data.id, channelId, template, publishedBy: session.username });
}
