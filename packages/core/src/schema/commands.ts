import * as z from "zod";
import { collection_names } from "./document.ts";
import { id_schema } from "./primitives.ts";

export const command_schema_version = 1;

const collection_name_schema = z.enum(collection_names);
const record_schema = z.record(z.string(), z.unknown());

export const insert_command_schema = z.strictObject({
  op: z.literal("insert"),
  collection: collection_name_schema,
  entity: record_schema,
});

export const update_command_schema = z.strictObject({
  op: z.literal("update"),
  collection: collection_name_schema,
  id: id_schema,
  set: record_schema,
  expect: record_schema.optional(),
});

export const delete_command_schema = z.strictObject({
  op: z.literal("delete"),
  collection: collection_name_schema,
  id: id_schema,
  expect_entity: record_schema.optional(),
});

export const update_project_command_schema = z.strictObject({
  op: z.literal("update_project"),
  set: record_schema,
  expect: record_schema.optional(),
});

export const command_schema = z.discriminatedUnion("op", [
  insert_command_schema,
  update_command_schema,
  delete_command_schema,
  update_project_command_schema,
]);

export const batch_schema = z.strictObject({
  batch_id: id_schema,
  document_id: id_schema,
  command_schema_version: z.literal(command_schema_version),
  expected_revision: z.number().int().nonnegative(),
  created_at: z.string().min(1).max(40),
  commands: z.array(command_schema).min(1).max(10000),
});

export type InsertCommand = z.infer<typeof insert_command_schema>;
export type UpdateCommand = z.infer<typeof update_command_schema>;
export type DeleteCommand = z.infer<typeof delete_command_schema>;
export type UpdateProjectCommand = z.infer<typeof update_project_command_schema>;
export type Command = z.infer<typeof command_schema>;
export type Batch = z.infer<typeof batch_schema>;
