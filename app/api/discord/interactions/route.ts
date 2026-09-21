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

function methodShortLabel(method: DeliveryMethod) {
  switch (method) {
    case "plus":
      return "PLUS";
    case "group":
      return "GRUPO";
    case "gamepass_fee":
      return "GAMEPASS + TAXA";
    case "gamepass_no_fee":
      return "GAMEPASS SEM TAXA";
  }
}

async function getDeliveryPricing(amount: number) {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await sb
    .from("pricing")
    .select("method,display_name,price_per_1000")
    .in("method", [...VALID_METHODS])
    .eq("active", true);

  if (error || !data) return [];

  return data.map((item: any) => ({
    method: item.method as DeliveryMethod,
    displayName: String(item.display_name),
    rate: Number(item.price_per_1000)
  }));
}

function receivedRobux(amount: number, method: DeliveryMethod) {
  return method === "gamepass_no_fee"
    ? Math.floor(amount * 0.70)
    : amount;
}

function deliveryRobuxAmount(amount: number, method: DeliveryMethod) {
  return method === "gamepass_fee"
    ? Math.ceil(amount / 0.70)
    : amount;
}

async function lookupRobloxUser(username: string) {
  const response = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false
    })
  });
  if (!response.ok) throw new Error("Roblox não respondeu à consulta.");
  const data: any = await response.json();
  const user = data?.data?.[0];
  if (!user?.id || !user?.name) return null;
  return { id: String(user.id), name: String(user.name), displayName: String(user.displayName || user.name) };
}

async function getRobloxAvatar(userId: string) {
  try {
    const response = await fetch(
      "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
        encodeURIComponent(userId) +
        "&size=150x150&format=Png&isCircular=false"
    );
    if (!response.ok) return null;
    const data: any = await response.json();
    return data?.data?.[0]?.imageUrl || null;
  } catch {
    return null;
  }
}

async function getStaffRoleIds(guildId: string) {
  const roles = await discordRequest("/guilds/" + guildId + "/roles", { method: "GET" });
  const names = new Set([
    "🎫・SPACE SUPPORT",
    "🛡️・SPACE STAFF",
    "💰・SPACE SELLER",
    "🌌・SPACE DIRECTOR",
    "👑・SPACE FOUNDER"
  ]);
  return (roles as any[]).filter(r => names.has(r.name)).map(r => r.id);
}

function memberHasAnyRole(interaction: any, roleIds: string[]) {
  const memberRoles = interaction.member?.roles ?? [];
  return roleIds.some(id => memberRoles.includes(id));
}

