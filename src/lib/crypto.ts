import "server-only";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "./store";

/** AES-256-GCM encryption for the user's Anthropic API key (plan §3.1). */

let cachedKey: Buffer | null = null;

async function getKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  let secret = process.env.LUMA_SECRET;
  if (!secret) {
    const file = path.join(DATA_DIR, "secret.key");
    try {
      secret = (await fs.readFile(file, "utf8")).trim();
    } catch {
      secret = crypto.randomBytes(32).toString("hex");
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(file, secret, { mode: 0o600 });
    }
  }
  cachedKey = crypto.createHash("sha256").update(secret).digest();
  return cachedKey;
}

export async function encrypt(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export async function decrypt(payload: string): Promise<string> {
  const key = await getKey();
  const [iv, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function maskKey(key: string) {
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
