import type * as z from "zod";
import { canonical_json } from "../model/canonical.ts";
import { format_issues } from "../schema/format_issues.ts";
import type { Command } from "../schema/commands.ts";
import { collection_schemas, project_schema, type CollectionName, type LoomDocument } from "../schema/document.ts";

export type AnyEntity = { id: string } & Record<string, unknown>;
export type CommandFailureCode = "precondition_failed" | "invalid_entity";
export type CommandStep =
  | { ok: true; doc: LoomDocument; inverse: Command[] }
  | { ok: false; code: CommandFailureCode; message: string };

export function get_collection(doc: LoomDocument, name: CollectionName): readonly AnyEntity[] {
  return doc[name] as unknown as readonly AnyEntity[];
}

function with_collection(doc: LoomDocument, name: CollectionName, items: AnyEntity[]): LoomDocument {
  return { ...doc, [name]: items } as unknown as LoomDocument;
}

function parse_entity(name: CollectionName, value: unknown): { ok: true; entity: AnyEntity } | { ok: false; message: string } {
  const schema: z.ZodType = collection_schemas[name];
  const result = schema.safeParse(value);
  if (!result.success) return { ok: false, message: format_issues(result.error.issues).join("; ") };
  return { ok: true, entity: result.data as AnyEntity };
}

function fail(code: CommandFailureCode, message: string): CommandStep {
  return { ok: false, code, message };
}

function check_expect(current: Record<string, unknown>, expect: Record<string, unknown> | undefined, where: string): string | null {
  for (const [key, value] of Object.entries(expect ?? {})) {
    if (canonical_json(current[key]) !== canonical_json(value)) return `${where}.${key} does not match the expected value`;
  }
  return null;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

export function apply_command(doc: LoomDocument, command: Command): CommandStep {
  if (command.op === "update_project") {
    const current: Record<string, unknown> = doc.project;
    const mismatch = check_expect(current, command.expect, "project");
    if (mismatch !== null) return fail("precondition_failed", mismatch);
    const parsed = project_schema.safeParse({ ...current, ...command.set });
    if (!parsed.success) return fail("invalid_entity", `project: ${format_issues(parsed.error.issues).join("; ")}`);
    const keys = Object.keys(command.set);
    return {
      ok: true,
      doc: { ...doc, project: parsed.data },
      inverse: [{ op: "update_project", set: pick(current, keys), expect: pick(parsed.data, keys) }],
    };
  }
  const name = command.collection;
  const items = get_collection(doc, name);
  switch (command.op) {
    case "insert": {
      const parsed = parse_entity(name, command.entity);
      if (!parsed.ok) return fail("invalid_entity", `${name}: ${parsed.message}`);
      const entity = parsed.entity;
      if (items.some((item) => item.id === entity.id)) return fail("precondition_failed", `${name}/${entity.id} already exists`);
      return {
        ok: true,
        doc: with_collection(doc, name, [...items, entity]),
        inverse: [{ op: "delete", collection: name, id: entity.id, expect_entity: entity }],
      };
    }
    case "update": {
      const matches = items.filter((item) => item.id === command.id);
      if (matches.length > 1) return fail("precondition_failed", `${name}/${command.id} is ambiguous: ${matches.length} entities share this id; repair the duplicate first`);
      const current = matches[0];
      if (!current) return fail("precondition_failed", `${name}/${command.id} does not exist`);
      if ("id" in command.set) return fail("invalid_entity", `${name}/${command.id}: id cannot be changed`);
      const mismatch = check_expect(current, command.expect, `${name}/${command.id}`);
      if (mismatch !== null) return fail("precondition_failed", mismatch);
      const parsed = parse_entity(name, { ...current, ...command.set });
      if (!parsed.ok) return fail("invalid_entity", `${name}/${command.id}: ${parsed.message}`);
      const updated = parsed.entity;
      const keys = Object.keys(command.set);
      return {
        ok: true,
        doc: with_collection(doc, name, items.map((item) => (item.id === command.id ? updated : item))),
        inverse: [{ op: "update", collection: name, id: command.id, set: pick(current, keys), expect: pick(updated, keys) }],
      };
    }
    case "delete": {
      const matches = items.filter((item) => item.id === command.id);
      if (matches.length > 1) return fail("precondition_failed", `${name}/${command.id} is ambiguous: ${matches.length} entities share this id; repair the duplicate first`);
      const current = matches[0];
      if (!current) return fail("precondition_failed", `${name}/${command.id} does not exist`);
      if (command.expect_entity !== undefined && canonical_json(current) !== canonical_json(command.expect_entity)) {
        return fail("precondition_failed", `${name}/${command.id} changed since it was read`);
      }
      return {
        ok: true,
        doc: with_collection(doc, name, items.filter((item) => item.id !== command.id)),
        inverse: [{ op: "insert", collection: name, entity: current }],
      };
    }
  }
}
