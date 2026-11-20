import { z } from "zod";

export const id = z.uuid();
export const timestamp = z.iso.datetime();
export const audioMime = z.string().regex(/^audio\/[a-z0-9.+-]+(?:;\s*codecs=[a-z0-9.,+"-]+)?$/i);
export const text = z.string().trim().min(1);
export const count = z.int().nonnegative();
export const positive = z.int().positive();
export const cents = count;
export const score = count.max(100);
export const jsonObject = z.record(z.string(), z.json());
export const timestamps = { createdAt: timestamp, updatedAt: timestamp };
export const row = { id, ...timestamps };

export const exampleId = "11111111-1111-4111-8111-111111111111";
export const exampleDate = "2026-11-19T18:00:00.000Z";
export const exampleTimestamps = { createdAt: exampleDate, updatedAt: exampleDate };
export const exampleRow = { id: exampleId, ...exampleTimestamps };

export function withExample<Schema extends z.ZodType>(schema: Schema, example: z.input<Schema>): Schema {
  return schema.meta({ examples: [example] });
}
