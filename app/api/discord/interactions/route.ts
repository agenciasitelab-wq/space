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

function ephemeral(content: string, components: any[] = [], embeds: any[] = []) {
  return {
    type: 4,
    data: {
      flags: 64,
      ...(content ? { content } : {}),
      ...(embeds.length ? { embeds } : {}),
      ...(components.length ? { components } : {})
    }
  };
}

function publicMessage(content: string, components: any[] = [], embeds: any[] = []) {
  return {
    type: 4,
    data: {
      ...(content ? { content } : {}),
      ...(embeds.length ? { embeds } : {}),
      ...(components.length ? { components } : {})
    }
  };
}

function updateMessage(content: string, components: any[] = [], embeds: any[] = []) {
  return {
    type: 7,
    data: {
      ...(content ? { content } : {}),
      ...(embeds.length ? { embeds } : {}),
      ...(components.length ? { components } : {})
    }
  };
}

function purchaseEmbed(
  amount: number,
  username?: string,
  method?: DeliveryMethod,
  total?: number,
  status = "🟡 ABERTO"
) {
  const methodText = method ? methodLabel(method) : "Aguardando escolha";
  const priceText =
    typeof total === "number" ? money(total) : "Aguardando forma de envio";

  return {
    title: "🚀 SPACE REWARDS • SEU PEDIDO",
    description:
      "Confira os dados abaixo. Você pode alterar qualquer informação antes de concluir.",
    color: status.startsWith("🟢") ? 0x57f287 : status.startsWith("🔴") ? 0xed4245 : 0xfee75c,
    fields: [
      { name: "🪙 Robux", value: `**${amount.toLocaleString("pt-BR")}**`, inline: true },
      { name: "🎮 Roblox", value: username ? `**${username}**` : "Ainda não informado", inline: true },
      { name: "📦 Forma de envio", value: `**${methodText}**`, inline: false },
      { name: "💵 Total", value: `**${priceText}**`, inline: true },
      { name: "📌 Status", value: `**${status}**`, inline: true }
    ],
    footer: { text: "SPACE Rewards • Compra de Robux" }
  };
}

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

const VIEW_CHANNEL = 1024;
const SEND_MESSAGES = 2048;
const READ_MESSAGE_HISTORY = 65536;
const EMBED_LINKS = 16384;

async function createPaymentChannel(
  order: any,
  discordUserId: string,
  amount: number,
  username: string,
  method: DeliveryMethod,
  total: number
) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID não configurado");

  const channels = await discordRequest(`/guilds/${guildId}/channels`, { method: "GET" });
  const supportCategory = (channels as any[]).find(
    (channel) => channel.type === 4 && channel.name === "🎫・SUPORTE"
  );

  if (!supportCategory) {
    throw new Error('Categoria "🎫・SUPORTE" não encontrada no servidor.');
  }

  const roles = await discordRequest(`/guilds/${guildId}/roles`, { method: "GET" });
  const allowedRoleNames = new Set([
    "🎫・SPACE SUPPORT",
    "🛡️・SPACE STAFF",
    "💰・SPACE SELLER",
    "🌌・SPACE DIRECTOR",
    "👑・SPACE FOUNDER"
  ]);

  const allowedRoleIds = (roles as any[])
    .filter((role) => allowedRoleNames.has(role.name))
    .map((role) => role.id);

  const me = await discordRequest("/users/@me", { method: "GET" });

  const permission_overwrites = [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(VIEW_CHANNEL)
    },
    {
      id: discordUserId,
      type: 1,
      allow: String(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | EMBED_LINKS),
      deny: "0"
    },
    {
      id: me.id,
      type: 1,
      allow: String(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | EMBED_LINKS),
      deny: "0"
    },
    ...allowedRoleIds.map((roleId: string) => ({
      id: roleId,
      type: 0,
      allow: String(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | EMBED_LINKS),
      deny: "0"
    }))
  ];

  const channel = await discordRequest(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: `🟡・pedido-${order.order_number}`,
      type: 0,
      parent_id: supportCategory.id,
      topic: `SPACE Rewards • Pedido #${order.order_number} • ${username}`,
      permission_overwrites
    })
  });

  await discordRequest(`/channels/${channel.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      embeds: [{
        ...purchaseEmbed(amount, username, method, total, "🟡 ABERTO"),
        title: `🟡 SPACE REWARDS • PEDIDO #${order.order_number}`
      }],
      components: [{
        type: 1,
        components: [
          button(`space_pay:${order.id}`, "GERAR PIX", "💳"),
          button(`space_cancel_payment:${order.id}`, "CANCELAR PEDIDO", "❌", 4)
        ]
      }]
    })
  });

  return channel;
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
          `space_set_username:${amount}:${encodedUser}:${method ?? "_"}`,
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


