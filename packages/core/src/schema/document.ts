import * as z from "zod";
import { bbox_schema, id_schema, label_schema, length_schema, origin_schema, part_use_schema, text_schema } from "./primitives.ts";

export const current_schema_version = 1;

export const harness_schema = z.strictObject({ id: id_schema, label: label_schema });

export const part_kind_schema = z.enum(["housing", "terminal", "seal", "splice", "wire", "covering", "other"]);
export const part_schema = z.strictObject({
  id: id_schema,
  kind: part_kind_schema,
  manufacturer: text_schema,
  part_number: text_schema,
  description: text_schema,
});

export const cavity_schema = z.strictObject({ id: id_schema, label: label_schema });

export const connector_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  label: label_schema,
  face_view: z.enum(["mating_face", "wire_entry"]).nullable(),
  housing_gender: z.enum(["male", "female"]).nullable(),
  safety_class: z.enum(["srs"]).nullable(),
  housing: part_use_schema,
  cavities: z.array(cavity_schema).min(1).max(256),
});

export const contact_schema = z.strictObject({
  id: id_schema,
  connector_id: id_schema,
  cavity_id: id_schema,
  contact_gender: z.enum(["male", "female"]).nullable(),
  terminal: part_use_schema,
  seal: z.strictObject({ part: part_use_schema, quantity: z.number().int().min(1).max(4) }).nullable(),
  max_wire_ends: z.number().int().min(1).max(4),
});

export const splice_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  label: label_schema,
  part: part_use_schema,
  max_wire_ends: z.number().int().min(2).max(32),
});

export const ground_point_schema = z.strictObject({ id: id_schema, harness_id: id_schema, label: label_schema });

export const wire_end_schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("contact"), contact_id: id_schema }),
  z.strictObject({ kind: z.literal("splice"), splice_id: id_schema }),
  z.strictObject({ kind: z.literal("ground_point"), ground_point_id: id_schema }),
  z.strictObject({ kind: z.literal("open") }),
]);

const colour_schema = z.string().min(1).max(16);

export const wire_spec_schema = z.strictObject({
  cross_section_mm2: z.number().positive().nullable(),
  designation: text_schema,
  base_colour: colour_schema.nullable(),
  stripe_colours: z.array(colour_schema).max(3),
  insulation: text_schema,
});

export const wire_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  label: label_schema,
  ends: z.tuple([wire_end_schema, wire_end_schema]),
  spec: wire_spec_schema,
  route: z.array(id_schema).nullable(),
  allowances: z.strictObject({
    end_a_mm: z.number().nonnegative(),
    end_b_mm: z.number().nonnegative(),
    service_mm: z.number().nonnegative(),
  }),
});

export const node_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  kind: z.enum(["connector", "breakout", "clip", "grommet", "splice", "ground"]),
  ref_id: id_schema.nullable(),
});

export const segment_schema = z.strictObject({
  id: id_schema,
  harness_id: id_schema,
  node_a: id_schema,
  node_b: id_schema,
  length: length_schema,
});

export const mating_schema = z.strictObject({
  id: id_schema,
  connector_a: id_schema,
  connector_b: id_schema,
  cavity_map: z.array(z.strictObject({ cavity_a: id_schema, cavity_b: id_schema })).min(1),
});

export const asset_schema = z.strictObject({
  id: id_schema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  media_type: z.string().min(1).max(100),
  // Portable locator only: asset:// or synthetic:// URI, or a relative path. No absolute paths (POSIX or
  // Windows/UNC), no signed or expiring URLs, and no ".." path segment (after "/" or "\", or at the start), so a
  // locator can never climb out of the asset store.
  blob_ref: z.string().max(500).regex(/^(?!(?:.*[/\\])?\.\.(?:[/\\]|$))((asset|synthetic):\/\/[^\s?#]+|[^\s/\\~:?#][^\s:?#]*)$/),
  title: text_schema,
});

export const evidence_schema = z.strictObject({
  id: id_schema,
  entity_id: id_schema,
  field: z.string().min(1).max(64),
  origin: origin_schema,
  value_json: z.string(),
  source: z
    .strictObject({ asset_id: id_schema, page_index: z.number().int().nonnegative(), bbox: bbox_schema.nullable() })
    .nullable(),
  note: text_schema,
});

export const review_schema = z.strictObject({
  id: id_schema,
  entity_id: id_schema,
  field: z.string().min(1).max(64),
  status: z.enum(["approved", "rejected"]),
  reviewed_value_json: z.string(),
  revision: z.number().int().nonnegative(),
});

export const view_position_schema = z.strictObject({ id: id_schema, x: z.number(), y: z.number() });

export const project_schema = z.strictObject({ label: label_schema });

export const collection_names = [
  "harnesses", "parts", "connectors", "contacts", "splices", "ground_points", "wires",
  "nodes", "segments", "matings", "assets", "evidence", "reviews", "view_positions",
] as const;
export type CollectionName = (typeof collection_names)[number];

export const collection_schemas = {
  harnesses: harness_schema,
  parts: part_schema,
  connectors: connector_schema,
  contacts: contact_schema,
  splices: splice_schema,
  ground_points: ground_point_schema,
  wires: wire_schema,
  nodes: node_schema,
  segments: segment_schema,
  matings: mating_schema,
  assets: asset_schema,
  evidence: evidence_schema,
  reviews: review_schema,
  view_positions: view_position_schema,
} satisfies Record<CollectionName, z.ZodType>;

export const document_schema = z.strictObject({
  format: z.literal("loomsmith"),
  schema_version: z.literal(current_schema_version),
  document_id: id_schema,
  revision: z.number().int().nonnegative(),
  applied_batch_ids: z.array(id_schema),
  project: project_schema,
  harnesses: z.array(harness_schema),
  parts: z.array(part_schema),
  connectors: z.array(connector_schema),
  contacts: z.array(contact_schema),
  splices: z.array(splice_schema),
  ground_points: z.array(ground_point_schema),
  wires: z.array(wire_schema),
  nodes: z.array(node_schema),
  segments: z.array(segment_schema),
  matings: z.array(mating_schema),
  assets: z.array(asset_schema),
  evidence: z.array(evidence_schema),
  reviews: z.array(review_schema),
  view_positions: z.array(view_position_schema),
});

export type LoomDocument = z.infer<typeof document_schema>;
export type Project = z.infer<typeof project_schema>;
export type Harness = z.infer<typeof harness_schema>;
export type PartKind = z.infer<typeof part_kind_schema>;
export type Part = z.infer<typeof part_schema>;
export type Cavity = z.infer<typeof cavity_schema>;
export type Connector = z.infer<typeof connector_schema>;
export type Contact = z.infer<typeof contact_schema>;
export type Splice = z.infer<typeof splice_schema>;
export type GroundPoint = z.infer<typeof ground_point_schema>;
export type WireEnd = z.infer<typeof wire_end_schema>;
export type WireSpec = z.infer<typeof wire_spec_schema>;
export type Wire = z.infer<typeof wire_schema>;
export type TopologyNode = z.infer<typeof node_schema>;
export type Segment = z.infer<typeof segment_schema>;
export type Mating = z.infer<typeof mating_schema>;
export type Asset = z.infer<typeof asset_schema>;
export type Evidence = z.infer<typeof evidence_schema>;
export type Review = z.infer<typeof review_schema>;
export type ViewPosition = z.infer<typeof view_position_schema>;
