import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export async function GET(req:NextRequest){
  const code=req.nextUrl.searchParams.get("code");
  if(!code)return NextResponse.json({error:"Código OAuth ausente"},{status:400});

  const cid=process.env.DISCORD_CLIENT_ID;
  const secret=process.env.DISCORD_CLIENT_SECRET;
  const redirect=process.env.DISCORD_REDIRECT_URI||"https://space-gamma-blue.vercel.app/api/auth/discord/callback";
  const botToken=process.env.DISCORD_BOT_TOKEN;
  const guildId=process.env.DISCORD_GUILD_ID;
  const memberRoleId="1551628893637578872";
  const defaultRoleId="1551635028285587456";
  const travelerRoleId="1551628937837158531";

  if(!cid||!secret)return NextResponse.json({error:"OAuth não configurado no servidor"},{status:500});
  if(!botToken||!guildId){
    return NextResponse.json({error:"Configuração do bot ausente no servidor"},{status:500});
  }

  const token=await fetch("https://discord.com/api/oauth2/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      client_id:cid,
      client_secret:secret,
      grant_type:"authorization_code",
      code,
      redirect_uri:redirect
    })
  });

  if(!token.ok)return NextResponse.json({error:"Falha ao autenticar no Discord"},{status:401});
  const t=await token.json();

  const me=await fetch("https://discord.com/api/users/@me",{
    headers:{Authorization:`Bearer ${t.access_token}`}
  });
  if(!me.ok)return NextResponse.json({error:"Falha ao obter usuário Discord"},{status:401});
  const u=await me.json();

  const sb=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const {error}=await sb.from("users").upsert({
    discord_id:u.id,
    discord_username:u.username,
    discord_email:u.email??null,
    verified:true,
    verified_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  },{onConflict:"discord_id"});

  if(error)return NextResponse.json({error:"Falha ao salvar verificação"},{status:500});

  const headers={Authorization:`Bot ${botToken}`};

  const addRole=async(roleId:string)=>{
    const response=await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${u.id}/roles/${roleId}`,
      {method:"PUT",headers:{...headers,"Content-Length":"0"}}
    );
    if(!response.ok){
      const details=await response.text();
      console.error("Falha ao adicionar cargo:",roleId,response.status,details);
    }
    return response;
  };

  const removeRole=async(roleId:string)=>{
    const response=await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${u.id}/roles/${roleId}`,
      {method:"DELETE",headers}
    );
    if(!response.ok && response.status!==404){
      const details=await response.text();
      console.error("Falha ao remover cargo:",roleId,response.status,details);
    }
    return response;
  };

  const [memberResponse,defaultResponse]=await Promise.all([
    addRole(memberRoleId),
    addRole(defaultRoleId)
  ]);

  if(!memberResponse.ok || !defaultResponse.ok){
    return NextResponse.json({
      error:"Conta verificada, mas não foi possível atribuir todos os cargos.",
      discord_status:!memberResponse.ok?memberResponse.status:defaultResponse.status
    },{status:502});
  }

  await removeRole(travelerRoleId);

  return NextResponse.redirect(new URL("/verificado",req.url));
}
