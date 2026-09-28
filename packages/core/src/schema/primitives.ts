import * as z from "zod";

// Restricted alphabet so composite keys ("contact:<id>", "<connector>/<cavity>") can never collide. "." and ".."
// are refused so an id used as a file or path name can never mean "this directory" or "the parent directory".
export const id_schema = z.string().regex(/^(?!\.\.?$)[A-Za-z0-9_.-]{1,128}$/);
// No ":" in labels: a bench probe label is "<connector label>:<cavity label>", so it can never equal a
// ground point label or another probe label.
export const label_schema = z.string().min(1).max(64).regex(/^[^:]*$/);
export const text_schema = z.string().min(1).max(500).nullable();

export const part_use_schema = z.strictObject({
  part_id: id_schema.nullable(),
  identification: z.enum(["identified", "candidate", "unknown"]),
  compatibility: z.enum(["compatible", "incompatible", "unknown"]),
  procurement: z.enum(["available", "unavailable", "reused", "unknown"]),
});

// Where a segment length is measured to at one end. Each value is a point on one node kind (model/datums.ts,
// S_DATUM_NODE_KIND): the two connector faces on connector nodes, a centre on every other kind. No terminal tip yet:
// terminals of one connector can sit at different depths and a datum does not name a contact.
export const datum_schema = z.enum([
  "connector_back_face",
  "connector_mating_face",
  "breakout_centre",
  "clip_centre",
  "grommet_centre",
  "splice_centre",
  "ground_stud_centre",
]);

// A build tolerance around nominal, each side separately (a plus-only band has tol_minus_mm 0); null is unknown.
// datum_a and datum_b are the measurement points at the segment's node_a and node_b.
export const length_schema = z.strictObject({
  nominal_mm: z.number().positive().nullable(),
  tol_plus_mm: z.number().nonnegative().nullable(),
  tol_minus_mm: z.number().nonnegative().nullable(),
  datum_a: datum_schema.nullable(),
  datum_b: datum_schema.nullable(),
  note: text_schema,
});

// A range guessed before measuring (for example from body dimensions). Never used as a length: it only lets
// validation flag a measurement outside it (W_LENGTH_OUTSIDE_ESTIMATE). min_mm <= max_mm is S_LENGTH_ESTIMATE_RANGE.
export const length_estimate_schema = z.strictObject({
  min_mm: z.number().positive(),
  max_mm: z.number().positive(),
  method: z.string().min(1).max(500),
});

export const origin_schema = z.enum(["measured", "documented", "inferred", "assumed"]);

// PDF user space: points, origin bottom-left, [x0, y0, x1, y1]; page_index is 0-based.
export const bbox_schema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export type PartUse = z.infer<typeof part_use_schema>;
export type Length = z.infer<typeof length_schema>;
export type Datum = z.infer<typeof datum_schema>;
export type LengthEstimate = z.infer<typeof length_estimate_schema>;
export type Origin = z.infer<typeof origin_schema>;
