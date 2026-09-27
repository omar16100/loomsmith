import * as z from "zod";

// Restricted alphabet so composite keys ("contact:<id>", "<connector>/<cavity>") can never collide.
export const id_schema = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
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

export const length_schema = z.strictObject({
  nominal_mm: z.number().positive().nullable(),
  tol_mm: z.number().nonnegative().nullable(),
  datum: text_schema,
});

export const origin_schema = z.enum(["measured", "documented", "inferred", "assumed"]);

// PDF user space: points, origin bottom-left, [x0, y0, x1, y1]; page_index is 0-based.
export const bbox_schema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export type PartUse = z.infer<typeof part_use_schema>;
export type Length = z.infer<typeof length_schema>;
export type Origin = z.infer<typeof origin_schema>;