async function purchaseButtons(
  amount: number,
  username?: string,
  method?: DeliveryMethod
) {
  const encodedUser = username ? encode(username) : "_";
  const pricing = await getDeliveryPricing(amount);

  const methodOrder: DeliveryMethod[] = [
    "plus",
    "group",
    "gamepass_fee",
    "gamepass_no_fee"
  ];

  const options = methodOrder
    .map((deliveryMethod) => {
      const item = pricing.find((price) => price.method === deliveryMethod);
      if (!item) return null;

      const total = Math.round((amount / 1000) * item.rate * 100) / 100;
      const received = receivedRobux(amount, deliveryMethod);

      return {
        label: `${methodShortLabel(deliveryMethod)} • ${money(total)}`,
        value: deliveryMethod,
        description:
          deliveryMethod === "gamepass_no_fee"
            ? `Recebe ${received.toLocaleString("pt-BR")} Robux • compra de ${amount.toLocaleString("pt-BR")} • taxa descontada`
            : deliveryMethod === "gamepass_fee"
              ? `Recebe ${received.toLocaleString("pt-BR")} • envia ${deliveryRobuxAmount(amount, deliveryMethod).toLocaleString("pt-BR")} • taxa incluída`
              : `Recebe ${received.toLocaleString("pt-BR")} Robux`,
        emoji: { name: deliveryMethod === "plus" ? "💎" : deliveryMethod === "group" ? "👥" : "🎮" },
        default: method === deliveryMethod
      };
    })
    .filter(Boolean);

  return [
    {
      type: 1,
      components: [
        button(
          `space_set_username:${amount}:${encodedUser}:${method ?? "_"}`,
          username ? "ALTERAR ROBLOX" : "USUÁRIO ROBLOX",
          "🎮"
        )
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `space_select_method:${amount}:${encodedUser}`,
          placeholder: method ? `📦 ${methodLabel(method)}` : "📦 Escolha a forma de envio",
          min_values: 1,
          max_values: 1,
          options
        }
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

function discordInteractionFollowupUrl(interaction: any) {
  const applicationId = interaction.application_id;
  const token = interaction.token;
  if (!applicationId || !token) throw new Error("Dados da interação do Discord ausentes.");
  return "https://discord.com/api/v10/webhooks/" + applicationId + "/" + token;
}

function formatPixExpiration(value: any) {
  if (!value) return "conforme cobrança";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

async function sendQrFollowup(interaction: any, encodedImage: string) {
  const base64 = String(encodedImage || "").replace(/^data:image\\/png;base64,/, "");
  if (!base64) throw new Error("QR Code não retornado pelo Asaas.");
  const binary = Buffer.from(base64, "base64");
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    content: "📲 **QR Code PIX**\\nAponte a câmera do seu banco para o código abaixo.",
    flags: 64,
    attachments: [{ id: 0, filename: "pix-qrcode.png" }]
  }));
  form.append("files[0]", new Blob([binary], { type: "image/png" }), "pix-qrcode.png");
  const response = await fetch(discordInteractionFollowupUrl(interaction), { method: "POST", body: form });
  if (!response.ok) {
    const details = await response.text();
    throw new Error("Discord QR followup " + response.status + ": " + details);
  }
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

    const components = await purchaseButtons(amount);

    return interactionResponse(
      ephemeral(
        "",
        components,
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
      const components = await purchaseButtons(
        amount,
        undefined,
        currentMethod || undefined
      );

      return interactionResponse(
        updateMessage(
          "❌ **Username Roblox inválido.** Use de 3 a 20 caracteres: letras, números ou _.",
          components,
          [purchaseEmbed(amount, undefined, currentMethod || undefined)]
        )
      );
    }

    const components = await purchaseButtons(
      amount,
      username,
      currentMethod || undefined
    );

    return interactionResponse(
      updateMessage(
        "",
        components,
        [purchaseEmbed(amount, username, currentMethod || undefined)]
      )
    );
  }

  // 5) Select de forma de envio -> atualiza o mesmo resumo
  if (customId.startsWith("space_select_method:")) {
    const parts = customId.split(":");
    const amount = Number(parts[1]);
    const encodedUser = parts[2] ?? "_";
    const username = encodedUser !== "_" ? decode(encodedUser) : "";
    const selectedValue = String(data.values?.[0] ?? "");
    const method = normalizeMethod(selectedValue);

    if (
      !Number.isInteger(amount) ||
      amount < MIN_ROBUX ||
      amount > MAX_ROBUX ||
      !method
    ) {
      return interactionResponse(
        ephemeral("❌ Pedido inválido. Inicie a compra novamente.")
      );
    }

    const pricing = await getPricing(method);
    if (!pricing) {
      return interactionResponse(
        ephemeral("❌ Esta forma de envio está temporariamente indisponível.")
      );
    }

    const total = Math.round((amount / 1000) * pricing.rate * 100) / 100;
    const components = await purchaseButtons(
      amount,
      username || undefined,
      method
    );

    return interactionResponse(
      updateMessage(
        "",
        components,
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

    // Idempotência: um comprador não pode abrir dois pedidos de pagamento ao mesmo tempo.
    // Isso também protege quando o Discord demora a responder e o usuário clica em CONCLUIR novamente.
    const { data: openOrder } = await sb
      .from("orders")
      .select("id,order_number,status,discord_channel_id")
      .eq("user_id", user.id)
      .in("status", ["awaiting_payment", "payment_pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openOrder) {
      if (openOrder.discord_channel_id) {
        return interactionResponse(
          updateMessage(
            "⚠️ **Você já possui um pedido em aberto.**",
            [{
              type: 1,
              components: [{
                type: 2,
                style: 5,
                label: "ABRIR PEDIDO EXISTENTE",
                url: `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${openOrder.discord_channel_id}`
              }]
            }],
            [{
              title: "🟡 PEDIDO JÁ ABERTO",
              description: `O pedido **#${openOrder.order_number}** já está aguardando pagamento. Não criamos outro pedido para evitar cobrança duplicada.`,
              color: 0xfee75c
            }]
          )
        );
      }

      return interactionResponse(
        ephemeral(
          `⏳ Seu pedido **#${openOrder.order_number}** já está sendo criado. Aguarde alguns segundos e não clique em concluir novamente.`
        )
      );
    }

    const total = Math.round((amount / 1000) * pricing.rate * 100) / 100;
    let robloxUser: { id: string; name: string; displayName: string } | null = null;
    try {
      robloxUser = await lookupRobloxUser(username);
    } catch {
      return interactionResponse(ephemeral("❌ Não consegui consultar o Roblox agora. Tente novamente em alguns segundos."));
    }

    if (!robloxUser) {
      return interactionResponse(ephemeral(
        `❌ A conta Roblox **${username}** não foi encontrada. Confira o username e tente novamente.`
      ));
    }

    const expected = receivedRobux(amount, method);
    const deliveryAmount = deliveryRobuxAmount(amount, method);

    await sb.from("users").update({
      roblox_username: robloxUser.name,
      roblox_user_id: robloxUser.id,
      updated_at: new Date().toISOString()
    }).eq("id", user.id);

    const { data: order, error: orderError } = await sb
      .from("orders")
      .insert({
        user_id: user.id,
        robux_amount: amount,
        roblox_username: robloxUser.name,
        roblox_user_id: robloxUser.id,
        delivery_method: method,
        price_per_1000: pricing.rate,
        total_price: total,
        expected_received_robux: expected,
        delivery_robux_amount: deliveryAmount,
        terms_accepted_at: new Date().toISOString(),
        status: "awaiting_payment",
        payment_provider: "asaas"
      })
      .select("id,order_number,total_price,status")
      .single();

    if (orderError || !order) {
      console.error("Order creation error:", orderError);

      // Proteção extra para uma corrida entre dois cliques simultâneos.
      if ((orderError as any)?.code === "23505") {
        const { data: existingOrder } = await sb
          .from("orders")
          .select("id,order_number,status,discord_channel_id")
          .eq("user_id", user.id)
          .in("status", ["awaiting_payment", "payment_pending"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingOrder?.discord_channel_id) {
          return interactionResponse(
            updateMessage(
              "⚠️ **Pedido já criado.**",
              [{
                type: 1,
                components: [{
                  type: 2,
                  style: 5,
                  label: "ABRIR PEDIDO",
                  url: `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${existingOrder.discord_channel_id}`
                }]
              }],
              [{
                title: `🟡 PEDIDO #${existingOrder.order_number}`,
                description: "Já existe um pedido aberto para sua conta. Use o canal existente para continuar.",
                color: 0xfee75c
              }]
            )
          );
        }
      }

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
        robux_amount: amount,
        expected_received_robux: expected,
        delivery_robux_amount: deliveryAmount,
        roblox_user_id: robloxUser.id
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

  // Perfil do cliente
  if (customId === "space_profile") {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: user } = await sb.from("users")
      .select("id,discord_username,discord_email,roblox_username,verified,created_at")
      .eq("discord_id", userId).maybeSingle();

    if (!user) return interactionResponse(ephemeral("❌ Você ainda não possui um perfil verificado no SPACE Rewards."));

    const { data: orders } = await sb.from("orders")
      .select("status,total_price,robux_amount")
      .eq("user_id", user.id);

    const list = orders ?? [];
    const completed = list.filter((o: any) => o.status === "delivered");
    const paid = list.filter((o: any) => ["paid","processing","delivered"].includes(o.status));
    const spent = paid.reduce((sum: number, o: any) => sum + Number(o.total_price || 0), 0);
    const robux = completed.reduce((sum: number, o: any) => sum + Number(o.robux_amount || 0), 0);

    return interactionResponse(ephemeral("", [], [{
      title: "👤 SPACE PROFILE",
      color: 0x5865f2,
      fields: [
        { name: "Discord", value: `**@${user.discord_username || "usuário"}**`, inline: true },
        { name: "Roblox", value: `**${user.roblox_username || "Não informado"}**`, inline: true },
        { name: "📦 Pedidos", value: `**${list.length}**`, inline: true },
        { name: "💰 Total gasto", value: `**${money(spent)}**`, inline: true },
        { name: "🪙 Robux entregues", value: `**${robux.toLocaleString("pt-BR")}**`, inline: true },
        { name: "⭐ Status", value: user.verified ? "**Conta verificada**" : "**Não verificada**", inline: true }
      ],
      footer: { text: "SPACE Rewards • Perfil do cliente" }
    }]));
  }

  // Staff marca manualmente como entregue. A entrega continua 100% manual.
  if (customId.startsWith("space_mark_delivered:")) {
    const orderId = customId.slice("space_mark_delivered:".length);
    const guildId = process.env.DISCORD_GUILD_ID;
    const staffIds = guildId ? await getStaffRoleIds(guildId) : [];
    if (!memberHasAnyRole(interaction, staffIds)) {
      return interactionResponse(ephemeral("❌ Apenas a STAFF pode marcar um pedido como entregue."));
    }

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: order } = await sb.from("orders")
      .select("id,order_number,status,user_id,total_price,robux_amount,discord_channel_id")
      .eq("id", orderId).single();

    if (!order) return interactionResponse(ephemeral("❌ Pedido não encontrado."));
    if (!["paid","processing"].includes(order.status)) {
      return interactionResponse(ephemeral(`❌ Este pedido está **${order.status}** e não pode ser marcado como entregue.`));
    }

    await sb.from("orders").update({
      status: "delivered",
      delivered_at: new Date().toISOString()
    }).eq("id", order.id);

    await sb.from("order_events").insert({
      order_id: order.id,
      event_type: "order_delivered",
      description: "Entrega marcada manualmente pela STAFF.",
      metadata: { discord_staff_id: userId }
    });

    const roles = await discordRequest(`/guilds/${guildId}/roles`, { method: "GET" });
    const memberRole = (roles as any[]).find((r: any) => r.name === "🚀・SPACE MEMBER");
    const eliteRole = (roles as any[]).find((r: any) => r.name === "💎・SPACE ELITE");
    const { data: allDelivered } = await sb.from("orders").select("total_price").eq("user_id", order.user_id).eq("status","delivered");
    const lifetime = (allDelivered ?? []).reduce((s: number, o: any) => s + Number(o.total_price || 0), 0);

    if (guildId && eliteRole && lifetime >= 500) {
      try { await discordRequest(`/guilds/${guildId}/members/${(await sb.from("users").select("discord_id").eq("id",order.user_id).single()).data?.discord_id}/roles/${eliteRole.id}`, { method: "PUT", body: JSON.stringify({}) }); } catch {}
    } else if (guildId && memberRole) {
      try { await discordRequest(`/guilds/${guildId}/members/${(await sb.from("users").select("discord_id").eq("id",order.user_id).single()).data?.discord_id}/roles/${memberRole.id}`, { method: "PUT", body: JSON.stringify({}) }); } catch {}
    }

    if (order.discord_channel_id) {
      try {
        await discordRequest(`/channels/${order.discord_channel_id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: `🟣・pedido-${order.order_number}` })
        });
        await discordRequest(`/channels/${order.discord_channel_id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            embeds: [{
              title: `🟣 PEDIDO ENTREGUE • #${order.order_number}`,
              description: "A entrega foi marcada pela STAFF. Agora avalie sua experiência.",
              color: 0x9b59b6,
              fields: [
                { name: "🪙 Robux", value: `**${Number(order.robux_amount).toLocaleString("pt-BR")}**`, inline: true },
                { name: "💵 Valor", value: `**${money(Number(order.total_price))}**`, inline: true }
              ]
            }],
            components: [{
              type: 1,
              components: [
                button(`space_review:${order.id}:1`, "1", "⭐"),
                button(`space_review:${order.id}:2`, "2", "⭐"),
                button(`space_review:${order.id}:3`, "3", "⭐"),
                button(`space_review:${order.id}:4`, "4", "⭐"),
                button(`space_review:${order.id}:5`, "5", "⭐")
              ]
            }]
          })
        });
      } catch (error) { console.error("Delivered channel update error:", error); }
    }

    return interactionResponse(ephemeral("🟣 Pedido marcado como **ENTREGUE**. A avaliação foi enviada ao canal."));
  }

  // Avaliação rápida após a entrega.
  if (customId.startsWith("space_review:")) {
    const [, orderId, ratingText] = customId.split(":");
    const rating = Number(ratingText);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return interactionResponse(ephemeral("❌ Avaliação inválida."));

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: order } = await sb.from("orders").select("id,user_id,status,order_number").eq("id", orderId).single();
    if (!order || order.status !== "delivered") return interactionResponse(ephemeral("❌ Este pedido ainda não está disponível para avaliação."));
    const { data: owner } = await sb.from("users").select("id,discord_id").eq("id", order.user_id).single();
    if (owner?.discord_id !== userId) return interactionResponse(ephemeral("❌ Apenas o comprador pode avaliar este pedido."));

    const { data: existing } = await sb.from("reviews").select("id").eq("order_id", order.id).maybeSingle();
    if (existing) return interactionResponse(ephemeral("⭐ Você já avaliou este pedido. Obrigado!"));

    await sb.from("reviews").insert({ order_id: order.id, user_id: order.user_id, rating });

    try {
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) {
        const channels = await discordRequest(`/guilds/${guildId}/channels`, { method: "GET" });
        const reviewsChannel = (channels as any[]).find((channel: any) =>
          channel.type === 0 && channel.name === "⭐・avaliações"
        );
        const profile = await sb.from("users").select("discord_username,roblox_username").eq("id", order.user_id).single();
        if (reviewsChannel) {
          await discordRequest(`/channels/${reviewsChannel.id}/messages`, {
            method: "POST",
            body: JSON.stringify({
              embeds: [{
                title: `⭐ NOVA AVALIAÇÃO • PEDIDO #${order.order_number}`,
                description: `**${"⭐".repeat(rating)}${"☆".repeat(5-rating)}**`,
                color: 0xfee75c,
                fields: [
                  { name: "👤 Cliente", value: `<@${userId}>`, inline: true },
                  { name: "🎮 Roblox", value: profile.data?.roblox_username || "Não informado", inline: true },
                  { name: "📦 Pedido", value: `#${order.order_number}`, inline: true }
                ],
                footer: { text: "SPACE Rewards • Avaliação verificada" }
              }]
            })
          });
        }
      }
    } catch (error) {
      console.error("Review publication error:", error);
    }

    return interactionResponse(ephemeral(`⭐ Obrigado pela avaliação de **${rating}/5**!`));
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

  if (customId.startsWith("space_copy_pix:") || customId.startsWith("space_qr_pix:")) {
    const orderId = customId.split(":")[1];
    if (!orderId) return interactionResponse(ephemeral("❌ Pedido inválido."));

    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: order } = await sb.from("orders")
      .select("id,order_number,status,payment_id,user_id,discord_channel_id")
      .eq("id", orderId).single();

    if (!order || order.discord_channel_id !== interaction.channel_id) {
      return interactionResponse(ephemeral("❌ Este pagamento só pode ser acessado no canal do próprio pedido."));
    }
    const { data: owner } = await sb.from("users").select("discord_id").eq("id", order.user_id).single();
    if (owner?.discord_id !== userId) return interactionResponse(ephemeral("❌ Apenas o comprador pode acessar o PIX."));
    if (!order.payment_id || !["payment_pending","awaiting_payment"].includes(order.status)) {
      return interactionResponse(ephemeral("❌ Este pagamento não está mais disponível."));
    }

    try {
      const pix = await asaasRequest("/payments/" + order.payment_id + "/pixQrCode", { method: "GET" });
      if (customId.startsWith("space_copy_pix:")) {
        return interactionResponse(ephemeral("📋 **PIX COPIA E COLA**\n\n```\n" + String(pix.payload || "Não disponível") + "\n```\n\nSelecione o código acima para copiar."));
      }
      const response = interactionResponse({ type: 5, data: { flags: 64 } });
      try {
        await sendQrFollowup(interaction, String(pix.encodedImage || ""));
      } catch (error) {
        console.error("QR Code followup error:", error);
        await fetch(discordInteractionFollowupUrl(interaction), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "❌ Não consegui gerar o QR Code agora. Use o botão **COPIAR PIX**.", flags: 64 })
        }).catch(() => {});
      }
      return response;
    } catch (error) {
      console.error("PIX button error:", error);
      return interactionResponse(ephemeral("❌ Não consegui recuperar o PIX agora. Tente novamente."));
    }
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

      const pixPayload = String(pix.payload || "");
      const expiration = formatPixExpiration(pix.expirationDate);

      return interactionResponse(
        publicMessage(
          "",
          [{
            type: 1,
            components: [
              button("space_copy_pix:" + order.id, "COPIAR PIX", "📋", 1),
              button("space_qr_pix:" + order.id, "GERAR QR CODE", "📲", 2)
            ]
          }],
          [{
            title: "🟡 PAGAMENTO • PEDIDO #" + order.order_number,
            description: "Pague via PIX. O pagamento será confirmado automaticamente pelo Asaas.",
            color: 0xfee75c,
            fields: [
              { name: "💵 Valor", value: "**" + money(Number(order.total_price)) + "**", inline: true },
              { name: "🪙 Robux", value: "**" + Number(order.robux_amount).toLocaleString("pt-BR") + "**", inline: true },
              { name: "📲 PIX COPIA E COLA", value: pixPayload ? "```" + pixPayload + "```" : "Não disponível", inline: false },
              { name: "⏳ Expira em", value: "**" + expiration + "**", inline: false }
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
