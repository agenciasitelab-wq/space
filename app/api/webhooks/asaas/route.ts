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
    .select("id,order_number,status,total_price")
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
    if (order.status !== "paid" && order.status !== "processing" && order.status !== "delivered") {
      await sb.from("orders").update({
        status: "paid",
        paid_at: new Date().toISOString()
      }).eq("id", order.id);

      await sb.from("order_events").insert({
        order_id: order.id,
        event_type: "payment_received",
        description: "Pagamento PIX confirmado pelo Asaas."
      });
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
