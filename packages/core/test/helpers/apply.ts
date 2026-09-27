import { apply_batch, make_batch } from "../../src/commands/apply_batch.ts";
import type { Command } from "../../src/schema/commands.ts";
import type { LoomDocument } from "../../src/schema/document.ts";

export const fixed_time = "2026-09-27T00:00:00Z";

export function apply_ok(doc: LoomDocument, commands: Command[], batch_id: string): LoomDocument {
  const result = apply_batch(doc, make_batch(doc, commands, batch_id, fixed_time));
  if (!result.ok) {
    const issues = result.rejection.issues.map((issue) => `${issue.code} ${issue.path}`).join(", ");
    throw new Error(`batch ${batch_id} rejected: ${result.rejection.code} ${result.rejection.message} ${issues}`);
  }
  return result.doc;
}
