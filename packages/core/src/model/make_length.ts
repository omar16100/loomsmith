import type { Datum, Length } from "../schema/primitives.ts";

export interface LengthInput {
  nominal_mm: number | null;
  tol_plus_mm?: number | null;
  tol_minus_mm?: number | null;
  datum_a?: Datum | null;
  datum_b?: Datum | null;
  note?: string | null;
}

// New lengths are never short: with no stated minus tolerance the built segment may not be shorter than nominal.
// Only an omitted field takes a default; an explicit null stays null (unknown).
export function make_length(input: LengthInput): Length {
  return {
    nominal_mm: input.nominal_mm,
    tol_plus_mm: input.tol_plus_mm ?? null,
    tol_minus_mm: input.tol_minus_mm === undefined ? 0 : input.tol_minus_mm,
    datum_a: input.datum_a ?? null,
    datum_b: input.datum_b ?? null,
    note: input.note ?? null,
  };
}
