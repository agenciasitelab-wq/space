import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function money(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function label(method: string) {
  switch (method) {
    case "group": return "Robux via grupo";
    case "plus": return "Robux via plus";
    case "gamepass_fee": return "Robux via gamepass + taxa";
    case "gamepass_no_fee": return "Robux via gamepass sem taxa";
    default: return method;
  }
}

function received(amount: number, method: string) {
  return method === "gamepass_no_fee" ? Math.floor(amount * 0.7) : amount;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawAmount = Number(url.searchParams.get("amount"));
  const amount = Number.isInteger(rawAmount) ? rawAmount : 0;

  if (amount < 50 || amount > 1_000_000) {
    return new Response("Quantidade inválida.", { status: 400 });
  }

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await sb
    .from("pricing")
    .select("method,price_per_1000,active")
    .in("method", ["group", "plus", "gamepass_fee", "gamepass_no_fee"])
    .eq("active", true);

  const order = ["group", "plus", "gamepass_fee", "gamepass_no_fee"];
  const pricing = (data ?? [])
    .sort((a: any, b: any) => order.indexOf(a.method) - order.indexOf(b.method))
    .map((item: any) => ({
      method: String(item.method),
      price: Math.round((amount / 1000) * Number(item.price_per_1000) * 100) / 100
    }));

  const rows = pricing.length ? pricing : [{ method: "plus", price: 0 }];

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "675px",
          display: "flex",
          flexDirection: "column",
          background: "#0b0d10",
          color: "#f4f5f7",
          padding: "58px 60px",
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, color: "#8f949d", marginBottom: 6 }}>
              SPACE Rewards
            </div>
            <div style={{ fontSize: 43, fontWeight: 800 }}>
              Preço estimado para {amount.toLocaleString("pt-BR")} Robux
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "13px 22px",
              border: "1px solid #30343b",
              borderRadius: 18,
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {amount.toLocaleString("pt-BR")} Robux
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 42,
            border: "1px solid #292d34",
            borderRadius: 22,
            overflow: "hidden",
            background: "#15181e",
          }}
        >
          {rows.map((row: any, index: number) => (
            <div
              key={row.method}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 30px",
                borderBottom: index === rows.length - 1 ? "none" : "1px solid #292d34",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{label(row.method)}</div>
                <div style={{ fontSize: 17, color: "#9298a2", marginTop: 5 }}>
                  {received(amount, row.method).toLocaleString("pt-BR")} Robux {row.method === "gamepass_no_fee" ? "recebidos após a taxa" : "exatos"}
                </div>
              </div>
              <div style={{ fontSize: 31, fontWeight: 800 }}>{money(row.price)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: 24, fontSize: 16, color: "#6f747d" }}>
          Limite atual de 1.000.000 Robux por cálculo • valores conforme a tabela de preços do SPACE Rewards
        </div>
      </div>
    ),
    { width: 1200, height: 675 }
  );
}