async function asaasRequest(path: string, init: RequestInit = {}) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error("ASAAS_API_KEY não configurada");
  const baseUrl =
    process.env.ASAAS_API_BASE_URL || "https://api-sandbox.asaas.com/v3";

  const hasBody = init.body !== undefined && init.body !== null;

  const response = await fetch(baseUrl + path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(hasBody ? { "content-type": "application/json" } : {}),
      access_token: apiKey,
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) {
    console.error("Asaas API error:", {
      path,
      status: response.status,
      data
    });

    const description =
      data?.errors?.[0]?.description ||
      data?.message ||
      ("Asaas HTTP " + response.status);

    throw new Error(
      "Asaas " + response.status + " em " + path + ": " + description
    );
  }
  return data;
}
function normalizeCpf(value: string) { return value.replace(/[^0-9]/g, ""); }
function validCpf(value: string) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11; if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;
  sum = 0; for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11; if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
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
        "",
        purchaseButtons(amount),
        [purchaseEmbed(amount)]
      )
    );
  }

  // 3) Botão Usuário Roblox -> modal
  if (customId.startsWith("space_set_username:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const currentUsername = parts[2] && parts[2] !== "_" ? decode(parts[2]) : "";
    const currentMethod =
      parts[3] && parts[3] !== "_" ? (parts[3] as DeliveryMethod) : null;

    if (
      !Number.isInteger(amount) ||
      amount < MIN_ROBUX ||
      amount > MAX_ROBUX ||
      (currentMethod && !VALID_METHODS.includes(currentMethod))
    ) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    return interactionResponse(
      modal(
        `space_username_submit:${amount}:${encode(currentUsername || "_")}:${currentMethod ?? "_"}`,
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
    const currentMethod =
      parts[3] && parts[3] !== "_" ? (parts[3] as DeliveryMethod) : null;
    const username = getModalValue(data, "roblox_username");

    if (
      !Number.isInteger(amount) ||
      amount < MIN_ROBUX ||
      amount > MAX_ROBUX ||
      (currentMethod && !VALID_METHODS.includes(currentMethod))
    ) {
      return interactionResponse(ephemeral("❌ Pedido inválido. Inicie a compra novamente."));
    }

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return interactionResponse(
        updateMessage(
          "❌ **Username Roblox inválido.** Use de 3 a 20 caracteres: letras, números ou _.",
          purchaseButtons(amount, undefined, currentMethod || undefined),
          [purchaseEmbed(amount, undefined, currentMethod || undefined)]
        )
      );
    }

    return interactionResponse(
      updateMessage(
        "",
        purchaseButtons(amount, username, currentMethod || undefined),
        [purchaseEmbed(amount, username, currentMethod || undefined)]
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
        updateMessage(
          "❌ **Forma de envio inválida.** Use: **1** PLUS • **2** GRUPO • **3** GAMEPASS + TAXA • **4** GAMEPASS SEM TAXA",
          purchaseButtons(amount, username || undefined),
          [purchaseEmbed(amount, username || undefined)]
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
      updateMessage(
        "",
        purchaseButtons(amount, username || undefined, method),
        [purchaseEmbed(amount, username || undefined, method, total)]
      )
    );
  }

  // 7) Concluir -> cria o pedido e abre um canal privado para pagamento.
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

    try {
      const channel = await createPaymentChannel(
        order,
        userId,
        amount,
        username,
        method,
        total
      );

      await sb.from("orders")
        .update({ discord_channel_id: channel.id })
        .eq("id", order.id);

      await sb.from("order_events").insert({
        order_id: order.id,
        event_type: "payment_channel_created",
        description: "Canal privado do pedido criado no Discord.",
        metadata: { channel_id: channel.id }
      });

      return interactionResponse(
        updateMessage(
          "",
          [{
            type: 1,
            components: [{
              type: 2,
              style: 5,
              label: "ABRIR MEU PEDIDO",
              url: `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${channel.id}`
            }]
          }],
          [{
            ...purchaseEmbed(amount, username, method, total, "🟡 ABERTO"),
            title: `🟡 PEDIDO #${order.order_number} ABERTO`,
            description: "Seu pedido foi criado. Abra o canal privado abaixo para gerar o PIX e acompanhar o pagamento."
          }]
        )
      );
    } catch (error: any) {
      console.error("Payment channel creation error:", error);
      await sb.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      await sb.from("order_events").insert({
        order_id: order.id,
        event_type: "payment_channel_failed",
        description: "Não foi possível criar o canal privado do pedido.",
        metadata: { error: String(error) }
      });
      return interactionResponse(
        ephemeral(
          "❌ Não consegui abrir o canal privado do seu pedido. O pedido foi cancelado para evitar cobrança sem canal."
        )
      );
    }
  }

  if (customId.startsWith("space_cancel_payment:")) {
    const orderId = customId.slice("space_cancel_payment:".length);
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: order } = await sb
      .from("orders")
      .select("id,status,user_id")
      .eq("id", orderId)
      .single();

    if (!order) return interactionResponse(ephemeral("❌ Pedido não encontrado."));
    const { data: owner } = await sb.from("users").select("discord_id").eq("id", order.user_id).single();
    if (owner?.discord_id !== userId) return interactionResponse(ephemeral("❌ Você não pode cancelar este pedido."));

    if (order.status === "awaiting_payment" || order.status === "payment_pending") {
      await sb.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      await sb.from("order_events").insert({
        order_id: order.id,
        event_type: "order_cancelled",
        description: "Pedido cancelado pelo comprador."
      });

      const channelId = interaction.channel_id;
      if (channelId) {
        try {
          await discordRequest(`/channels/${channelId}`, {
            method: "PATCH",
            body: JSON.stringify({ name: `🔴・pedido-cancelado-${order.id.slice(0, 6)}` })
          });
        } catch (error) {
          console.error("Cancel channel rename error:", error);
        }
      }

      return interactionResponse(ephemeral("🔴 Pedido cancelado."));
    }

    return interactionResponse(ephemeral(`❌ Este pedido não pode mais ser cancelado. Status: **${order.status}**`));
  }

  if (customId === "space_cancel_order") {
    return interactionResponse(
      updateMessage(
        "❌ **Compra cancelada.** Você pode iniciar uma nova compra pelo painel.",
        [],
        []
      )
    );
  }

  // Pagamento -> solicita CPF e cria cobrança PIX no Asaas.
  if (customId.startsWith("space_pay:")) {
    const orderId = customId.slice("space_pay:".length);
    if (!orderId) return interactionResponse(ephemeral("❌ Pedido inválido."));

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: order } = await sb.from("orders")
      .select("id,status,discord_channel_id,user_id")
      .eq("id", orderId)
      .single();

    if (!order || order.discord_channel_id !== interaction.channel_id) {
      return interactionResponse(ephemeral("❌ Este pagamento só pode ser iniciado no canal do próprio pedido."));
    }

    const { data: owner } = await sb.from("users").select("discord_id").eq("id", order.user_id).single();
    if (owner?.discord_id !== userId) {
      return interactionResponse(ephemeral("❌ Apenas o comprador pode iniciar o pagamento."));
    }

    if (order.status !== "awaiting_payment" && order.status !== "payment_pending") {
      return interactionResponse(ephemeral(`❌ Este pedido está **${order.status}**.`));
    }

    return interactionResponse(modal(
      `space_cpf_submit:${orderId}`,
      "Pagamento PIX",
      "cpf",
      "CPF do pagador",
      "Somente números ou com pontuação",
      14
    ));
  }

  if (customId.startsWith("space_cpf_submit:")) {
    const orderId = customId.slice("space_cpf_submit:".length);
    const cpf = normalizeCpf(getModalValue(data, "cpf"));
    if (!validCpf(cpf)) return interactionResponse(ephemeral("❌ CPF inválido. Confira os números e tente novamente."));

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: order, error: orderError } = await sb.from("orders")
      .select("id,order_number,total_price,status,payment_id,robux_amount,roblox_username,user_id")
      .eq("id", orderId).single();
    if (orderError || !order) return interactionResponse(ephemeral("❌ Pedido não encontrado."));
    if (order.status !== "awaiting_payment" && order.status !== "payment_pending") {
      return interactionResponse(ephemeral(`❌ Este pedido está com status **${order.status}** e não pode gerar um novo pagamento.`));
    }

    const { data: user, error: userError } = await sb.from("users")
      .select("id,discord_id,discord_username,discord_email,verified")
      .eq("id", order.user_id).single();
    if (userError || !user?.verified || user.discord_id !== userId) {
      return interactionResponse(ephemeral("❌ Não foi possível validar o comprador."));
    }
    if (!user.discord_email) return interactionResponse(ephemeral("❌ Sua conta não possui e-mail registrado. Refazer a verificação do Discord pode resolver isso."));

    try {
      let paymentId = order.payment_id as string | null;
      let payment: any = null;
      let customerId: string | null = null;

      // Se já existe uma cobrança criada, reutilizamos a mesma.
      // Isso evita cobranças duplicadas quando a recuperação do QR Code falha.
      if (paymentId) {
        payment = await asaasRequest("/payments/" + paymentId, { method: "GET" });
        customerId = payment?.customer ?? null;

        if (
          payment?.status === "RECEIVED" ||
          payment?.status === "CONFIRMED" ||
          payment?.status === "RECEIVED_IN_CASH"
        ) {
          return interactionResponse(
            ephemeral(
              `✅ **O pagamento do pedido #${order.order_number} já foi confirmado.**\\n\\nO SPACE Rewards está processando seu pedido.`
            )
          );
        }
      } else {
        // O Asaas permite clientes duplicados; procuramos pelo CPF antes de criar.
        const customers = await asaasRequest(
          "/customers?cpfCnpj=" + encodeURIComponent(cpf) + "&limit=1",
          { method: "GET" }
        );

        let customer = customers?.data?.[0] ?? null;

        if (!customer) {
          customer = await asaasRequest("/customers", {
            method: "POST",
            body: JSON.stringify({
              name: user.discord_username || ("SPACE " + userId),
              cpfCnpj: cpf,
              email: user.discord_email,
              externalReference: "space-user-" + user.id,
              notificationDisabled: false
            })
          });
        }

        customerId = customer.id;

        payment = await asaasRequest("/payments", {
          method: "POST",
          body: JSON.stringify({
            customer: customer.id,
            billingType: "PIX",
            value: Number(order.total_price),
            dueDate: new Date().toISOString().slice(0, 10),
            description: "SPACE Rewards — Pedido #" + order.order_number,
            externalReference: order.id
          })
        });

        paymentId = payment.id;

        // Persiste imediatamente o ID da cobrança.
        // Se o QR Code falhar, o próximo clique recupera a mesma cobrança.
        await sb.from("orders").update({
          status: "payment_pending",
          payment_provider: "asaas",
          payment_id: payment.id
        }).eq("id", order.id);

        await sb.from("order_events").insert({
          order_id: order.id,
          event_type: "payment_created",
          description: "Cobrança PIX criada no Asaas.",
          metadata: {
            provider: "asaas",
            payment_id: payment.id,
            customer_id: customer.id
          }
        });
      }

      const pix = await asaasRequest(
        "/payments/" + paymentId + "/pixQrCode",
        { method: "GET" }
      );

      const lines = [
        `💳 **PAGAMENTO DO PEDIDO #${order.order_number}**`,
        "",
        `💵 Valor: **${money(Number(order.total_price))}**`,
        `🪙 Robux: **${Number(order.robux_amount).toLocaleString("pt-BR")}**`,
        "",
        "📲 **PIX COPIA E COLA:**",
        "```",
        String(pix.payload || "Não disponível"),
        "```",
        "",
        `⏳ Expira em: **${pix.expirationDate || "conforme cobrança"}**`,
        "",
        "Após o pagamento, o sistema atualizará o pedido automaticamente."
      ].join("\n");

      const components: any[] = [];
      if (payment?.invoiceUrl) {
        components.push({
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "ABRIR PAGAMENTO",
              url: payment.invoiceUrl
            }
          ]
        });
      }

      return interactionResponse(
        publicMessage(
          "",
          components,
          [{
            title: `🟡 PAGAMENTO • PEDIDO #${order.order_number}`,
            description: "Use o PIX abaixo para concluir o pagamento. O status mudará automaticamente quando o Asaas confirmar.",
            color: 0xfee75c,
            fields: [
              { name: "💵 Valor", value: `**${money(Number(order.total_price))}**`, inline: true },
              { name: "🪙 Robux", value: `**${Number(order.robux_amount).toLocaleString("pt-BR")}**`, inline: true },
              { name: "📲 PIX COPIA E COLA", value: "```" + String(pix.payload || "Não disponível") + "```", inline: false },
              { name: "⏳ Expira em", value: String(pix.expirationDate || "conforme cobrança"), inline: false }
            ],
            footer: { text: "🟡 Aberto • Aguardando pagamento" }
          }]
        )
      );
    } catch (error: any) {
      console.error("Asaas payment creation error:", error);

      const message = String(
        error?.message || "Erro desconhecido ao comunicar com o Asaas."
      ).slice(0, 1500);

      return interactionResponse(
        ephemeral(
          [
            "❌ **O Asaas recusou ou não conseguiu processar a solicitação.**",
            "",
            "🔎 **Detalhe técnico:**",
            "```",
            message,
            "```",
            "",
            "Tente novamente após corrigirmos o erro indicado acima."
          ].join("\n")
        )
      );
    }
  }

  return interactionResponse(
    ephemeral("❌ Ação não reconhecida. Inicie a compra novamente.")
  );
}
