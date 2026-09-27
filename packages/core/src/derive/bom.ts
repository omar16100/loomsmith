import { compare_strings } from "../model/canonical.ts";
import { build_index, type DocIndex } from "../model/doc_index.ts";
import { all_harnesses, in_scope, type ScopeOptions } from "../model/scope.ts";
import type { LoomDocument } from "../schema/document.ts";
import type { PartUse } from "../schema/primitives.ts";
import { cut_length, round_mm } from "./topology.ts";
import { colour_code } from "./wire_list.ts";

export type BomCategory = "housing" | "terminal" | "seal" | "splice" | "wire";

export interface BomLine {
  category: BomCategory;
  part_id: string | null;
  part_number: string | null;
  description: string;
  quantity: number;
  unit: "pcs" | "mm";
  unknown_quantity: number;
  identification: string;
}

const category_order: Record<BomCategory, number> = { housing: 0, terminal: 1, seal: 2, splice: 3, wire: 4 };

export function derive_bom(doc: LoomDocument, options: ScopeOptions = all_harnesses, index: DocIndex = build_index(doc)): BomLine[] {
  const lines = new Map<string, BomLine>();
  const add_part = (category: BomCategory, use: PartUse, quantity = 1): void => {
    const key = `${category}|${use.part_id ?? "unidentified"}|${use.identification}`;
    const existing = lines.get(key);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    const found = use.part_id === null ? undefined : index.parts.get(use.part_id);
    lines.set(key, {
      category,
      part_id: use.part_id,
      part_number: found?.part_number ?? null,
      description: found?.description ?? found?.part_number ?? use.part_id ?? `UNIDENTIFIED ${category}`,
      quantity,
      unit: "pcs",
      unknown_quantity: 0,
      identification: use.identification,
    });
  };
  for (const c of doc.connectors) if (in_scope(options, c.harness_id)) add_part("housing", c.housing);
  for (const k of doc.contacts) {
    const owner = index.connectors.get(k.connector_id);
    if (!owner || !in_scope(options, owner.harness_id)) continue;
    add_part("terminal", k.terminal);
    if (k.seal !== null) add_part("seal", k.seal.part, k.seal.quantity);
  }
  for (const s of doc.splices) if (in_scope(options, s.harness_id)) add_part("splice", s.part);
  for (const w of doc.wires) {
    if (!in_scope(options, w.harness_id)) continue;
    // Group by the nominal designation ("0.5 mm2", "20 AWG", Toyota "0.5") as written, never by area alone.
    const size = w.spec.designation ?? `${w.spec.cross_section_mm2 ?? "UNKNOWN"} mm2`;
    const description = `${size} ${colour_code(w.spec)}${w.spec.insulation === null ? "" : ` ${w.spec.insulation}`}`;
    const key = `wire|${w.spec.cross_section_mm2 ?? "unknown"}|${description}`;
    const line: BomLine = lines.get(key) ?? { category: "wire", part_id: null, part_number: null, description, quantity: 0, unit: "mm", unknown_quantity: 0, identification: "n/a" };
    const length = cut_length(index, w);
    if (length.status === "known" && length.nominal_mm !== null) line.quantity = round_mm(line.quantity + length.nominal_mm);
    else line.unknown_quantity += 1;
    lines.set(key, line);
  }
  return [...lines.values()].sort(
    (a, b) =>
      category_order[a.category] - category_order[b.category] ||
      compare_strings(a.description, b.description) ||
      compare_strings(a.identification, b.identification) ||
      compare_strings(a.part_id ?? "", b.part_id ?? ""),
  );
}
