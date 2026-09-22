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
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }

  if (!response.ok) {
    throw new Error(
      `Discord ${response.status} em ${path}: ${data?.message || text || "erro desconhecido"}`
    );
  }

  return data;
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const receivedToken = req.headers.get("asaas-access-token");

  if (!expectedToken || !receivedToken || receivedToken !== expectedToken) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  const eventId = String(payload?.id || "");
  const event = String(payload?.event || "");
  const paymentId = String(payload?.payment?.id || "");

  if (!eventId || !event || !paymentId) {
    return NextResponse.json({ ok: true });
  }

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Idempotência simples: não processa novamente um evento já registrado.
  const { data: existing } = await sb
    .from("order_events")
    .select("id")
    .eq("event_type", "asaas_webhook:" + eventId)
    .limit(1)
    .maybeSingle();

  if (existing) return NextResponse.json({ ok: true });

  const { data: order, error: orderError } = await sb
    .from("orders")
    .select("id,order_number,status,total_price,user_id,discord_channel_id,delivery_method,roblox_username")
    .eq("payment_id", paymentId)
    .maybeSingle();

  if (orderError) {
    console.error("Supabase order lookup error:", orderError);
    return new NextResponse("database error", { status: 500 });
  }

  if (!order) {
    console.warn("Asaas payment without matching order:", paymentId);
    return NextResponse.json({ ok: true });
  }

  await sb.from("order_events").insert({
    order_id: order.id,
    event_type: "asaas_webhook:" + eventId,
    description: "Webhook Asaas recebido: " + event,
    metadata: payload
  });

  if (event === "PAYMENT_RECEIVED") {
    const alreadyPaid =
      order.status === "paid" ||
      order.status === "processing" ||
      order.status === "delivered";

    if (!alreadyPaid) {
      await sb.from("orders").update({
        status: "paid",
        paid_at: new Date().toISOString()
      }).eq("id", order.id);

      await sb.from("order_events").insert({
        order_id: order.id,
        event_type: "payment_received",
        description: "Pagamento PIX confirmado pelo Asaas."
      });

      // Atualiza o canal do pedido para 🟢 PAGO.
      if (order.discord_channel_id) {
        try {
          await discordRequest(`/channels/${order.discord_channel_id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: (() => { const m = order.delivery_method === "plus" ? "plus" : order.delivery_method === "gamepass_fee" || order.delivery_method === "gamepass_no_fee" ? "gamepass" : "grupo"; const u = String(order.roblox_username || "cliente").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 70) || "cliente"; return `🟢・${m}-${u}`; })()
            })
          });

          await discordRequest(`/channels/${order.discord_channel_id}/messages`, {
            method: "POST",
            body: JSON.stringify({
              embeds: [{
                title: `🟢 PAGAMENTO CONFIRMADO • PEDIDO #${order.order_number}`,
                description: "O pagamento foi confirmado pelo Asaas.",
                color: 0x57f287,
                fields: [
                  { name: "💵 Valor pago", value: `**R$ ${Number(order.total_price).toFixed(2).replace(".", ",")}**`, inline: true },
                  { name: "📌 Status", value: "**🟢 PAGO**", inline: true }
                ],
                footer: { text: "SPACE Rewards • Pagamento confirmado" }
              }],
              components: [{
                type: 1,
                components: [{
                  type: 2,
                  style: 1,
                  label: "MARCAR COMO ENTREGUE",
                  emoji: { name: "📦" },
                  custom_id: `space_mark_delivered:${order.id}`
                }]
              }]
            })
          });

          // Remove os componentes de mensagens antigas de PIX para evitar
          // que o comprador tente gerar/cancelar um pagamento já confirmado.
          try {
            const messagesResponse = await fetch(
              `https://discord.com/api/v10/channels/${order.discord_channel_id}/messages?limit=20`,
              {
                headers: {
                  Authorization: "Bot " + process.env.DISCORD_BOT_TOKEN
                }
              }
            );
            const messages: any[] = await messagesResponse.json();
            for (const message of Array.isArray(messages) ? messages : []) {
              const title = message?.embeds?.[0]?.title || "";
              if (title.includes("PAGAMENTO • PEDIDO #" + order.order_number) && message.components?.length) {
                await discordRequest(`/channels/${order.discord_channel_id}/messages/${message.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ components: [] })
                });
              }
            }
          } catch (error) {
            console.error("Payment message cleanup error:", error);
          }

          // Remove também o botão GERAR PIX do resumo inicial do pedido.
          try {
            const messagesResponse = await fetch(
              `https://discord.com/api/v10/channels/${order.discord_channel_id}/messages?limit=50`,
              { headers: { Authorization: "Bot " + process.env.DISCORD_BOT_TOKEN } }
            );
            const messages: any[] = await messagesResponse.json();
            for (const message of Array.isArray(messages) ? messages : []) {
              const hasPaymentAction = (message.components || []).some((row: any) =>
                (row.components || []).some((component: any) =>
                  String(component.custom_id || "").startsWith("space_pay:")
                )
              );
              if (hasPaymentAction) {
                await discordRequest(`/channels/${order.discord_channel_id}/messages/${message.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ components: [] })
                });
              }
            }
          } catch (error) {
            console.error("Order action cleanup error:", error);
          }
        } catch (error) {
          console.error("Discord paid channel update error:", error);
          await sb.from("order_events").insert({
            order_id: order.id,
            event_type: "payment_channel_update_failed",
            description: "Pagamento confirmado, mas não foi possível atualizar o canal do pedido.",
            metadata: { error: String(error) }
          });
        }
      }

      // Notifica o comprador por DM. Falha no Discord não invalida o webhook.
      try {
        const { data: user } = await sb
          .from("users")
          .select("discord_id")
          .eq("id", order.user_id)
          .single();

        const botToken = process.env.DISCORD_BOT_TOKEN;

        if (user?.discord_id && botToken) {
          const dmResponse = await fetch(
            "https://discord.com/api/v10/users/@me/channels",
            {
              method: "POST",
              headers: {
                Authorization: "Bot " + botToken,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ recipient_id: user.discord_id })
            }
          );

          const dmChannel = await dmResponse.json().catch(() => null);

          if (!dmResponse.ok || !dmChannel?.id) {
            throw new Error(
              "Discord DM channel error " +
                dmResponse.status +
                ": " +
                JSON.stringify(dmChannel)
            );
          }

          const messageResponse = await fetch(
            `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: "Bot " + botToken,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                content: [
                  `✅ **Pagamento confirmado — Pedido #${order.order_number}**`,
                  "",
                  `💵 Valor pago: **R$ ${Number(order.total_price).toFixed(2).replace(".", ",")}**`,
                  "",
                  "🚀 Seu pedido foi confirmado pelo SPACE Rewards.",
                  "📦 A entrega dos Robux seguirá o processamento do pedido."
                ].join("\n")
              })
            }
          );

          if (!messageResponse.ok) {
            const details = await messageResponse.text();
            throw new Error(
              "Discord DM message error " +
                messageResponse.status +
                ": " +
                details
            );
          }
        }
      } catch (error) {
        console.error("Discord payment confirmation notification error:", error);
        await sb.from("order_events").insert({
          order_id: order.id,
          event_type: "payment_notification_failed",
          description: "Pagamento confirmado, mas a DM do Discord não pôde ser enviada.",
          metadata: { error: String(error) }
        });
      }
    }
  }

  if (event === "PAYMENT_OVERDUE") {
    if (order.status === "awaiting_payment" || order.status === "payment_pending") {
      await sb.from("orders").update({ status: "expired" }).eq("id", order.id);

      if (order.discord_channel_id) {
        try {
          await discordRequest(`/channels/${order.discord_channel_id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: (() => { const m = order.delivery_method === "plus" ? "plus" : order.delivery_method === "gamepass_fee" || order.delivery_method === "gamepass_no_fee" ? "gamepass" : "grupo"; const u = String(order.roblox_username || "cliente").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 70) || "cliente"; return `🔴・${m}-${u}`; })()
            })
          });

          await discordRequest(`/channels/${order.discord_channel_id}/messages`, {
            method: "POST",
            body: JSON.stringify({
              embeds: [{
                title: `🔴 PEDIDO VENCIDO • #${order.order_number}`,
                description: "O prazo do pagamento terminou. Gere um novo pedido para comprar novamente.",
                color: 0xed4245,
                fields: [
                  { name: "📌 Status", value: "**🔴 VENCIDO**", inline: true }
                ],
                footer: { text: "SPACE Rewards • Pagamento expirado" }
              }]
            })
          });
        } catch (error) {
          console.error("Discord expired channel update error:", error);
        }

        try {
          const messagesResponse = await fetch(
            `https://discord.com/api/v10/channels/${order.discord_channel_id}/messages?limit=50`,
            { headers: { Authorization: "Bot " + process.env.DISCORD_BOT_TOKEN } }
          );
          const messages: any[] = await messagesResponse.json();
          for (const message of Array.isArray(messages) ? messages : []) {
            const hasPaymentAction = (message.components || []).some((row: any) =>
              (row.components || []).some((component: any) =>
                String(component.custom_id || "").startsWith("space_pay:")
              )
            );
            if (hasPaymentAction) {
              await discordRequest(`/channels/${order.discord_channel_id}/messages/${message.id}`, {
                method: "PATCH",
                body: JSON.stringify({ components: [] })
              });
            }
          }
        } catch (error) {
          console.error("Expired order action cleanup error:", error);
        }
      }
    }
  }

  if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_PARTIALLY_REFUNDED") {
    await sb.from("orders").update({ status: "refunded" }).eq("id", order.id);
  }

  return NextResponse.json({ ok: true });
}
