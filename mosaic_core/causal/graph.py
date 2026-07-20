"""
MOSAIC causal graph (full tier).

A directed acyclic graph over the surveillance streams, the driver covariates,
latent transmission, and the growth outcome. This encodes the causal ASSUMPTIONS
the interventional and counterfactual queries depend on: stated explicitly, not
learned from outcomes.

The structure mirrors the lite tier (`apps/web/lib/causal/dag.ts`): climate,
immunity, and mobility are upstream causes of transmission, while clinical,
positivity, ICU, wastewater, and the genomic anomaly are DESCENDANTS of latent
incidence. Conditioning on a descendant of the treatment or the outcome is a
"bad control" that biases an effect estimate.

Graph algorithms (ancestors, descendants, d-separation, backdoor adjustment) are
implemented here with the standard library only; the graph is small (~13 nodes)
so path-enumeration d-separation is exact.

References: Pearl, Causality (2009); Cinelli, Forney, Pearl, "A Crash Course in
Good and Bad Controls" (2022).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Node:
    id: str
    label: str
    role: str  # treatment | confounder | context | mediator | outcome | latent | descendant
    observed: bool


@dataclass
class CausalGraph:
    nodes: list[Node]
    edges: list[tuple[str, str]]  # directed (from, to)
    _parents: dict[str, set[str]] = field(default_factory=dict)
    _children: dict[str, set[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._parents = {n.id: set() for n in self.nodes}
        self._children = {n.id: set() for n in self.nodes}
        for a, b in self.edges:
            self._children[a].add(b)
            self._parents[b].add(a)

    # ------------------------------ helpers ------------------------------

    def node(self, nid: str) -> Node:
        return next(n for n in self.nodes if n.id == nid)

    def parents(self, nid: str) -> set[str]:
        return set(self._parents[nid])

    def children(self, nid: str) -> set[str]:
        return set(self._children[nid])

    def has_edge(self, a: str, b: str) -> bool:
        return b in self._children.get(a, set())

    def ancestors(self, nid: str) -> set[str]:
        out: set[str] = set()
        stack = list(self._parents[nid])
        while stack:
            n = stack.pop()
            if n in out:
                continue
            out.add(n)
            stack.extend(self._parents[n])
        return out

    def descendants(self, nid: str) -> set[str]:
        out: set[str] = set()
        stack = list(self._children[nid])
        while stack:
            n = stack.pop()
            if n in out:
                continue
            out.add(n)
            stack.extend(self._children[n])
        return out

    def _neighbours(self, nid: str) -> set[str]:
        return self._parents[nid] | self._children[nid]

    def _simple_paths(self, x: str, y: str) -> list[list[str]]:
        paths: list[list[str]] = []

        def walk(node: str, visited: list[str]) -> None:
            if node == y:
                paths.append(visited + [node])
                return
            for nb in self._neighbours(node):
                if nb in visited:
                    continue
                walk(nb, visited + [node])

        walk(x, [])
        return paths

    def _path_blocked(self, path: list[str], z: set[str]) -> bool:
        for i in range(1, len(path) - 1):
            prev, mid, nxt = path[i - 1], path[i], path[i + 1]
            is_collider = self.has_edge(prev, mid) and self.has_edge(nxt, mid)
            if is_collider:
                opens = mid in z or bool(self.descendants(mid) & z)
                if not opens:
                    return True
            else:
                if mid in z:
                    return True
        return False

    # --------------------------- public queries --------------------------

    def d_separated(self, x: str, y: str, z: set[str] | None = None) -> bool:
        """Are x and y d-separated given the conditioning set z?"""
        zset = set(z or set())
        return all(self._path_blocked(p, zset) for p in self._simple_paths(x, y))

    def backdoor_paths(self, treatment: str, outcome: str) -> list[list[str]]:
        """Paths from treatment to outcome that enter the treatment (backdoor)."""
        return [
            p for p in self._simple_paths(treatment, outcome)
            if len(p) >= 2 and self.has_edge(p[1], treatment)
        ]

    def backdoor_adjustment_set(self, treatment: str, outcome: str) -> list[str]:
        """A valid backdoor adjustment set (Pearl's backdoor criterion)."""
        treatment_desc = self.descendants(treatment)
        outcome_anc = self.ancestors(outcome)
        treatment_anc = self.ancestors(treatment)
        candidate = [
            n.id for n in self.nodes
            if n.observed and n.id not in (treatment, outcome)
            and n.id not in treatment_desc
            and (n.id in self.parents(treatment) or (n.id in outcome_anc and n.id in treatment_anc))
        ]
        if all(self._path_blocked(p, set(candidate)) for p in self.backdoor_paths(treatment, outcome)):
            return sorted(candidate)
        # fallback: all observed non-descendant nodes
        return sorted(
            n.id for n in self.nodes
            if n.observed and n.id not in (treatment, outcome) and n.id not in treatment_desc
        )

    def is_bad_control(self, node: str, treatment: str, outcome: str) -> bool:
        """A control is bad if it descends from the treatment or the outcome."""
        if node in (treatment, outcome):
            return False
        return node in self.descendants(treatment) or node in self.descendants(outcome)

    def bad_controls(self, treatment: str, outcome: str) -> list[str]:
        return sorted(
            n.id for n in self.nodes
            if n.observed and self.is_bad_control(n.id, treatment, outcome)
        )

    def verify_acyclic(self) -> bool:
        """A DAG must have no node among its own ancestors."""
        return all(n.id not in self.ancestors(n.id) for n in self.nodes)


def mosaic_dag() -> CausalGraph:
    """The canonical MOSAIC causal graph, identical in structure to the lite tier."""
    nodes = [
        Node("region", "Region / development", "context", True),
        Node("climate", "Climate suitability", "confounder", True),
        Node("immunity", "Immunity coverage", "treatment", True),
        Node("mobility", "Travel inflow", "treatment", True),
        Node("npi", "NPI intensity", "treatment", True),
        Node("variant_advantage", "Variant advantage", "mediator", True),
        Node("Rt", "Rt (growth)", "outcome", True),
        Node("transmission", "Latent incidence", "latent", False),
        Node("wastewater", "Wastewater signal", "descendant", True),
        Node("clinical", "Clinical syndromic", "descendant", True),
        Node("positivity", "Test positivity", "descendant", True),
        Node("icu", "ICU headroom", "descendant", True),
        Node("genomic_jsd", "Genomic anomaly", "descendant", True),
    ]
    edges = [
        ("region", "immunity"),
        ("region", "climate"),
        ("climate", "Rt"),
        ("immunity", "Rt"),
        ("mobility", "Rt"),
        ("mobility", "variant_advantage"),
        ("npi", "Rt"),
        ("variant_advantage", "Rt"),
        ("variant_advantage", "genomic_jsd"),
        ("Rt", "transmission"),
        ("transmission", "wastewater"),
        ("transmission", "clinical"),
        ("transmission", "positivity"),
        ("transmission", "icu"),
        ("transmission", "genomic_jsd"),
    ]
    return CausalGraph(nodes, edges)


TREATMENTS = ("immunity", "mobility", "npi")
OUTCOME = "Rt"


def describe(g: CausalGraph | None = None) -> dict:
    """A serialisable summary of the graph for the API."""
    g = g or mosaic_dag()
    return {
        "nodes": [{"id": n.id, "label": n.label, "role": n.role, "observed": n.observed} for n in g.nodes],
        "edges": [{"from": a, "to": b} for a, b in g.edges],
        "treatments": list(TREATMENTS),
        "outcome": OUTCOME,
    }
