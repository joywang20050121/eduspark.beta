import {HttpsError} from "firebase-functions/v2/https";

export function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${field}不可空白`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field}超過字數限制`);
  }
  return result;
}

export function optionalText(value: unknown, field: string, maxLength: number): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field}格式不正確`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field}超過字數限制`);
  }
  return result;
}

export function positiveInteger(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new HttpsError("invalid-argument", `${field}必須是 1 到 ${max} 的整數`);
  }
  return value;
}

export function timestampMillis(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpsError("invalid-argument", `${field}格式不正確`);
  }
  return value;
}
