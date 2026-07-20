/**
 * MOSAIC causal graph (lite tier).
 *
 * A directed acyclic graph over the surveillance streams, the six driver
 * covariates, latent transmission, and the outbreak outcome. This is the set of
 * causal ASSUMPTIONS the interventional and counterfactual queries rely on: it
 * is stated explicitly and shown to the user, not learned from outcomes.
 *
 * The structure mirrors how the driver panel is generated in
 * `lib/demo/sites.ts`: `climate`, `immunity`, and `mobility` are upstream causes
 * of transmission, while `clinical`, `positivity`, `icu`, `wastewater`, and the
 * genomic anomaly are DESCENDANTS of latent incidence. That descendant structure
 * is what makes them "bad controls": conditioning on a descendant of the
 * treatment or the outcome biases an effect estimate.
 *
 * All graph algorithms (ancestors, descendants, d-separation, backdoor
 * adjustment) are implemented here with no external dependency, matching the
 * lite tier's self-contained style. The graph is small (~15 nodes) so the
 * path-enumeration d-separation is exact and cheap.
 *
 * References: Pearl, Causality (2009); Pearl, Glymour, Jewell, Causal Inference
 * in Statistics (2016); Cinelli, Forney, Pearl, "A Crash Course in Good and Bad
 * Controls" (2022).
 */

export type NodeRole =
  | "treatment"
  | "confounder"
  | "context"
  | "mediator"
  | "outcome"
  | "latent"
  | "descendant";

export interface CausalNode {
  id: string;
  label: string;
  role: NodeRole;
  /** whether the node is measured in the console (observable / adjustable) */
  observed: boolean;
  /** short human note shown in the DAG legend / tooltip */
  note: string;
  /** layout column (0 = upstream causes ... 4 = measurements), for the SVG */
  layer: number;
}

export interface CausalEdge {
  from: string;
  to: string;
  /** sign of the assumed structural effect along the edge */
  sign: "+" | "-" | "0";
  note?: string;
}

export interface CausalGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
}

/* ----------------------------- the graph ------------------------------ */

export const MOSAIC_DAG: CausalGraph = {
  nodes: [
    { id: "region", label: "Region / development", role: "context", observed: true, layer: 0,
      note: "Background context that shapes both immunity coverage and local climate suitability." },
    { id: "climate", label: "Climate suitability", role: "confounder", observed: true, layer: 1,
      note: "Seasonal / climatic forcing. Raises transmission and correlates with where immunity is high, so it confounds immunity vs. growth." },
    { id: "immunity", label: "Immunity coverage", role: "treatment", observed: true, layer: 1,
      note: "Population immunity (vaccination). A do-able lever. Higher immunity lowers Rt." },
    { id: "mobility", label: "Travel inflow", role: "treatment", observed: true, layer: 1,
      note: "Inbound connectivity. A do-able lever (travel measures). Raises importation pressure and Rt." },
    { id: "npi", label: "NPI intensity", role: "treatment", observed: true, layer: 1,
      note: "Non-pharmaceutical interventions (masking, distancing). A policy lever, 0 = none. Lowers Rt." },
    { id: "variant_advantage", label: "Variant advantage", role: "mediator", observed: true, layer: 2,
      note: "Growth advantage of the dominant lineage. A mediator of travel inflow and a cause of Rt." },
    { id: "Rt", label: "Rt (growth)", role: "outcome", observed: true, layer: 3,
      note: "Effective reproduction number. The causal target; P(Rt>1) is a monotone function of it." },
    { id: "transmission", label: "Latent incidence", role: "latent", observed: false, layer: 4,
      note: "Unobserved incidence pressure driven by Rt. Every measurement below is a noisy readout of it." },
    { id: "wastewater", label: "Wastewater signal", role: "descendant", observed: true, layer: 5,
      note: "A readout of incidence, not a cause of it. Conditioning on it blocks the very effect we want (bad control)." },
    { id: "clinical", label: "Clinical syndromic", role: "descendant", observed: true, layer: 5,
      note: "Downstream of incidence. Adjusting for it induces over-control bias." },
    { id: "positivity", label: "Test positivity", role: "descendant", observed: true, layer: 5,
      note: "Downstream of incidence. Bad control." },
    { id: "icu", label: "ICU headroom", role: "descendant", observed: true, layer: 5,
      note: "Downstream consequence of incidence (inverse). Bad control." },
    { id: "genomic_jsd", label: "Genomic anomaly", role: "descendant", observed: true, layer: 5,
      note: "Reflects variant turnover and incidence. Bad control for the growth effect." },
  ],
  edges: [
    { from: "region", to: "immunity", sign: "+", note: "developed regions carry higher baseline immunity" },
    { from: "region", to: "climate", sign: "+", note: "geography sets endemic climate suitability" },
    { from: "climate", to: "Rt", sign: "+", note: "seasonal forcing raises transmission" },
    { from: "immunity", to: "Rt", sign: "-", note: "immunity shrinks the susceptible pool" },
    { from: "mobility", to: "Rt", sign: "+", note: "importation adds transmission pressure" },
    { from: "mobility", to: "variant_advantage", sign: "+", note: "connectivity imports novel variants" },
    { from: "npi", to: "Rt", sign: "-", note: "contact reduction lowers Rt" },
    { from: "variant_advantage", to: "Rt", sign: "+", note: "a fitter lineage raises Rt" },
    { from: "variant_advantage", to: "genomic_jsd", sign: "+", note: "turnover shows up as lineage divergence" },
    { from: "Rt", to: "transmission", sign: "+", note: "growth drives incidence" },
    { from: "transmission", to: "wastewater", sign: "+" },
    { from: "transmission", to: "clinical", sign: "+" },
    { from: "transmission", to: "positivity", sign: "+" },
    { from: "transmission", to: "icu", sign: "-", note: "more incidence, less capacity" },
    { from: "transmission", to: "genomic_jsd", sign: "+" },
  ],
};

