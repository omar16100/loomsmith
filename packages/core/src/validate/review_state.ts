import { canonical_json } from "../model/canonical.ts";
import { has_field, type DocIndex } from "../model/doc_index.ts";
import type { Evidence, LoomDocument, Review } from "../schema/document.ts";

export type ReviewState = "approved" | "rejected" | "stale" | "unreviewed";
export type EvidenceState = "current" | "stale";

export function field_value(index: DocIndex, entity_id: string, field: string): unknown {
  const ref = index.by_id.get(entity_id);
  return ref ? (ref.entity as Record<string, unknown>)[field] : undefined;
}

// Builders are called by UIs and agents with user input; an unknown field is a caller bug, so they throw.
function require_field(index: DocIndex, entity_id: string, field: string): void {
  if (!has_field(index, entity_id, field)) throw new Error(`${entity_id} has no top-level field ${field}`);
}

// Evidence describes one value: it stays current only while the field still holds that value.
export function evidence_state(index: DocIndex, evidence: Evidence): EvidenceState {
  return canonical_json(field_value(index, evidence.entity_id, evidence.field)) === evidence.value_json ? "current" : "stale";
}

export function make_evidence(index: DocIndex, input: Omit<Evidence, "value_json">): Evidence {
  require_field(index, input.entity_id, input.field);
  return { ...input, value_json: canonical_json(field_value(index, input.entity_id, input.field)) };
}

export function latest_review(doc: LoomDocument, entity_id: string, field: string): Review | null {
  let latest: Review | null = null;
  for (const r of doc.reviews) {
    if (r.entity_id !== entity_id || r.field !== field) continue;
    if (latest === null || r.revision > latest.revision || (r.revision === latest.revision && r.id > latest.id)) latest = r;
  }
  return latest;
}

// Approval is bound to the value, not the revision: it holds while the field's canonical json equals the approved
// value. Reverting to the approved value (for example by undo) restores it; any other change makes it stale.
export function review_state(doc: LoomDocument, index: DocIndex, entity_id: string, field: string): ReviewState {
  const review = latest_review(doc, entity_id, field);
  if (review === null) return "unreviewed";
  if (canonical_json(field_value(index, entity_id, field)) !== review.reviewed_value_json) return "stale";
  return review.status;
}

export function make_review(
  doc: LoomDocument,
  index: DocIndex,
  input: { id: string; entity_id: string; field: string; status: "approved" | "rejected" },
): Review {
  require_field(index, input.entity_id, input.field);
  return { ...input, reviewed_value_json: canonical_json(field_value(index, input.entity_id, input.field)), revision: doc.revision };
}
