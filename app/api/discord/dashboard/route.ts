import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

async function discordRequest(path: string, init: RequestInit = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN não configurado");
  const response = await fetch("https://discord.com/api/v10" + path, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: "Bot " + token,
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Discord ${response.status}: ${data?.message || text}`);
  return data;
}

export async function POST(req: NextRequest) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const guildId = process.env.DISCORD_GUILD_ID!;
  const channels = await discordRequest(`/guilds/${guildId}/channels`, { method: "GET" });
  const statusChannel = (channels as any[]).find((c: any) => c.type === 0 && c.name === "📊・status");
  if (!statusChannel) return NextResponse.json({ error: 'Canal "📊・status" não encontrado.' }, { status: 404 });

  const { data: orders } = await sb.from("orders").select("status,total_price,created_at");
  const { data: reviews } = await sb.from("reviews").select("rating");
  const all = orders ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = all.filter((o: any) => String(o.created_at).slice(0, 10) === today);
  const paid = all.filter((o: any) => ["paid","processing","delivered"].includes(o.status));
  const delivered = all.filter((o: any) => o.status === "delivered");
  const pending = all.filter((o: any) => ["awaiting_payment","payment_pending"].includes(o.status));
  const revenue = paid.reduce((s: number, o: any) => s + Number(o.total_price || 0), 0);
  const todayRevenue = todayOrders.filter((o: any) => ["paid","processing","delivered"].includes(o.status))
    .reduce((s: number, o: any) => s + Number(o.total_price || 0), 0);
  const avg = reviews?.length ? reviews.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviews.length : 0;

  const embed = {
    title: "📊 SPACE REWARDS • STATUS",
    description: "Visão geral das vendas e pedidos do sistema.",
    color: 0x5865f2,
    fields: [
      { name: "💰 Vendas hoje", value: `**R$ ${todayRevenue.toFixed(2).replace(".", ",")}**`, inline: true },
      { name: "📦 Pedidos hoje", value: `**${todayOrders.length}**`, inline: true },
      { name: "🟡 Pendentes", value: `**${pending.length}**`, inline: true },
      { name: "🟢 Pagos/entregues", value: `**${paid.length}**`, inline: true },
      { name: "🟣 Entregues", value: `**${delivered.length}**`, inline: true },
      { name: "💵 Faturamento total", value: `**R$ ${revenue.toFixed(2).replace(".", ",")}**`, inline: true },
      { name: "⭐ Avaliação média", value: reviews?.length ? `**${avg.toFixed(1)}/5**` : "**Sem avaliações**", inline: true },
      { name: "📊 Total de pedidos", value: `**${all.length}**`, inline: true }
    ],
    footer: { text: "SPACE Rewards • Atualize este painel quando quiser" },
    timestamp: new Date().toISOString()
  };

  const messages = await discordRequest(`/channels/${statusChannel.id}/messages?limit=20`, { method: "GET" });
  const botMessage = (messages as any[]).find((m: any) =>
    m.author?.bot && m.embeds?.[0]?.title === "📊 SPACE REWARDS • STATUS"
  );

  if (botMessage) {
    await discordRequest(`/channels/${statusChannel.id}/messages/${botMessage.id}`, {
      method: "PATCH",
      body: JSON.stringify({ embeds: [embed] })
    });
  } else {
    await discordRequest(`/channels/${statusChannel.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ embeds: [embed] })
    });
  }

  return NextResponse.json({ ok: true, channelId: statusChannel.id });
}
