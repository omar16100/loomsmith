import { current_schema_version, type LoomDocument } from "../schema/document.ts";

export function create_empty_document(document_id: string, project_label: string): LoomDocument {
  return {
    format: "loomsmith",
    schema_version: current_schema_version,
    document_id,
    revision: 0,
    applied_batch_ids: [],
    project: { label: project_label },
    harnesses: [], parts: [], connectors: [], contacts: [], splices: [], ground_points: [], wires: [],
    nodes: [], segments: [], matings: [], assets: [], evidence: [], reviews: [], view_positions: [],
  };
}
