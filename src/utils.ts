import { createHash, timingSafeEqual } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function sha256Id(prefix: string, value: string, length = 24): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function textFromA2AMessage(message: unknown): string {
  if (!isObject(message) || !Array.isArray(message.parts)) return "";
  return message.parts
    .map((part) => {
      if (!isObject(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (part.content && isObject(part.content) && part.content.$case === "text" && typeof part.content.value === "string") {
        return part.content.value;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
