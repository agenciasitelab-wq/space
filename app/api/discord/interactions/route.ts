import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import { createClient } from "@supabase/supabase-js";

const MIN_ROBUX = 150;

function verifyDiscordSignature(body: string, signature: string | null, timestamp: string | null) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
  } catch {
    return false;
  }
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function button(custom_id: string, label: string, emoji: string, style = 1) {
  return { type: 2, style, label, emoji: { name: emoji }, custom_id };
}

function modal(custom_id: string, title: string, customId: string, label: string, placeholder: string) {
  return {
    type: 9,
    data: {
      custom_id,
      title,
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: customId,
          label,
          style: 1,
          min_length: 1,
          max_length: 50,
          required: true,
          placeholder
        }]
      }]
    }
  };
}

function ephemeral(content: string, components: any[] = []) {
  return {
    type: 4,
    data: {
      flags: 64,
      content,
      ...(components.length ? { components } : {})
    }
  };
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function interactionResponse(body: any) {
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifyDiscordSignature(
    raw,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp")
  );

  if (!ok) return new NextResponse("invalid request signature", { status: 401 });

  let interaction: any;
  try {
    interaction = JSON.parse(raw);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (interaction.type === 1) {
    return interactionResponse({ type: 1 });
  }

  const data = interaction.data ?? {};
  const customId = data.custom_id as string | undefined;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  if (!customId || !userId) {
    return interactionResponse(ephemeral("❌ Não foi possível identificar sua conta Discord."));
  }

  // 1) Painel -> quantidade
  if (customId === "space_buy_robux") {
    return interactionResponse(
      modal(
        "space_robux_amount",
        "Comprar Robux",
        "robux_amount",
        "Quantidade de Robux",
        "Ex.: 150, 500, 1000"
      )
    );
  }

  // 2) Quantidade -> botão para abrir formulário Roblox
  if (customId === "space_robux_amount") {
    const rawAmount = String(data.components?.[0]?.components?.[0]?.value ?? "").trim();
    const amount = Number(rawAmount);

    if (!Number.isInteger(amount) || amount < MIN_ROBUX) {
      return interactionResponse(ephemeral(`❌ Informe uma quantidade inteira de pelo menos **${MIN_ROBUX} Robux**.`));
    }

    if (amount > 1000000) {
      return interactionResponse(ephemeral("❌ Para pedidos acima de 1.000.000 Robux, fale com o suporte."));
    }

    return interactionResponse(ephemeral(
      `🪙 Quantidade: **${amount.toLocaleString("pt-BR")} Robux**\\n\\nAgora informe a conta Roblox que receberá os Robux.`,
      [[button(`space_roblox_next:${amount}`, "INFORMAR ROBLOX", "🎮")]]
    ));
  }

  // 3) Botão -> usuário Roblox
  if (customId.startsWith("space_roblox_next:")) {
    const amount = Number(customId.split(":")[1]);
    if (!Number.isInteger(amount) || amount < MIN_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    return interactionResponse(
      modal(
        `space_roblox_user:${amount}`,
        "Conta Roblox",
        "roblox_username",
        "Usuário Roblox",
        "Digite seu username do Roblox"
      )
    );
  }

  // 4) Usuário Roblox -> métodos
  if (customId.startsWith("space_roblox_user:")) {
    const amount = Number(customId.split(":")[1]);
    const username = String(data.components?.[0]?.components?.[0]?.value ?? "").trim();

    if (!Number.isInteger(amount) || amount < MIN_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return interactionResponse(ephemeral("❌ Username Roblox inválido. Use de 3 a 20 caracteres: letras, números ou _."));
    }

    const encodedUser = encode(username);

    return interactionResponse(ephemeral(
      `🎮 Conta Roblox: **${username}**\\n🪙 Robux: **${amount.toLocaleString("pt-BR")}**\\n\\nEscolha como deseja receber:`,
      [
        [
          button(`space_method:plus:${amount}:${encodedUser}`, "PLUS", "💎"),
          button(`space_method:group:${amount}:${encodedUser}`, "GRUPO", "👥")
        ],
        [
          button(`space_method:gamepass_fee:${amount}:${encodedUser}`, "GAMEPASS + TAXA", "🎮"),
          button(`space_method:gamepass_no_fee:${amount}:${encodedUser}`, "GAMEPASS SEM TAXA", "🎮")
        ]
      ]
    ));
  }

  // 5) Método -> resumo + termos
  if (customId.startsWith("space_method:")) {
    const parts = customId.split(":");
    const method = parts[1];
    const amount = Number(parts[2]);
    const username = decode(parts.slice(3).join(":"));

    const validMethods = ["plus", "group", "gamepass_fee", "gamepass_no_fee"];
    if (!validMethods.includes(method) || !Number.isInteger(amount) || amount < MIN_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: pricing, error } = await sb
      .from("pricing")
      .select("method,display_name,price_per_1000")
      .eq("method", method)
      .eq("active", true)
      .single();

    if (error || !pricing) {
      return interactionResponse(ephemeral("❌ Este método de entrega está temporariamente indisponível."));
    }

    const rate = Number(pricing.price_per_1000);
    const total = Math.round((amount / 1000) * rate * 100) / 100;
    const expected = method === "gamepass_no_fee" ? Math.floor(amount * 0.70) : amount;
    const encodedUser = encode(username);
    const termsId = `space_terms:${method}:${amount}:${encodedUser}`;

    const extra = method === "gamepass_fee"
      ? `\\n💡 A SPACE Rewards absorve a taxa do Roblox para você receber os **${amount.toLocaleString("pt-BR")} Robux líquidos**.`
      : method === "gamepass_no_fee"
        ? `\\n⚠️ Neste método, o Roblox desconta 30%. Compra de ${amount.toLocaleString("pt-BR")} resulta em aproximadamente **${expected.toLocaleString("pt-BR")} Robux recebidos**.`
        : "";

    return interactionResponse(ephemeral(
      `🚀 **SPACE REWARDS — RESUMO**\\n\\n🪙 Robux: **${amount.toLocaleString("pt-BR")}**\\n🎮 Roblox: **${username}**\\n📦 Método: **${pricing.display_name}**\\n💵 Valor: **${money(total)}**${extra}\\n\\n📜 Ao continuar, você confirma que leu e aceita os termos da compra.`,
      [[
        button(termsId, "ACEITAR E CONTINUAR", "✅"),
        button("space_cancel_order", "CANCELAR", "❌", 4)
      ]]
    ));
  }

  // 6) Termos -> cria pedido
  if (customId.startsWith("space_terms:")) {
    const parts = customId.split(":");
    const method = parts[1];
    const amount = Number(parts[2]);
    const username = decode(parts.slice(3).join(":"));
    const validMethods = ["plus", "group", "gamepass_fee", "gamepass_no_fee"];

    if (!validMethods.includes(method) || !Number.isInteger(amount) || amount < MIN_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido."));
    }

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: user, error: userError } = await sb
      .from("users")
      .select("id,verified")
      .eq("discord_id", userId)
      .single();

    if (userError || !user?.verified) {
      return interactionResponse(ephemeral("❌ Sua conta precisa estar verificada antes de comprar."));
    }

    const { data: pricing, error: pricingError } = await sb
      .from("pricing")
      .select("display_name,price_per_1000")
      .eq("method", method)
      .eq("active", true)
      .single();

    if (pricingError || !pricing) {
      return interactionResponse(ephemeral("❌ Este método está indisponível."));
    }

    const rate = Number(pricing.price_per_1000);
    const total = Math.round((amount / 1000) * rate * 100) / 100;
    const expected = method === "gamepass_no_fee" ? Math.floor(amount * 0.70) : amount;

    const { data: order, error: orderError } = await sb
      .from("orders")
      .insert({
        user_id: user.id,
        robux_amount: amount,
        roblox_username: username,
        delivery_method: method,
        price_per_1000: rate,
        total_price: total,
        expected_received_robux: expected,
        terms_accepted_at: new Date().toISOString(),
        status: "awaiting_payment",
        payment_provider: "asaas"
      })
      .select("id,order_number,total_price,status")
      .single();

    if (orderError || !order) {
      console.error("Order creation error:", orderError);
      return interactionResponse(ephemeral("❌ Não foi possível criar seu pedido. Tente novamente."));
    }

    await sb.from("order_events").insert({
      order_id: order.id,
      event_type: "order_created",
      description: "Pedido criado pelo fluxo de compra do Discord.",
      metadata: { discord_id: userId, method, robux_amount: amount }
    });

    return interactionResponse(ephemeral(
      `✅ **Pedido #${order.order_number} criado!**\\n\\n🪙 Robux: **${amount.toLocaleString("pt-BR")}**\\n🎮 Roblox: **${username}**\\n📦 Método: **${pricing.display_name}**\\n💵 Total: **${money(Number(order.total_price))}**\\n\\n💳 **Próximo passo:** gerar o pagamento.\\n\\nSeu pedido foi registrado como **aguardando pagamento**.`,
      [[button(`space_pay:${order.id}`, "PAGAR PEDIDO", "💳")]]
    ));
  }

  if (customId === "space_cancel_order") {
    return interactionResponse(ephemeral("❌ Compra cancelada. Você pode iniciar uma nova compra pelo painel."));
  }

  // Pagamento será conectado ao Asaas na próxima etapa.
  if (customId.startsWith("space_pay:")) {
    return interactionResponse(ephemeral("💳 O pagamento automático será liberado na próxima etapa, quando conectarmos o Asaas."));
  }

  return interactionResponse(ephemeral("❌ Ação não reconhecida. Inicie a compra novamente."));
}
