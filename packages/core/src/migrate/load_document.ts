import { null_logger, type Logger } from "../log.ts";
import { canonicalize_document } from "../model/canonical.ts";
import { format_issues } from "../schema/format_issues.ts";
import { current_schema_version, document_schema, type LoomDocument } from "../schema/document.ts";
import { migrate_v1_to_v2, type MigrationResult } from "./v1_to_v2.ts";

export type LoadErrorCode = "not_object" | "wrong_format" | "future_version" | "unsupported_version" | "migration_failed" | "invalid_document";
export interface LoadError {
  code: LoadErrorCode;
  message: string;
  details: string[];
}
export type LoadResult = { ok: true; doc: LoomDocument; migrated_from: number | null } | { ok: false; error: LoadError };

type RawDocument = Record<string, unknown>;

// migrations[i] upgrades schema_version i + 1 to i + 2, or refuses with the paths it cannot migrate.
const migrations: ReadonlyArray<(raw: RawDocument) => MigrationResult> = [migrate_v1_to_v2];

function fail(log: Logger, code: LoadErrorCode, message: string, details: string[] = []): LoadResult {
  log.warn("document rejected", { code, message, detail_count: details.length });
  return { ok: false, error: { code, message, details } };
}

export function load_document(raw: unknown, log: Logger = null_logger): LoadResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail(log, "not_object", "document must be a JSON object");
  let record = raw as RawDocument;
  if (record["format"] !== "loomsmith") return fail(log, "wrong_format", "format must be \"loomsmith\"");
  const version = record["schema_version"];
  if (typeof version !== "number" || !Number.isInteger(version)) return fail(log, "invalid_document", "schema_version must be an integer");
  if (version > current_schema_version) {
    return fail(log, "future_version", `schema_version ${version} is newer than supported ${current_schema_version}; update loomsmith`);
  }
  if (version < 1) return fail(log, "unsupported_version", `schema_version ${version} is not supported`);
  const migrated_from = version < current_schema_version ? version : null;
  for (let from = version; from < current_schema_version; from += 1) {
    const step = migrations[from - 1];
    if (!step) return fail(log, "unsupported_version", `no migration from schema_version ${from}`);
    const migrated = step(record);
    if (!migrated.ok) return fail(log, "migration_failed", `schema_version ${from} document cannot be migrated to ${from + 1}`, migrated.details);
    record = migrated.raw;
    log.info("document migrated", { from, to: from + 1, ...migrated.stats });
  }
  const parsed = document_schema.safeParse(record);
  if (!parsed.success) {
    const details = format_issues(parsed.error.issues);
    return fail(log, "invalid_document", "document failed schema validation", details);
  }
  log.debug("document loaded", { document_id: parsed.data.document_id, revision: parsed.data.revision });
  return { ok: true, doc: canonicalize_document(parsed.data), migrated_from };
}