/** The do-able intervention levers, in the order the UI presents them. */
export const TREATMENT_NODES = ["immunity", "mobility", "npi"] as const;
export type TreatmentNode = (typeof TREATMENT_NODES)[number];

export const OUTCOME_NODE = "Rt";

export const ROLE_COLOR: Record<NodeRole, string> = {
  treatment: "#38bdf8",
  confounder: "#fbbf24",
  context: "#94a3b8",
  mediator: "#a78bfa",
  outcome: "#f472b6",
  latent: "#64748b",
  descendant: "#f87171",
};

/* --------------------------- graph helpers ---------------------------- */

function parentsOf(g: CausalGraph, id: string): string[] {
  return g.edges.filter((e) => e.to === id).map((e) => e.from);
}

function childrenOf(g: CausalGraph, id: string): string[] {
  return g.edges.filter((e) => e.from === id).map((e) => e.to);
}

function hasEdge(g: CausalGraph, from: string, to: string): boolean {
  return g.edges.some((e) => e.from === from && e.to === to);
}

/** All ancestors of `id` (not including `id`). */
export function ancestors(g: CausalGraph, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...parentsOf(g, id)];
  while (stack.length) {
    const n = stack.pop() as string;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...parentsOf(g, n));
  }
  return out;
}

/** All descendants of `id` (not including `id`). */
export function descendants(g: CausalGraph, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...childrenOf(g, id)];
  while (stack.length) {
    const n = stack.pop() as string;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...childrenOf(g, n));
  }
  return out;
}

/** Undirected neighbours (parents plus children). */
function neighbours(g: CausalGraph, id: string): string[] {
  return Array.from(new Set([...parentsOf(g, id), ...childrenOf(g, id)]));
}

/** Enumerate every simple undirected path between `x` and `y`. */
function simplePaths(g: CausalGraph, x: string, y: string): string[][] {
  const paths: string[][] = [];
  const walk = (node: string, visited: string[]) => {
    if (node === y) { paths.push([...visited, node]); return; }
    for (const nb of neighbours(g, node)) {
      if (visited.includes(nb)) continue;
      walk(nb, [...visited, node]);
    }
  };
  walk(x, []);
  return paths;
}

/**
 * Is a single path blocked (d-separated) by the conditioning set Z?
 * A path is blocked if any interior node blocks it:
 *  - a chain a->b->c or fork a<-b->c is blocked when b is in Z,
 *  - a collider a->b<-c is blocked unless b or a descendant of b is in Z.
 */
