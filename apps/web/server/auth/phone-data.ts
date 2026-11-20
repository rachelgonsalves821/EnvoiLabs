import { createCipheriv, createHmac, randomBytes } from "node:crypto";

export function phoneDataKey(encoded = process.env.ENVOI_PHONE_DATA_KEY): Buffer | null {
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 && key.toString("base64") === encoded ? key : null;
}

export function protectPhone(phone: string, key: Buffer) {
  const version = Buffer.from([1]);
  const iv = randomBytes(12);
  const purposeKey = (purpose: string) => createHmac("sha256", key).update(purpose).digest();
  const cipher = createCipheriv("aes-256-gcm", purposeKey("envoi/phone/encryption/v1"), iv);
  cipher.setAAD(version);
  const ciphertext = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  const payload = Buffer.concat([version, iv, cipher.getAuthTag(), ciphertext]);
  const digest = createHmac("sha256", purposeKey("envoi/phone/lookup/v1")).update(phone).digest("hex");
  return { ciphertext: `\\x${payload.toString("hex")}`, hash: `\\x${digest}` };
}
