import type { Command } from "../schema/commands.ts";
import type { CollectionName } from "../schema/document.ts";

export function cmd_insert(collection: CollectionName, entity: { id: string } & Record<string, unknown>): Command {
  return { op: "insert", collection, entity };
}

export function cmd_update(collection: CollectionName, id: string, set: Record<string, unknown>, expect?: Record<string, unknown>): Command {
  return expect === undefined ? { op: "update", collection, id, set } : { op: "update", collection, id, set, expect };
}

export function cmd_delete(collection: CollectionName, id: string): Command {
  return { op: "delete", collection, id };
}
