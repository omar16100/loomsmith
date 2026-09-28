import * as z from "zod";
import { canonical_json } from "../model/canonical.ts";

type RawRecord = Record<string, unknown>;
// One count per collection touched by the migration; the caller logs these (core stays silent, see load_document.ts).
export type MigrationStats = Readonly<Record<string, number>>;
export type MigrationResult = { ok: true; raw: RawRecord; stats: MigrationStats } | { ok: false; details: string[] };

// Frozen copies of the version 1 shapes this step rewrites. They must never follow later schema changes.
const v1_length_schema = z.strictObject({
  nominal_mm: z.number().positive().nullable(),
  tol_mm: z.number().nonnegative().nullable(),
  datum: z.string().min(1).max(500).nullable(),
});
const v1_allowances_schema = z.strictObject({
  end_a_mm: z.number().nonnegative(),
  end_b_mm: z.number().nonnegative(),
  service_mm: z.number().nonnegative(),
});
// build_index order without view_positions: evidence and reviews resolve to the first entity with an id.
const v1_indexed_collections = [
  "harnesses", "parts", "connectors", "contacts", "splices", "ground_points", "wires",
  "nodes", "segments", "matings", "assets", "evidence", "reviews",
] as const;

const is_record = (value: unknown): value is RawRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const records_of = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function issues_at(prefix: string, issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>): string[] {
  return issues.map((issue) => `${[prefix, ...issue.path.map(String)].join(".")}: ${issue.message}`);
}

// Value for value, nothing invented: the symmetric tolerance becomes equal bands, the free-text datum moves to note
// and the measurement points stay unknown (version 1 never recorded them).
function length_to_v2(v: z.infer<typeof v1_length_schema>): RawRecord {
  return { nominal_mm: v.nominal_mm, tol_plus_mm: v.tol_mm, tol_minus_mm: v.tol_mm, datum_a: null, datum_b: null, note: v.datum };
}

// Version 1 kept one number per end: the wire added at that end, from a datum it never recorded.
function allowances_to_v2(v: z.infer<typeof v1_allowances_schema>): RawRecord {
  return {
    end_a: { datum: null, beyond_datum_mm: v.end_a_mm },
    end_b: { datum: null, beyond_datum_mm: v.end_b_mm },
    service_loop_mm: v.service_mm,
  };
}

// A stored value is translated only when it is exactly the canonical JSON of a valid version 1 value. Anything
// else stays as it is; check_record_states proves its state did not change.
function translate_recorded<T>(recorded: unknown, schema: z.ZodType<T>, to_v2: (value: T) => RawRecord): unknown {
  if (typeof recorded !== "string") return recorded;
  let parsed: unknown;
  try {
    parsed = JSON.parse(recorded);
  } catch {
    return recorded;
  }
  const valid = schema.safeParse(parsed);
  if (!valid.success || canonical_json(parsed) !== recorded) return recorded;
  return canonical_json(to_v2(valid.data));
}

function entities_by_id(raw: RawRecord): Map<string, RawRecord[]> {
  const found = new Map<string, RawRecord[]>();
  for (const collection of v1_indexed_collections) {
    for (const entity of records_of(raw[collection])) {
      if (!is_record(entity) || typeof entity["id"] !== "string") continue;
      const list = found.get(entity["id"]) ?? [];
      list.push(entity);
      found.set(entity["id"], list);
    }
  }
  return found;
}

// Every evidence row and review keeps its current or stale state. A migration that would revive a stale record, or
// stale a current one, is refused rather than guessed.
function check_record_states(before: RawRecord, after: RawRecord): string[] {
  const problems: string[] = [];
  const old_index = entities_by_id(before);
  const new_index = entities_by_id(after);
  // Canonical values of one field of every entity with an id, before and after, computed once per (id, field).
  const values_cache = new Map<string, { old_values: string[]; new_values: string[] }>();
  const values_of = (entity_id: string, field: string) => {
    const key = JSON.stringify([entity_id, field]);
    let values = values_cache.get(key);
    if (!values) {
      values = {
        old_values: (old_index.get(entity_id) ?? []).map((entity) => canonical_json(entity[field])),
        new_values: (new_index.get(entity_id) ?? []).map((entity) => canonical_json(entity[field])),
      };
      values_cache.set(key, values);
    }
    return values;
  };
  for (const [collection, key] of [["evidence", "value_json"], ["reviews", "reviewed_value_json"]] as const) {
    const new_records = records_of(after[collection]);
    records_of(before[collection]).forEach((old_record, i) => {
      const new_record = new_records[i];
      if (!is_record(old_record) || !is_record(new_record)) return;
      const entity_id = old_record["entity_id"];
      const field = old_record["field"];
      if (typeof entity_id !== "string" || typeof field !== "string") return;
      const { old_values, new_values } = values_of(entity_id, field);
      if (old_values.length > 1 && JSON.stringify(old_values) !== JSON.stringify(new_values)) {
        problems.push(`${collection}.${i}: id ${entity_id} is used more than once and its ${field} changed, so the target is ambiguous`);
        return;
      }
      const was_current = old_values[0] !== undefined && old_values[0] === old_record[key];
      const is_current = new_values[0] !== undefined && new_values[0] === new_record[key];
      if (was_current !== is_current) {
        problems.push(`${collection}.${i}: ${entity_id}.${field} would change from ${was_current ? "current" : "stale"} to ${is_current ? "current" : "stale"}`);
      }
    });
  }
  return problems;
}

