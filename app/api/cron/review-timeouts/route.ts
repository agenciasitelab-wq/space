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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `Discord ${response.status} em ${path}: ${data?.message || text || "erro desconhecido"}`
    );
  }

  return data;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: orders, error } = await sb
    .from("orders")
    .select("id,order_number,status,delivered_at,discord_channel_id")
    .eq("status", "delivered")
    .not("delivered_at", "is", null)
    .lte("delivered_at", cutoff)
    .not("discord_channel_id", "is", null)
    .order("delivered_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("Review timeout query error:", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const order of orders ?? []) {
    try {
      const { data: review } = await sb
        .from("reviews")
        .select("id")
        .eq("order_id", order.id)
        .maybeSingle();

      if (review) {
        skipped++;
        continue;
      }

      const { data: timeoutEvent } = await sb
        .from("order_events")
        .select("id")
        .eq("order_id", order.id)
        .eq("event_type", "review_timeout_channel_deleted")
        .maybeSingle();

      if (timeoutEvent) {
        skipped++;
        continue;
      }

      try {
        await discordRequest(`/channels/${order.discord_channel_id}`, {
          method: "DELETE"
        });
      } catch (error: any) {
        const message = String(error?.message || error);

        // Canal já apagado é considerado concluído.
        if (!message.includes("Discord 404")) {
          throw error;
        }
      }

      await sb.from("order_events").insert({
        order_id: order.id,
        event_type: "review_timeout_channel_deleted",
        description: "Canal do pedido apagado após 5 minutos sem avaliação.",
        metadata: {
          timeout_minutes: 5,
          deleted_at: new Date().toISOString()
        }
      });

      deleted++;
    } catch (error: any) {
      console.error("Review timeout error:", order.id, error);
      errors.push(`#${order.order_number}: ${String(error?.message || error).slice(0, 300)}`);
    }
  }

  return Response.json({
    ok: true,
    checked: orders?.length ?? 0,
    deleted,
    skipped,
    errors
  });
}
