import { null_logger, type Logger } from "../log.ts";
import { build_index } from "../model/doc_index.ts";
import type { LoomDocument } from "../schema/document.ts";
import { validate_completeness } from "./completeness.ts";
import { sort_issues, type Issue } from "./issue.ts";
import { validate_structure } from "./structural.ts";

export type ValidationLevel = "structural" | "build";

export function validate(
  doc: LoomDocument,
  options: { level: ValidationLevel; harness_ids: readonly string[] | null },
  log: Logger = null_logger,
): Issue[] {
  const index = build_index(doc);
  const structural = validate_structure(doc, index);
  const completeness = options.level === "build" ? validate_completeness(doc, { harness_ids: options.harness_ids }, index) : [];
  log.debug("document validated", { level: options.level, structural: structural.length, completeness: completeness.length });
  return sort_issues([...structural, ...completeness]);
}

export function is_release_ready(issues: readonly Issue[]): boolean {
  return !issues.some((issue) => issue.severity === "error");
}
