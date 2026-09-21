import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import { createClient } from "@supabase/supabase-js";

const MIN_ROBUX = 150;
const MAX_ROBUX = 1_000_000;

const VALID_METHODS = ["plus", "group", "gamepass_fee", "gamepass_no_fee"] as const;
type DeliveryMethod = (typeof VALID_METHODS)[number];

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
  return {
    type: 2,
    style,
    label,
    emoji: { name: emoji },
    custom_id
  };
}

function modal(
  custom_id: string,
  title: string,
  customId: string,
  label: string,
  placeholder: string,
  maxLength = 50
) {
  return {
    type: 9,
    data: {
      custom_id,
      title,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: customId,
              label,
              style: 1,
              min_length: 1,
              max_length: maxLength,
              required: true,
              placeholder
            }
          ]
        }
      ]
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
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function getModalValue(data: any, customId: string) {
  for (const row of data.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId) {
        return String(component.value ?? "").trim();
      }
    }
  }
  return "";
}

function normalizeMethod(value: string): DeliveryMethod | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "1" || normalized === "plus") return "plus";
  if (normalized === "2" || normalized === "grupo" || normalized === "group") return "group";
  if (
    normalized === "3" ||
    normalized === "gamepass + taxa" ||
    normalized === "gamepass_fee" ||
    normalized === "gamepass com taxa"
  ) {
    return "gamepass_fee";
  }
  if (
    normalized === "4" ||
    normalized === "gamepass sem taxa" ||
    normalized === "gamepass_no_fee"
  ) {
    return "gamepass_no_fee";
  }

  return null;
}

function methodLabel(method: DeliveryMethod) {
  switch (method) {
    case "plus":
      return "💎 PLUS";
    case "group":
      return "👥 GRUPO";
    case "gamepass_fee":
      return "🎮 GAMEPASS + TAXA";
    case "gamepass_no_fee":
      return "🎮 GAMEPASS SEM TAXA";
  }
}

function purchaseSummary(
  amount: number,
  username?: string,
  method?: DeliveryMethod,
  total?: number
) {
  const userLine = username ? `🎮 Roblox: **${username}**` : "🎮 Roblox: **Não informado**";
  const methodLine = method
    ? `📦 Forma de envio: **${methodLabel(method)}**`
    : "📦 Forma de envio: **Não informado**";
  const priceLine =
    typeof total === "number"
      ? `💵 Valor: **${money(total)}**`
      : "💵 Valor: **Aguardando forma de envio**";

  return [
    "🚀 **SPACE REWARDS — SEU PEDIDO**",
    "",
    `🪙 Robux: **${amount.toLocaleString("pt-BR")}**`,
    userLine,
    methodLine,
    priceLine,
    "",
    "Preencha os dados abaixo e depois clique em **CONCLUIR**."
  ].join("\n");
}

function purchaseButtons(
  amount: number,
  username?: string,
  method?: DeliveryMethod
) {
  const encodedUser = username ? encode(username) : "_";

  return [
    {
      type: 1,
      components: [
        button(
          `space_set_username:${amount}:${encodedUser}`,
          username ? "ALTERAR ROBLOX" : "USUÁRIO ROBLOX",
          "🎮"
        ),
        button(
          `space_set_method:${amount}:${encodedUser}`,
          method ? "ALTERAR ENVIO" : "FORMA DE ENVIO",
          "📦"
        )
      ]
    },
    {
      type: 1,
      components: [
        button(
          `space_finish:${amount}:${encodedUser}:${method ?? "_"}`,
          "CONCLUIR",
          "✅"
        ),
        button("space_cancel_order", "CANCELAR", "❌", 4)
      ]
    }
  ];
}

async function interactionResponse(body: any) {
  return NextResponse.json(body);
}

