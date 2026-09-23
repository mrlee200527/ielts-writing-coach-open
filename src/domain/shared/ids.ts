import { z } from "zod";
import { createHash } from "node:crypto";

export const uuidSchema = z.uuid();
export type UUID = z.infer<typeof uuidSchema>;

export function stableUuid(value: string): UUID {
  const parsed = uuidSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4];
  return uuidSchema.parse(`${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`);
}