function pathBlocked(g: CausalGraph, path: string[], Z: Set<string>): boolean {
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1], mid = path[i], next = path[i + 1];
    const isCollider = hasEdge(g, prev, mid) && hasEdge(g, next, mid);
    if (isCollider) {
      const opensCollider =
        Z.has(mid) || Array.from(descendants(g, mid)).some((d) => Z.has(d));
      if (!opensCollider) return true; // collider without conditioning blocks the path
    } else {
      if (Z.has(mid)) return true; // conditioning on a chain / fork centre blocks it
    }
  }
  return false;
}

/** d-separation: are `x` and `y` separated given the set `Z`? */
export function dSeparated(g: CausalGraph, x: string, y: string, Z: string[] = []): boolean {
  const zset = new Set(Z);
  return simplePaths(g, x, y).every((p) => pathBlocked(g, p, zset));
}

/** The backdoor paths from `treatment` to `outcome` (those entering treatment). */
export function backdoorPaths(g: CausalGraph, treatment: string, outcome: string): string[][] {
  return simplePaths(g, treatment, outcome).filter(
    (p) => p.length >= 2 && hasEdge(g, p[1], treatment), // first edge points INTO the treatment
  );
}

/**
 * A minimal-ish valid backdoor adjustment set for effect(treatment -> outcome).
 *
 * We restrict candidates to observed non-descendants of the treatment (the
 * backdoor criterion forbids adjusting for descendants of the treatment), then
 * take the parents of the treatment that are ancestors of the outcome. On this
 * DAG that yields a set satisfying Pearl's backdoor criterion; we assert it by
 * checking every backdoor path is blocked.
 */
export function backdoorAdjustmentSet(g: CausalGraph, treatment: string, outcome: string): string[] {
  const treatmentDesc = descendants(g, treatment);
  const outcomeAnc = ancestors(g, outcome);
  const candidate = g.nodes
    .filter((n) => n.observed)
    .filter((n) => n.id !== treatment && n.id !== outcome)
    .filter((n) => !treatmentDesc.has(n.id)) // never adjust for a descendant of the treatment
    .filter((n) => parentsOf(g, treatment).includes(n.id) || (outcomeAnc.has(n.id) && ancestors(g, treatment).has(n.id)))
    .map((n) => n.id);

  // Verify: with the candidate set every backdoor path must be blocked.
  const paths = backdoorPaths(g, treatment, outcome);
  const zset = new Set(candidate);
  const valid = paths.every((p) => pathBlocked(g, p, zset));
  if (valid) return candidate;

  // Fallback: add all observed non-descendant confounders until blocked.
  const extra = g.nodes
    .filter((n) => n.observed && n.id !== treatment && n.id !== outcome && !treatmentDesc.has(n.id))
    .map((n) => n.id);
  return Array.from(new Set([...candidate, ...extra]));
}

/**
 * Is `node` a bad control when estimating effect(treatment -> outcome)?
 * A control is "bad" if it is a descendant of the treatment (a mediator or
 * downstream measurement) or a descendant of the outcome. Conditioning on either
 * removes part of the causal effect or opens a non-causal path.
 */
export function isBadControl(g: CausalGraph, node: string, treatment: string, outcome: string): boolean {
  if (node === treatment || node === outcome) return false;
  return descendants(g, treatment).has(node) || descendants(g, outcome).has(node) || node === outcome;
}

/** All observed descendants of the outcome mechanism: the always-bad controls. */
export function badControlsFor(g: CausalGraph, treatment: string, outcome: string): string[] {
  return g.nodes
    .filter((n) => n.observed && isBadControl(g, n.id, treatment, outcome))
    .map((n) => n.id);
}

/** A compact, serialisable description of the graph for the API / assistant. */
export function describeGraph(g: CausalGraph = MOSAIC_DAG) {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, label: n.label, role: n.role, observed: n.observed })),
    edges: g.edges.map((e) => ({ from: e.from, to: e.to, sign: e.sign })),
    treatments: TREATMENT_NODES,
    outcome: OUTCOME_NODE,
  };
}
