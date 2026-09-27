import * as z from "zod";
import { batch_schema } from "./commands.ts";
import { document_schema } from "./document.ts";

export function document_json_schema(): Record<string, unknown> {
  return z.toJSONSchema(document_schema) as Record<string, unknown>;
}

export function batch_json_schema(): Record<string, unknown> {
  return z.toJSONSchema(batch_schema) as Record<string, unknown>;
}