async function getPricing(method: DeliveryMethod) {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await sb
    .from("pricing")
    .select("method,display_name,price_per_1000")
    .eq("method", method)
    .eq("active", true)
    .single();

  if (error || !data) return null;

  const rate = Number(data.price_per_1000);
  return {
    displayName: String(data.display_name),
    rate
  };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const ok = verifyDiscordSignature(
    raw,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp")
  );

  if (!ok) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

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
    return interactionResponse(
      ephemeral("❌ Não foi possível identificar sua conta Discord.")
    );
  }

  // 1) Painel -> modal de quantidade
  if (customId === "space_buy_robux") {
    return interactionResponse(
      modal(
        "space_robux_amount",
        "Comprar Robux",
        "robux_amount",
        "Quantidade de Robux",
        "Ex.: 150, 500, 1000",
        10
      )
    );
  }

  // 2) Quantidade -> teste com botão simples, sem emoji
  if (customId === "space_robux_amount") {
    const rawAmount = getModalValue(data, "robux_amount");
    const amount = Number(rawAmount);

    if (!Number.isInteger(amount) || amount < MIN_ROBUX) {
      return interactionResponse(
        ephemeral(
          `❌ Informe uma quantidade inteira de pelo menos **${MIN_ROBUX} Robux**.`
        )
      );
    }

    if (amount > MAX_ROBUX) {
      return interactionResponse(
        ephemeral(
          "❌ Para pedidos acima de 1.000.000 Robux, fale com o suporte."
        )
      );
    }

    return interactionResponse(
      ephemeral(
        `✅ Quantidade: **${amount.toLocaleString("pt-BR")} Robux**`,
        [{
          type: 1,
          components: [{
            type: 2,
            style: 1,
            label: "USUÁRIO ROBLOX",
            custom_id: `space_set_username:${amount}:_`
          }]
        }]
      )
    );
  }

  // 3) Botão Usuário Roblox -> modal
  if (customId.startsWith("space_set_username:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const currentUsername = parts[2] && parts[2] !== "_" ? decode(parts[2]) : "";

    if (!Number.isInteger(amount) || amount < MIN_ROBUX || amount > MAX_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    return interactionResponse(
      modal(
        `space_username_submit:${amount}:${encode(currentUsername || "_")}`,
        "Conta Roblox",
        "roblox_username",
        "Usuário Roblox",
        currentUsername || "Digite seu username do Roblox",
        20
      )
    );
  }

  // 4) Submit do usuário -> novo resumo com nome preenchido
  if (customId.startsWith("space_username_submit:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const username = getModalValue(data, "roblox_username");

    if (!Number.isInteger(amount) || amount < MIN_ROBUX || amount > MAX_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return interactionResponse(
        ephemeral(
          "❌ Username Roblox inválido. Use de 3 a 20 caracteres: letras, números ou _."
        )
      );
    }

    const encodedUser = encode(username);

    return interactionResponse(
      ephemeral(
        purchaseSummary(amount, username),
        purchaseButtons(amount, username)
      )
    );
  }

  // 5) Botão Forma de envio -> modal
  if (customId.startsWith("space_set_method:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const encodedUser = parts[2] ?? "_";
    const username = encodedUser !== "_" ? decode(encodedUser) : "";

    if (!Number.isInteger(amount) || amount < MIN_ROBUX || amount > MAX_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    return interactionResponse(
      modal(
        `space_method_submit:${amount}:${encodedUser}`,
        "Forma de envio",
        "delivery_method",
        "Escolha a forma de envio",
        "1 PLUS | 2 GRUPO | 3 GAMEPASS + TAXA | 4 GAMEPASS SEM TAXA",
        30
      )
    );
  }

  // 6) Submit da forma de envio -> calcula preço e mostra resumo
  if (customId.startsWith("space_method_submit:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const encodedUser = parts[2] ?? "_";
    const username = encodedUser !== "_" ? decode(encodedUser) : "";
    const method = normalizeMethod(getModalValue(data, "delivery_method"));

    if (!Number.isInteger(amount) || amount < MIN_ROBUX || amount > MAX_ROBUX) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    if (!method) {
      return interactionResponse(
        ephemeral(
          "❌ Forma de envio inválida. Use:\n**1** PLUS\n**2** GRUPO\n**3** GAMEPASS + TAXA\n**4** GAMEPASS SEM TAXA"
        )
      );
    }

    const pricing = await getPricing(method);
    if (!pricing) {
      return interactionResponse(
        ephemeral("❌ Esta forma de envio está temporariamente indisponível.")
      );
    }

    const total = Math.round((amount / 1000) * pricing.rate * 100) / 100;

    return interactionResponse(
      ephemeral(
        purchaseSummary(amount, username || undefined, method, total),
        purchaseButtons(amount, username || undefined, method)
      )
    );
  }

  // 7) Concluir -> valida tudo e cria pedido
  if (customId.startsWith("space_finish:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const encodedUser = parts[2] ?? "_";
    const method = parts[3] && parts[3] !== "_" ? (parts[3] as DeliveryMethod) : null;
    const username = encodedUser !== "_" ? decode(encodedUser) : "";

    if (
      !Number.isInteger(amount) ||
      amount < MIN_ROBUX ||
      amount > MAX_ROBUX ||
      !username ||
      !/^[A-Za-z0-9_]{3,20}$/.test(username) ||
      !method ||
      !VALID_METHODS.includes(method)
    ) {
      return interactionResponse(
        ephemeral(
          "❌ Antes de concluir, informe o **Usuário Roblox** e a **Forma de envio**."
        )
      );
    }

    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: user, error: userError } = await sb
      .from("users")
      .select("id,verified")
      .eq("discord_id", userId)
      .single();

    if (userError || !user?.verified) {
      return interactionResponse(
        ephemeral("❌ Sua conta precisa estar verificada antes de comprar.")
      );
    }

    const pricing = await getPricing(method);
    if (!pricing) {
      return interactionResponse(ephemeral("❌ Este método está indisponível."));
    }

    const total = Math.round((amount / 1000) * pricing.rate * 100) / 100;
    const expected =
      method === "gamepass_no_fee" ? Math.floor(amount * 0.70) : amount;

    const { data: order, error: orderError } = await sb
      .from("orders")
      .insert({
        user_id: user.id,
        robux_amount: amount,
        roblox_username: username,
        delivery_method: method,
        price_per_1000: pricing.rate,
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
      return interactionResponse(
        ephemeral("❌ Não foi possível criar seu pedido. Tente novamente.")
      );
    }

    await sb.from("order_events").insert({
      order_id: order.id,
      event_type: "order_created",
      description: "Pedido criado pelo fluxo de compra do Discord.",
      metadata: {
        discord_id: userId,
        method,
        robux_amount: amount
      }
    });

    return interactionResponse(
      ephemeral(
        [
          `✅ **Pedido #${order.order_number} criado!**`,
          "",
          `🪙 Robux: **${amount.toLocaleString("pt-BR")}**`,
          `🎮 Roblox: **${username}**`,
          `📦 Método: **${pricing.displayName}**`,
          `💵 Total: **${money(Number(order.total_price))}**`,
          "",
          "💳 **Próximo passo:** gerar o pagamento.",
          "Seu pedido foi registrado como **aguardando pagamento**."
        ].join("\n"),
        [{
          type: 1,
          components: [button(`space_pay:${order.id}`, "PAGAR PEDIDO", "💳")]
        }]
      )
    );
  }

  if (customId === "space_cancel_order") {
    return interactionResponse(
      ephemeral("❌ Compra cancelada. Você pode iniciar uma nova compra pelo painel.")
    );
  }

  // Pagamento será conectado ao Asaas na próxima etapa.
  if (customId.startsWith("space_pay:")) {
    return interactionResponse(
      ephemeral(
        "💳 O pagamento automático será liberado na próxima etapa, quando conectarmos o Asaas."
      )
    );
  }

  return interactionResponse(
    ephemeral("❌ Ação não reconhecida. Inicie a compra novamente.")
  );
}
