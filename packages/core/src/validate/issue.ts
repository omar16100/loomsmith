import { compare_strings } from "../model/canonical.ts";

export type IssueSeverity = "error" | "warning";
export type IssueLevel = "structural" | "completeness";

export interface Issue {
  code: string;
  level: IssueLevel;
  severity: IssueSeverity;
  message: string;
  path: string;
  entity_id: string | null;
  hint: string;
}

export function issue_key(issue: Issue): string {
  return `${issue.code}|${issue.entity_id ?? ""}|${issue.path}`;
}

// Key plus message: detects an existing issue getting worse (e.g. "holds 2 wire ends" becoming "holds 3").
export function issue_fingerprint(issue: Issue): string {
  return `${issue_key(issue)}|${issue.message}`;
}

export function sort_issues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => compare_strings(issue_key(a), issue_key(b)));
}

// Paths address entities by id, not array index: "wires/w1/ends/0".
export function entity_path(collection: string, id: string, ...rest: Array<string | number>): string {
  return [collection, id, ...rest.map(String)].join("/");
}
