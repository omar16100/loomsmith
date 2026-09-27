import { null_logger, type Logger } from "../log.ts";
import { canonicalize_document } from "../model/canonical.ts";
import { format_issues } from "../schema/format_issues.ts";
import { batch_schema, command_schema_version, type Batch, type Command } from "../schema/commands.ts";
import type { LoomDocument } from "../schema/document.ts";
import { issue_fingerprint, type Issue } from "../validate/issue.ts";
import { validate_structure } from "../validate/structural.ts";
import { apply_command } from "./apply_command.ts";

export type BatchRejectionCode =
  | "invalid_batch"
  | "document_mismatch"
  | "stale_revision"
  | "precondition_failed"
  | "invalid_entity"
  | "structural_errors_introduced"
  | "repair_required";

export interface BatchRejection {
  code: BatchRejectionCode;
  message: string;
  command_index: number | null;
  issues: Issue[];
}

export type ApplyBatchResult =
  | { ok: true; duplicate: boolean; doc: LoomDocument; inverse: Command[] }
  | { ok: false; rejection: BatchRejection };

function reject(log: Logger, rejection: BatchRejection): ApplyBatchResult {
  log.warn("batch rejected", {
    code: rejection.code,
    message: rejection.message,
    command_index: rejection.command_index,
    issue_count: rejection.issues.length,
  });
  return { ok: false, rejection };
}

export function make_batch(doc: LoomDocument, commands: Command[], batch_id: string, created_at: string): Batch {
  return { batch_id, document_id: doc.document_id, command_schema_version, expected_revision: doc.revision, created_at, commands };
}

// Pure reducer: never mutates `doc`, never reads the clock or RNG. The caller supplies ids and created_at.
export function apply_batch(doc: LoomDocument, raw_batch: unknown, log: Logger = null_logger): ApplyBatchResult {
  const parsed = batch_schema.safeParse(raw_batch);
  if (!parsed.success) {
    const message = format_issues(parsed.error.issues).join("; ");
    return reject(log, { code: "invalid_batch", message, command_index: null, issues: [] });
  }
  const batch = parsed.data;
  if (batch.document_id !== doc.document_id) {
    return reject(log, { code: "document_mismatch", message: `batch is for document ${batch.document_id}, not ${doc.document_id}`, command_index: null, issues: [] });
  }
  if (doc.applied_batch_ids.includes(batch.batch_id)) {
    log.info("duplicate batch ignored", { batch_id: batch.batch_id, revision: doc.revision });
    return { ok: true, duplicate: true, doc, inverse: [] };
  }
  if (batch.expected_revision !== doc.revision) {
    return reject(log, { code: "stale_revision", message: `batch expects revision ${batch.expected_revision}, document is at ${doc.revision}`, command_index: null, issues: [] });
  }
  let working = doc;
  const inverse: Command[] = [];
  for (const [command_index, command] of batch.commands.entries()) {
    const step = apply_command(working, command);
    if (!step.ok) return reject(log, { code: step.code, message: step.message, command_index, issues: [] });
    working = step.doc;
    inverse.unshift(...step.inverse);
    log.debug("command applied", {
      batch_id: batch.batch_id,
      command_index,
      op: command.op,
      target: command.op === "update_project" ? "project" : command.collection,
    });
  }
  // Invariant: a valid document stays valid. An already invalid document (e.g. loaded from a hand-edited file)
  // only accepts repair batches: no new or worsened issue, and strictly fewer issues than before.
  const after = validate_structure(working);
  if (after.length > 0) {
    const before = validate_structure(doc);
    const known = new Set(before.map(issue_fingerprint));
    const introduced = after.filter((issue) => !known.has(issue_fingerprint(issue)));
    if (introduced.length > 0) {
      return reject(log, { code: "structural_errors_introduced", message: `${introduced.length} structural error(s) introduced or worsened`, command_index: null, issues: introduced });
    }
    if (after.length >= before.length) {
      return reject(log, { code: "repair_required", message: `document has ${before.length} structural error(s); only batches that reduce them are accepted`, command_index: null, issues: after });
    }
  }
  const next = canonicalize_document({ ...working, revision: doc.revision + 1, applied_batch_ids: [...doc.applied_batch_ids, batch.batch_id] });
  log.info("batch applied", { batch_id: batch.batch_id, revision: next.revision, commands: batch.commands.length });
  return { ok: true, duplicate: false, doc: next, inverse };
}
