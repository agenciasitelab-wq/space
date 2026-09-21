import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    .select("id,order_number,status,total_price,user_id")
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
    }
  }

  if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_PARTIALLY_REFUNDED") {
    await sb.from("orders").update({ status: "refunded" }).eq("id", order.id);
  }

  return NextResponse.json({ ok: true });
}
