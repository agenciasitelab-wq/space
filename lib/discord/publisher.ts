import { createHmac, timingSafeEqual } from "crypto";

export type PublisherSession = { userId: string; username: string; exp: number };

const secret = () => process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_PUBLIC_KEY || "";

export function signPublisherSession(session: PublisherSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return payload + "." + sig;
}

export function verifyPublisherSession(token: string | undefined): PublisherSession | null {
  if (!token || !secret()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PublisherSession;
    if (!session.userId || !session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export const PUBLISHER_COOKIE = "space_publisher";

export const PUBLISHER_ROLES = [
  "1551628937837158531", // SPACE TRAVELER
  "1551628893637578872", // SPACE MEMBER
  "1551635028285587456", // MEMBROS PADRÃO
];

export const STAFF_PUBLISHER_ROLES = [
  "1551628937837158531",
  "1551628893637578872",
  "1551635028285587456",
  "1551635518976950302",
];

export const ADMIN_PUBLISHER_ROLES = [
  "1551628937837158531",
  "1551628893637578872",
  "1551635028285587456",
  "1551635518976950302",
];
