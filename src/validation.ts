/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local validation of write payloads against the native Reddit schemas pinned
 * in schema.json (checkedAt records when they were read from Reddit's OpenAPI
 * document). A payload that passes here can still be refused by Reddit.
 */
import catalog from "./schema.json";
import { row, type Row } from "./client.js";

export type WriteSpec = { schema: Row; fields: string[]; method: string; path: string };
export const REDDIT_SCHEMA = catalog as unknown as {
  checkedAt: string;
  source: string;
  operations: Record<string, WriteSpec>;
  metrics: string[];
  breakdowns: string[];
};

/** Fields that no write may set: billing and computed delivery status. */
export const BLOCKED_FIELDS = ["funding_instrument_id", "effective_status"];

/**
 * Operations this server exposes. Onsite lead-form creation is pinned in the
 * schema but not exposed: Reddit ended it on 2026-09-21.
 */
export const WRITE_OPERATIONS = Object.keys(REDDIT_SCHEMA.operations).filter(operation => operation !== "lead_form_create") as [string, ...string[]];

/** Interprets the pinned JSON Schema subset without code generation. */
function errors(schema: Row, value: unknown, path: string): string[] {
  for (const key of ["oneOf", "anyOf"]) {
    if (!Array.isArray(schema[key])) continue;
    const choices = schema[key] as Row[];
    const typed = choices.filter(s => row(row(s.properties).type).const === row(value).type && row(value).type !== undefined);
    const branches = (typed.length ? typed : choices).map(s => errors(s, value, path));
    if (!branches.some(e => e.length === 0)) return branches.sort((a, b) => a.length - b.length)[0];
  }
  const result: string[] = [];
  if (Array.isArray(schema.allOf)) for (const part of schema.allOf) result.push(...errors(row(part), value, path));
  if (schema.const !== undefined && value !== schema.const) result.push(`${path} must be ${schema.const}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) result.push(`${path} must be one of ${schema.enum.join(", ")}`);
  const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (types.length && !types.includes(actual) && !(actual === "number" && types.includes("integer") && Number.isInteger(value))) return [`${path}: expected ${types.join("/")}`];
  if (Array.isArray(value)) {
    if ((typeof schema.minItems === "number" && value.length < schema.minItems) || (typeof schema.maxItems === "number" && value.length > schema.maxItems)) result.push(`${path}: invalid array length`);
    if (schema.items) value.forEach((v, i) => result.push(...errors(row(schema.items), v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    const properties = row(schema.properties);
    const object = row(value);
    for (const name of Array.isArray(schema.required) ? schema.required : []) if (!(String(name) in object)) result.push(`${path}.${name} is required`);
    for (const [name, v] of Object.entries(object)) {
      if (properties[name]) result.push(...errors(row(properties[name]), v, `${path}.${name}`));
      else if (schema.additionalProperties === false) result.push(`${path}.${name} is not supported`);
    }
  } else if (typeof value === "string") {
    if ((typeof schema.minLength === "number" && value.length < schema.minLength) || (typeof schema.maxLength === "number" && value.length > schema.maxLength)) result.push(`${path}: invalid string length`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) result.push(`${path}: invalid format`);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value) || (typeof schema.minimum === "number" && value < schema.minimum) || (typeof schema.maximum === "number" && value > schema.maximum)) result.push(`${path}: number out of range`);
  }
  return result;
}

/** Returns a validated copy of a native payload, or throws with at most eight problems. */
export function validateNative(operation: string, input: unknown): unknown {
  const spec = REDDIT_SCHEMA.operations[operation];
  if (!spec || !WRITE_OPERATIONS.includes(operation)) throw new Error("Unknown Reddit write schema.");
  const value = structuredClone(input);
  if (!Array.isArray(value)) {
    for (const key of Object.keys(row(value))) if (!spec.fields.includes(key) || BLOCKED_FIELDS.includes(key)) throw new Error(`Unsupported Reddit field: ${key}`);
  }
  const problems = errors(spec.schema, value, "data");
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
  if (JSON.stringify(value).length > 500_000) throw new Error("Reddit payload exceeds 500 KB.");
  return value;
}
