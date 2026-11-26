import { createHmac, timingSafeEqual } from "node:crypto";

export type TremendousSandboxHint = {
  eventId: string;
  kind: string;
  resourceType: "orders" | "rewards";
  resourceId: string;
};
const accepted = new Map<string, "orders" | "rewards">([
  ["ORDERS.CREATED", "orders"], ["ORDERS.APPROVED", "orders"],
  ["ORDERS.CANCELED", "orders"], ["ORDERS.FAILED", "orders"],
  ["REWARDS.CANCELED", "rewards"],
  ["REWARDS.DELIVERY.SUCCEEDED", "rewards"],
  ["REWARDS.DELIVERY.FAILED", "rewards"],
]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function verifyTremendousSandboxHint(input: {
  rawBody: Uint8Array; signature: string | null; secret: string;
}): TremendousSandboxHint | null {
  if (!input.secret || input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > 131_072 ||
    !/^sha256=[a-f0-9]{64}$/i.test(input.signature ?? "")) return null;
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest();
  const given = Buffer.from(input.signature!.slice(7), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(input.rawBody).toString("utf8")); }
  catch { return null; }
  if (!object(value) || typeof value.event !== "string" ||
    typeof value.uuid !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
      .test(value.uuid) ||
    typeof value.created_utc !== "string" ||
    !Number.isFinite(Date.parse(value.created_utc)) ||
    !object(value.payload) || !object(value.payload.resource)) return null;
  const resource = value.payload.resource;
  const resourceType = accepted.get(value.event);
  if (!resourceType || resource.type !== resourceType ||
    typeof resource.id !== "string" || !/^[A-Z0-9]{4,20}$/.test(resource.id))
    return null;
  return { eventId: value.uuid, kind: value.event,
    resourceType, resourceId: resource.id };
}
