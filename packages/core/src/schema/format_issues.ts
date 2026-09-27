export function format_issues(issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string[] {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
}