export function migrate_v1_to_v2(raw: RawRecord): MigrationResult {
  const details: string[] = [];
  const segment_ids = new Set<string>();
  const wire_ids = new Set<string>();
  const next: RawRecord = { ...raw, schema_version: 2 };
  if (Array.isArray(raw["segments"])) {
    next["segments"] = raw["segments"].map((s: unknown, i: number) => {
      if (!is_record(s)) return s;
      if (typeof s["id"] === "string") segment_ids.add(s["id"]);
      if ("length_estimate" in s) details.push(`segments.${i}.length_estimate: not a schema_version 1 field`);
      const length = v1_length_schema.safeParse(s["length"]);
      if (!length.success) {
        details.push(...issues_at(`segments.${i}.length`, length.error.issues));
        return s;
      }
      return { ...s, length: length_to_v2(length.data), length_estimate: null };
    });
  }
  if (Array.isArray(raw["wires"])) {
    next["wires"] = raw["wires"].map((w: unknown, i: number) => {
      if (!is_record(w)) return w;
      if (typeof w["id"] === "string") wire_ids.add(w["id"]);
      const allowances = v1_allowances_schema.safeParse(w["allowances"]);
      if (!allowances.success) {
        details.push(...issues_at(`wires.${i}.allowances`, allowances.error.issues));
        return w;
      }
      return { ...w, allowances: allowances_to_v2(allowances.data) };
    });
  }
  if (details.length > 0) return { ok: false, details };
  const translate = (entity_id: unknown, field: unknown, recorded: unknown): unknown => {
    if (typeof entity_id !== "string") return recorded;
    if (field === "length" && segment_ids.has(entity_id)) return translate_recorded(recorded, v1_length_schema, length_to_v2);
    if (field === "allowances" && wire_ids.has(entity_id)) return translate_recorded(recorded, v1_allowances_schema, allowances_to_v2);
    return recorded;
  };
  let evidence_translated = 0;
  let evidence_unchanged = 0;
  if (Array.isArray(raw["evidence"])) {
    next["evidence"] = raw["evidence"].map((e: unknown) => {
      if (!is_record(e)) {
        evidence_unchanged += 1;
        return e;
      }
      const value_json = translate(e["entity_id"], e["field"], e["value_json"]);
      if (value_json !== e["value_json"]) evidence_translated += 1;
      else evidence_unchanged += 1;
      return { ...e, value_json };
    });
  }
  let reviews_translated = 0;
  let reviews_unchanged = 0;
  if (Array.isArray(raw["reviews"])) {
    next["reviews"] = raw["reviews"].map((r: unknown) => {
      if (!is_record(r)) {
        reviews_unchanged += 1;
        return r;
      }
      const reviewed_value_json = translate(r["entity_id"], r["field"], r["reviewed_value_json"]);
      if (reviewed_value_json !== r["reviewed_value_json"]) reviews_translated += 1;
      else reviews_unchanged += 1;
      return { ...r, reviewed_value_json };
    });
  }
  const state_problems = check_record_states(raw, next);
  if (state_problems.length > 0) return { ok: false, details: state_problems };
  const stats: MigrationStats = {
    segments: Array.isArray(raw["segments"]) ? raw["segments"].length : 0,
    wires: Array.isArray(raw["wires"]) ? raw["wires"].length : 0,
    evidence_translated, evidence_unchanged, reviews_translated, reviews_unchanged,
  };
  return { ok: true, raw: next, stats };
}
