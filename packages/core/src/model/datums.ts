import type { TopologyNode } from "../schema/document.ts";
import type { Datum } from "../schema/primitives.ts";

// The node kind each measurement point belongs to (S_DATUM_NODE_KIND).
export const datum_node_kind: Readonly<Record<Datum, TopologyNode["kind"]>> = Object.freeze({
  connector_back_face: "connector",
  connector_mating_face: "connector",
  breakout_centre: "breakout",
  clip_centre: "clip",
  grommet_centre: "grommet",
  splice_centre: "splice",
  ground_stud_centre: "ground",
});

// The usual measurement point per node kind (a connector is measured to its back face, where the wires leave the
// housing). Editors prefill it; core never applies it silently.
export const default_datum: Readonly<Record<TopologyNode["kind"], Datum>> = Object.freeze({
  connector: "connector_back_face",
  breakout: "breakout_centre",
  clip: "clip_centre",
  grommet: "grommet_centre",
  splice: "splice_centre",
  ground: "ground_stud_centre",
});
