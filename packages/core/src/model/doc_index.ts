import {
  collection_names,
  type Asset, type CollectionName, type Connector, type Contact, type GroundPoint, type Harness, type LoomDocument,
  type Mating, type Part, type Segment, type Splice, type TopologyNode, type Wire, type WireEnd,
} from "../schema/document.ts";

export interface EntityRef {
  collection: CollectionName;
  entity: { id: string };
}

export interface WireEndRef {
  wire_id: string;
  end_index: 0 | 1;
}

export interface DocIndex {
  by_id: Map<string, EntityRef>;
  duplicate_ids: string[];
  harnesses: Map<string, Harness>;
  parts: Map<string, Part>;
  connectors: Map<string, Connector>;
  contacts: Map<string, Contact>;
  splices: Map<string, Splice>;
  ground_points: Map<string, GroundPoint>;
  wires: Map<string, Wire>;
  nodes: Map<string, TopologyNode>;
  segments: Map<string, Segment>;
  matings: Map<string, Mating>;
  assets: Map<string, Asset>;
  contacts_by_cavity: Map<string, Contact[]>;
  wire_ends_by_endpoint: Map<string, WireEndRef[]>;
  nodes_by_ref: Map<string, TopologyNode[]>;
}

export function cavity_key(connector_id: string, cavity_id: string): string {
  return `${connector_id}/${cavity_id}`;
}

export function endpoint_key(end: WireEnd): string | null {
  switch (end.kind) {
    case "contact":
      return `contact:${end.contact_id}`;
    case "splice":
      return `splice:${end.splice_id}`;
    case "ground_point":
      return `ground_point:${end.ground_point_id}`;
    case "open":
      return null;
  }
}

export function push_to<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// Evidence and reviews address top-level fields only ("spec", "length", "ends"); "id" is not reviewable.
export function has_field(index: DocIndex, entity_id: string, field: string): boolean {
  const ref = index.by_id.get(entity_id);
  return ref !== undefined && field !== "id" && Object.hasOwn(ref.entity, field);
}

function by_id_map<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function build_index(doc: LoomDocument): DocIndex {
  const by_id = new Map<string, EntityRef>();
  const duplicates = new Set<string>();
  for (const collection of collection_names) {
    if (collection === "view_positions") continue;
    for (const entity of doc[collection]) {
      if (by_id.has(entity.id)) duplicates.add(entity.id);
      else by_id.set(entity.id, { collection, entity });
    }
  }
  const contacts_by_cavity = new Map<string, Contact[]>();
  for (const contact of doc.contacts) push_to(contacts_by_cavity, cavity_key(contact.connector_id, contact.cavity_id), contact);
  const wire_ends_by_endpoint = new Map<string, WireEndRef[]>();
  for (const wire of doc.wires) {
    wire.ends.forEach((end, i) => {
      const key = endpoint_key(end);
      if (key !== null) push_to(wire_ends_by_endpoint, key, { wire_id: wire.id, end_index: i === 0 ? 0 : 1 });
    });
  }
  const nodes_by_ref = new Map<string, TopologyNode[]>();
  for (const n of doc.nodes) if (n.ref_id !== null) push_to(nodes_by_ref, n.ref_id, n);
  return {
    by_id,
    duplicate_ids: [...duplicates].sort(),
    harnesses: by_id_map(doc.harnesses),
    parts: by_id_map(doc.parts),
    connectors: by_id_map(doc.connectors),
    contacts: by_id_map(doc.contacts),
    splices: by_id_map(doc.splices),
    ground_points: by_id_map(doc.ground_points),
    wires: by_id_map(doc.wires),
    nodes: by_id_map(doc.nodes),
    segments: by_id_map(doc.segments),
    matings: by_id_map(doc.matings),
    assets: by_id_map(doc.assets),
    contacts_by_cavity,
    wire_ends_by_endpoint,
    nodes_by_ref,
  };
}
