#!/usr/bin/env python3
"""
================================================================================
AIUI AGENT STRATEGY EVOLUTIONARY OPTIMIZER & AUTO-TUNING ENGINE (v2.0)
================================================================================
An advanced, continuous multi-objective meta-learning suite for autonomous AI agents.
Features:
- Multi-Task Contextual Genome (Code Gen, Self-Healing, Fast Q&A, Systems DevOps)
- Empirical Telemetry Ingestion & Replay (evaluates real traces from logs/agent-responses.jsonl)
- NSGA-II Multi-Objective Pareto Frontier with Crowding Distance Sorting
- Blend Crossover (BLX-alpha) & 1/5th-Rule Adaptive Gaussian Mutation
- 2D ASCII Pareto Phase-Space Scatter Plot Visualizer
- MemPalace Bridge (:17333) and Autonomous Standing Daemon Mode (--daemon)
================================================================================
"""

import os
import sys
import math
import json
import time
import signal
import random
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any, Set


# ------------------------------------------------------------------------------
# 1. Multi-Task Contextual Genome Specifications
# ------------------------------------------------------------------------------

GENE_SCHEMA = {
    'code_gen': {
        'verification_depth': {'desc': 'Post-execution test assertions and compile verification', 'default': 0.85},
        'precision': {'desc': 'Exact symbol/signature targeting over general rewriting', 'default': 0.80},
        'diff_conservatism': {'desc': 'Surgical diff edits over full-file overwrites', 'default': 0.75},
        'caution': {'desc': 'Syntax inspection and import checks prior to write', 'default': 0.70},
    },
    'self_healing': {
        'anti_loop_sensitivity': {'desc': 'Detection threshold for stagnant repeated errors', 'default': 0.85},
        'tool_diversity': {'desc': 'Spanning multiple tool strategies (grep/cat/bash/python)', 'default': 0.80},
        'exploration_rate': {'desc': 'Alternative hypothesis testing & temperature elevation', 'default': 0.60},
        'retry_budget': {'desc': 'Autonomous attempts permitted before yielding to user', 'default': 0.70},
        'tool_synthesis_propensity': {'desc': 'Propensity to synthesize dynamic tools over raw ad-hoc scripts', 'default': 0.75},
        'dynamic_tool_affinity': {'desc': 'Prioritizing existing verified tools over reinventing pipelines', 'default': 0.80},
    },
    'fast_query': {
        'brevity': {'desc': 'Direct, concise output without narrative preamble', 'default': 0.85},
        'latency_priority': {'desc': 'Convergence speed and immediate response dispatch', 'default': 0.90},
        'direct_response_ratio': {'desc': 'Answering directly without unnecessary tool calls', 'default': 0.85},
        'caution': {'desc': 'Minimal verification overhead on read-only queries', 'default': 0.30},
    },
    'systems_devops': {
        'caution': {'desc': 'Strict path escaping checks and rm -rf safeguards', 'default': 0.90},
        'pre_flight_dryrun': {'desc': 'Checking directory existence and command availability', 'default': 0.85},
        'container_isolation': {'desc': 'Routing risky commands into ephemeral containers', 'default': 0.75},
        'verification_depth': {'desc': 'Validating service health endpoints and ports', 'default': 0.80},
    },
    'global_meta': {
        'temperature_bias': {'desc': 'Sampling temperature adjustment [-0.30 to +0.30]', 'default': 0.0},
        'max_duration_ms': {'desc': 'Execution timeout budget [12000 to 45000 ms]', 'default': 28000},
        'min_useful_chars': {'desc': 'Minimum characters required to avoid empty-turn penalty', 'default': 45},
        'anti_loop_strict': {'desc': 'Strict anti-loop course correction enforcement', 'default': 1.0},
    }
}


class MultiTaskGenome:
    def __init__(self, data: Optional[Dict[str, Dict[str, float]]] = None):
        self.traits: Dict[str, Dict[str, float]] = {}
        if data:
            for task, genes in GENE_SCHEMA.items():
                self.traits[task] = {}
                task_data = data.get(task, {})
                for gene in genes:
                    val = float(task_data.get(gene, genes[gene]['default']))
                    if task == 'global_meta' and gene == 'temperature_bias':
                        self.traits[task][gene] = round(max(-0.35, min(0.35, val)), 3)
                    elif task == 'global_meta' and gene == 'max_duration_ms':
                        self.traits[task][gene] = int(max(10000, min(45000, val)))
                    elif task == 'global_meta' and gene == 'min_useful_chars':
                        self.traits[task][gene] = int(max(15, min(90, val)))
                    else:
                        self.traits[task][gene] = round(max(0.0, min(1.0, val)), 3)
        else:
            for task, genes in GENE_SCHEMA.items():
                self.traits[task] = {}
                for gene, spec in genes.items():
                    if task == 'global_meta' and gene == 'temperature_bias':
                        self.traits[task][gene] = round(random.uniform(-0.25, 0.25), 3)
                    elif task == 'global_meta' and gene == 'max_duration_ms':
                        self.traits[task][gene] = int(random.uniform(15000, 38000))
                    elif task == 'global_meta' and gene == 'min_useful_chars':
                        self.traits[task][gene] = int(random.uniform(25, 70))
                    elif task == 'global_meta' and gene == 'anti_loop_strict':
                        self.traits[task][gene] = 1.0 if random.random() > 0.2 else 0.0
                    else:
                        self.traits[task][gene] = round(random.uniform(0.15, 0.85), 3)

    def copy(self) -> 'MultiTaskGenome':
        new_data = {t: genes.copy() for t, genes in self.traits.items()}
        return MultiTaskGenome(new_data)


# ------------------------------------------------------------------------------
# 2. Multi-Objective Scores & Pareto Individual
# ------------------------------------------------------------------------------

class MultiObjectiveScores:
    def __init__(
        self,
        success_rate: float,
        turn_efficiency: float,
        cost_efficiency: float,
        safety_score: float,
        empirical_alignment: float = 0.8
    ):
        self.success_rate = round(max(0.0, min(1.0, success_rate)), 4)
        self.turn_efficiency = round(max(0.0, min(1.0, turn_efficiency)), 4)
        self.cost_efficiency = round(max(0.0, min(1.0, cost_efficiency)), 4)
        self.safety_score = round(max(0.0, min(1.0, safety_score)), 4)
        self.empirical_alignment = round(max(0.0, min(1.0, empirical_alignment)), 4)

        # Composite scalar for single-objective sorting benchmarks
        self.composite_fitness = round(
            self.success_rate * 0.35 +
            self.turn_efficiency * 0.20 +
            self.cost_efficiency * 0.15 +
            self.safety_score * 0.20 +
            self.empirical_alignment * 0.10,
            4
        )

    def dominates(self, other: 'MultiObjectiveScores') -> bool:
        """Pareto dominance: strictly better in at least one objective and not worse in any."""
        self_tuple = (self.success_rate, self.turn_efficiency, self.cost_efficiency, self.safety_score)
        other_tuple = (other.success_rate, other.turn_efficiency, other.cost_efficiency, other.safety_score)
        better_in_one = False
        for s, o in zip(self_tuple, other_tuple):
            if s < o:
                return False
            if s > o:
                better_in_one = True
        return better_in_one


class AgentIndividual:
    def __init__(self, genome: Optional[MultiTaskGenome] = None):
        self.genome = genome if genome else MultiTaskGenome()
        self.scores: Optional[MultiObjectiveScores] = None
        self.rank: int = 0
        self.crowding_distance: float = 0.0
        self.domination_count: int = 0
        self.dominated_solutions: List['AgentIndividual'] = []

    def classify_archetype(self) -> str:
        t = self.genome.traits
        code = t['code_gen']
        heal = t['self_healing']
        query = t['fast_query']
        devops = t['systems_devops']

        if query['latency_priority'] > 0.75 and query['brevity'] > 0.75:
            return "⚡ Fast & Lean"
        if code['verification_depth'] > 0.78 and devops['caution'] > 0.75:
            return "🛡️ Deep-Build High-Assurance"
        if heal['exploration_rate'] > 0.70 and heal['tool_diversity'] > 0.70:
            return "🔬 Novelty Explorer"
        if heal['anti_loop_sensitivity'] > 0.80 and devops['caution'] > 0.80:
            return "🎯 Defensive Sentinel"
        return "⚖️ Balanced Generalist"

    def __repr__(self) -> str:
        score_str = f"Fit:{self.scores.composite_fitness:.3f}" if self.scores else "Unscored"
        return f"Agent[{score_str} | Rank:{self.rank} | {self.classify_archetype()}]"


# ------------------------------------------------------------------------------
# 3. Telemetry Replay & Empirical Evaluation Harness
# ------------------------------------------------------------------------------

class TelemetryReplayHarness:
    """
    Ingests live logs from logs/agent-responses.jsonl to backtest and validate
    candidate strategy genomes against actual historical failure clusters and loops.
    """
    def __init__(self, log_path: Optional[str] = None):
        self.events: List[Dict[str, Any]] = []
        target_path = Path(log_path) if log_path else Path(__file__).resolve().parent / 'logs' / 'agent-responses.jsonl'
        if target_path.exists():
            self._load_events(target_path)

    def _load_events(self, path: Path, max_lines: int = 400):
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()[-max_lines:]
                for line in lines:
                    line = line.strip()
                    if line:
                        try:
                            self.events.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            print(f"[telemetry-harness] Note: could not load live logs: {e}")

    def evaluate_against_telemetry(self, individual: AgentIndividual) -> float:
        """
        Calculates empirical alignment score (0.0 to 1.0).
        Rewards genomes that would prevent historical stalls, loops, and slow responses.
        """
        if not self.events:
            return 0.85  # Baseline default when logs unavailable

        total_checks = 0
        penalty = 0.0
        t = individual.genome.traits

        for e in self.events:
            event_type = e.get('type')
            dur = e.get('durationMs', 0)
            text = str(e.get('responseText', ''))

            if event_type == 'anti_loop':
                analysis = e.get('analysis', {})
                if analysis.get('isLooping'):
                    total_checks += 1
                    # A genome with high anti-loop sensitivity recovers from loops
                    mitigation = t['self_healing']['anti_loop_sensitivity']
                    penalty += max(0.0, 1.0 - mitigation)

            elif event_type == 'response':
                total_checks += 1
                if dur > 25000:
                    # Slow response: requires higher fast_query latency priority or code_gen precision
                    mitigation = (t['fast_query']['latency_priority'] + t['code_gen']['precision']) / 2.0
                    penalty += max(0.0, 0.8 - mitigation)
                if len(text.strip()) < 10:
                    # Empty response: requires higher min_useful_chars and verification
                    mitigation = t['code_gen']['verification_depth']
                    penalty += max(0.0, 0.9 - mitigation)

            elif event_type == 'error':
                total_checks += 1
                mitigation = t['systems_devops']['caution']
                penalty += max(0.0, 0.85 - mitigation)

        if total_checks == 0:
            return 0.85

        alignment = max(0.0, min(1.0, 1.0 - (penalty / total_checks)))
        return round(alignment, 4)


# ------------------------------------------------------------------------------
# 4. Multi-Scenario Simulation & Fitness Evaluation
# ------------------------------------------------------------------------------

class SimulationBattery:
    """
    Evaluates individual genomes across multi-task challenge environments.
    """
    @staticmethod
    def evaluate(individual: AgentIndividual, telemetry_harness: TelemetryReplayHarness) -> MultiObjectiveScores:
        t = individual.genome.traits
        code = t['code_gen']
        heal = t['self_healing']
        query = t['fast_query']
        devops = t['systems_devops']

        # 1. Code Generation Scenario: Needs verification depth, precision, diff conservatism
        code_risk = max(0.0, 0.70 - code['verification_depth']) * 1.6
        code_succ = max(0.0, min(1.0, code['verification_depth'] * 0.4 + code['precision'] * 0.35 + code['diff_conservatism'] * 0.25 - code_risk))
        code_turns = max(0.0, min(1.0, 0.90 - code['verification_depth'] * 0.3))
        code_cost = max(0.0, min(1.0, 0.90 - code['precision'] * 0.25))
        code_safe = max(0.0, min(1.0, code['caution'] * 0.6 + code['diff_conservatism'] * 0.4))

        # 2. Self Healing Scenario: Needs anti-loop sensitivity, tool diversity, exploration
        loop_risk = max(0.0, 0.75 - heal['anti_loop_sensitivity']) * 1.8
        heal_succ = max(0.0, min(1.0, heal['anti_loop_sensitivity'] * 0.4 + heal['tool_diversity'] * 0.35 + heal['exploration_rate'] * 0.25 - loop_risk))
        heal_turns = max(0.0, min(1.0, heal['anti_loop_sensitivity'] * 0.6 + heal['retry_budget'] * 0.4))
        heal_cost = max(0.0, min(1.0, 0.85 - heal['exploration_rate'] * 0.35))
        heal_safe = max(0.0, min(1.0, heal['anti_loop_sensitivity'] * 0.5 + devops['caution'] * 0.5))

        # 3. Fast Query Scenario: Needs brevity, latency priority, direct response
        query_succ = 1.0 if query['caution'] > 0.15 else 0.88
        query_turns = max(0.0, min(1.0, query['latency_priority'] * 0.5 + query['direct_response_ratio'] * 0.5))
        query_cost = max(0.0, min(1.0, query['brevity'] * 0.6 + query['direct_response_ratio'] * 0.4))
        query_safe = max(0.0, min(1.0, 0.95 - query['latency_priority'] * 0.15 + query['caution'] * 0.2))

        # 4. Systems DevOps Scenario: Needs high caution, dry-run, container isolation
        reckless = max(0.0, 0.70 - devops['caution']) * 2.5
        devops_succ = max(0.0, min(1.0, devops['pre_flight_dryrun'] * 0.4 + devops['container_isolation'] * 0.3 + devops['verification_depth'] * 0.3 - reckless))
        devops_turns = max(0.0, min(1.0, 0.85 - devops['pre_flight_dryrun'] * 0.2))
        devops_cost = max(0.0, min(1.0, 0.80 - devops['container_isolation'] * 0.25))
        devops_safe = max(0.0, min(1.0, devops['caution'] * 0.6 + devops['container_isolation'] * 0.4))

        # Empirical replay alignment
        emp_score = telemetry_harness.evaluate_against_telemetry(individual)

        # Aggregate objectives across scenarios
        agg_succ = (code_succ + heal_succ + query_succ + devops_succ) / 4.0
        agg_turn = (code_turns + heal_turns + query_turns + devops_turns) / 4.0
        agg_cost = (code_cost + heal_cost + query_cost + devops_cost) / 4.0
        agg_safe = (code_safe + heal_safe + query_safe + devops_safe) / 4.0

        scores = MultiObjectiveScores(
            success_rate=agg_succ,
            turn_efficiency=agg_turn,
            cost_efficiency=agg_cost,
            safety_score=agg_safe,
            empirical_alignment=emp_score
        )
        individual.scores = scores
        return scores


# ------------------------------------------------------------------------------
# 5. NSGA-II Multi-Objective Sorting & Crowding Distance
# ------------------------------------------------------------------------------

def fast_non_dominated_sort(population: List[AgentIndividual]) -> List[List[AgentIndividual]]:
    """
    Deb's Fast Non-Dominated Sorting algorithm (NSGA-II).
    Returns a list of Pareto fronts [F1, F2, ..., Fk], where F1 is the non-dominated front.
    """
    fronts: List[List[AgentIndividual]] = [[]]
    for p in population:
        p.domination_count = 0
        p.dominated_solutions = []
        for q in population:
            if p is q or not p.scores or not q.scores:
                continue
            if p.scores.dominates(q.scores):
                p.dominated_solutions.append(q)
            elif q.scores.dominates(p.scores):
                p.domination_count += 1
        if p.domination_count == 0:
            p.rank = 1
            fronts[0].append(p)

    i = 0
    while len(fronts[i]) > 0:
        next_front: List[AgentIndividual] = []
        for p in fronts[i]:
            for q in p.dominated_solutions:
                q.domination_count -= 1
                if q.domination_count == 0:
                    q.rank = i + 2
                    next_front.append(q)
        i += 1
        fronts.append(next_front)

    if not fronts[-1]:
        fronts.pop()
    return fronts


def assign_crowding_distance(front: List[AgentIndividual]):
    """
    Assigns crowding distance to maintain diversity along the Pareto frontier.
    Boundary solutions receive infinite distance.
    """
    l = len(front)
    if l == 0:
        return
    for ind in front:
        ind.crowding_distance = 0.0

    if l <= 2:
        for ind in front:
            ind.crowding_distance = float('inf')
        return

    objectives = [
        lambda ind: ind.scores.success_rate if ind.scores else 0.0,
        lambda ind: ind.scores.turn_efficiency if ind.scores else 0.0,
        lambda ind: ind.scores.cost_efficiency if ind.scores else 0.0,
        lambda ind: ind.scores.safety_score if ind.scores else 0.0,
    ]

    for obj in objectives:
        front.sort(key=obj)
        front[0].crowding_distance = float('inf')
        front[-1].crowding_distance = float('inf')
        obj_min = obj(front[0])
        obj_max = obj(front[-1])
        span = obj_max - obj_min
        if span == 0:
            continue
        for i in range(1, l - 1):
            if front[i].crowding_distance != float('inf'):
                dist = (obj(front[i + 1]) - obj(front[i - 1])) / span
                front[i].crowding_distance += dist


def nsga2_tournament_select(pool: List[AgentIndividual], k: int = 2) -> AgentIndividual:
    """Selects individual with lowest Pareto rank, breaking ties using crowding distance."""
    sample = random.sample(pool, min(k, len(pool)))
    best = sample[0]
    for other in sample[1:]:
        if other.rank < best.rank:
            best = other
        elif other.rank == best.rank and other.crowding_distance > best.crowding_distance:
            best = other
    return best


# ------------------------------------------------------------------------------
# 6. Continuous Genetic Operators (BLX-alpha & 1/5th Rule Mutation)
# ------------------------------------------------------------------------------

def crossover_blx_alpha(p1: AgentIndividual, p2: AgentIndividual, alpha: float = 0.3) -> AgentIndividual:
    """Blend Crossover across all multi-task gene dictionaries."""
    child_traits: Dict[str, Dict[str, float]] = {}
    for task in GENE_SCHEMA:
        child_traits[task] = {}
        for gene in GENE_SCHEMA[task]:
            v1 = p1.genome.traits[task][gene]
            v2 = p2.genome.traits[task][gene]
            lo = min(v1, v2)
            hi = max(v1, v2)
            span = hi - lo
            c_low = lo - alpha * span
            c_high = hi + alpha * span
            val = random.uniform(c_low, c_high)
            child_traits[task][gene] = val
    return AgentIndividual(MultiTaskGenome(child_traits))


def mutate_adaptive(individual: AgentIndividual, mutation_rate: float, sigma: float) -> AgentIndividual:
    """Adaptive Gaussian mutation with bounded reflection."""
    mutated_traits: Dict[str, Dict[str, float]] = {}
    for task in GENE_SCHEMA:
        mutated_traits[task] = {}
        for gene in GENE_SCHEMA[task]:
            val = individual.genome.traits[task][gene]
            if random.random() < mutation_rate:
                jitter = random.gauss(0, sigma)
                val += jitter
            mutated_traits[task][gene] = val
    return AgentIndividual(MultiTaskGenome(mutated_traits))


# ------------------------------------------------------------------------------
# 7. ASCII Visualization & 2D Pareto Phase-Space Scatter Plot
# ------------------------------------------------------------------------------

def sparkline(data: List[float]) -> str:
    if not data:
        return ""
    ticks = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    lo = min(data)
    hi = max(data)
    span = hi - lo
    if span < 1e-6:
        return ticks[3] * len(data)
    return ''.join(ticks[max(0, min(7, int(((d - lo) / span) * 7)))] for d in data)


def render_pareto_scatter_plot(pareto_front: List[AgentIndividual], width: int = 50, height: int = 15) -> str:
    """
    Renders an ASCII 2D phase-space coordinate grid:
    Y-axis: Quality (Success Rate + Safety Score)
    X-axis: Efficiency (Turn Efficiency + Cost Efficiency)
    """
    grid = [[' ' for _ in range(width)] for _ in range(height)]
    archetype_chars = {
        "⚡ Fast & Lean": 'F',
        "🛡️ Deep-Build High-Assurance": 'D',
        "🔬 Novelty Explorer": 'E',
        "🎯 Defensive Sentinel": 'S',
        "⚖️ Balanced Generalist": 'B',
    }

    for ind in pareto_front:
        if not ind.scores:
            continue
        # Quality: Success + Safety [0.0 to 2.0] -> normalized [0.0 to 1.0]
        quality = (ind.scores.success_rate + ind.scores.safety_score) / 2.0
        # Efficiency: Turns + Cost [0.0 to 2.0] -> normalized [0.0 to 1.0]
        efficiency = (ind.scores.turn_efficiency + ind.scores.cost_efficiency) / 2.0

        x = int(efficiency * (width - 1))
        y = int((1.0 - quality) * (height - 1))
        x = max(0, min(width - 1, x))
        y = max(0, min(height - 1, y))

        char = archetype_chars.get(ind.classify_archetype(), '*')
        grid[y][x] = char

    lines = []
    lines.append("  ┌" + "─" * width + "┐ Quality (Success + Safety)")
    for r in range(height):
        y_val = 1.0 - (r / (height - 1))
        lines.append(f"{y_val:3.1f}│" + "".join(grid[r]) + "│")
    lines.append("  └" + "─" * width + "┘")
    lines.append("    0.0" + " " * (width - 6) + "1.0  Efficiency (Turn + Cost)")
    lines.append("    Legend: [D] Deep-Build  [F] Fast&Lean  [E] Explorer  [S] Sentinel  [B] Balanced")
    return "\n".join(lines)


# ------------------------------------------------------------------------------
# 8. Policy Exporter & MemPalace Bridge
# ------------------------------------------------------------------------------

def individual_to_aiui_policy(ind: AgentIndividual) -> Dict[str, Any]:
    t = ind.genome.traits
    scores = ind.scores

    # Direct extraction of meta knobs
    temp_bias = t['global_meta']['temperature_bias']
    max_duration_ms = t['global_meta']['max_duration_ms']
    min_useful_chars = t['global_meta']['min_useful_chars']
    anti_loop_strict = t['global_meta']['anti_loop_strict'] > 0.5

    # Build contextual directive
    nudges = []
    if t['code_gen']['verification_depth'] > 0.75:
        nudges.append("Enforce explicit test assertion evidence and real exit codes.")
    if t['self_healing']['anti_loop_sensitivity'] > 0.75:
        nudges.append("If blocked >1 attempt, stop retrying the same tool; pivot immediately.")
    if t['self_healing'].get('tool_synthesis_propensity', 0.75) > 0.70:
        nudges.append("When encountering specialized data tasks (SQL, CSV stats, Git blame, web search), call research_and_acquire_tool to formalize a reusable tool.")
    if t['code_gen']['diff_conservatism'] > 0.70:
        nudges.append("Prefer surgical, minimal diff modifications over whole-file overwrites.")
    if t['systems_devops']['caution'] > 0.80:
        nudges.append("Pre-flight verify paths and target isolation before command execution.")

    directive_str = " ".join(nudges) or "Execute decisively with real tool output."

    return {
        "enabled": True,
        "updatedAt": int(time.time() * 1000),
        "healthIndex": int((scores.composite_fitness if scores else 0.85) * 100),
        "maxDurationMs": max_duration_ms,
        "minUsefulChars": min_useful_chars,
        "antiLoopStrict": anti_loop_strict,
        "temperatureBias": temp_bias,
        "systemNudge": directive_str,
        "reasons": [
            f"evolved_archetype_{ind.classify_archetype().replace(' ', '_').lower()}",
            "nsga2_multi_objective_tuned"
        ],
        "stats": {
            "successRate": scores.success_rate if scores else 0.90,
            "turnEfficiency": scores.turn_efficiency if scores else 0.80,
            "costEfficiency": scores.cost_efficiency if scores else 0.75,
            "safetyScore": scores.safety_score if scores else 0.95,
            "empiricalAlignment": scores.empirical_alignment if scores else 0.85,
            "compositeFitness": scores.composite_fitness if scores else 0.85,
            "archetype": ind.classify_archetype(),
            "multiTaskGenome": t,
        }
    }


def push_to_mempalace(pareto_front: List[AgentIndividual], url: str = "http://127.0.0.1:17333") -> bool:
    """Posts top Pareto frontier strategies to MemPalace bridge."""
    try:
        data = {
            "wing": "aiui",
            "room": "strategies",
            "hall": "pareto_archive",
            "content": json.dumps([individual_to_aiui_policy(ind) for ind in pareto_front[:5]], indent=2),
            "metadata": {"source": "agent_strategy_evolution_v2", "timestamp": int(time.time())}
        }
        req = urllib.request.Request(
            f"{url}/api/memory/checkpoint",
            data=json.dumps(data).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=2.0) as res:
            return res.status in (200, 201)
    except Exception as e:
        print(f"[mempalace-bridge] Note: MemPalace bridge offline or unreachable ({e})")
        return False


# ------------------------------------------------------------------------------
# 9. Main Meta-Evolutionary Loop
# ------------------------------------------------------------------------------

def run_meta_evolution(
    generations: int = 15,
    population_size: int = 60,
    mutation_rate: float = 0.15,
    telemetry_path: Optional[str] = None,
    verbose: bool = True
) -> Tuple[AgentIndividual, List[AgentIndividual], Dict[str, Any]]:
    telemetry = TelemetryReplayHarness(telemetry_path)

    if verbose:
        print("=" * 84)
        print("🧬 AIUI AGENT STRATEGY META-EVOLUTIONARY ENGINE (v2.0 - NSGA-II)")
        print(f"   Generations: {generations} │ Population: {population_size} │ Mutation Rate: {mutation_rate}")
        print(f"   Telemetry Events Loaded: {len(telemetry.events)} (logs/agent-responses.jsonl)")
        print("=" * 84)

    population = [AgentIndividual() for _ in range(population_size)]
    history: Dict[str, List[float]] = {
        'best_fitness': [],
        'avg_fitness': [],
        'success_rate': [],
        'safety_score': [],
        'pareto_size': [],
    }

    sigma = 0.15  # Mutation step size

    for gen in range(generations):
        # 1. Evaluate population
        for ind in population:
            SimulationBattery.evaluate(ind, telemetry)

        # 2. Fast Non-Dominated Sorting
        fronts = fast_non_dominated_sort(population)
        for front in fronts:
            assign_crowding_distance(front)

        # Telemetry & Convergence tracking
        pareto_front = fronts[0]
        pareto_front.sort(key=lambda a: a.scores.composite_fitness if a.scores else -1.0, reverse=True)
        current_best = pareto_front[0]
        avg_fit = sum(a.scores.composite_fitness for a in population if a.scores) / len(population)

        history['best_fitness'].append(current_best.scores.composite_fitness)
        history['avg_fitness'].append(round(avg_fit, 4))
        history['success_rate'].append(current_best.scores.success_rate)
        history['safety_score'].append(current_best.scores.safety_score)
        history['pareto_size'].append(len(pareto_front))

        if verbose:
            spark = sparkline(history['best_fitness'])
            print(
                f"Gen {gen + 1:02d}/{generations:02d} │ "
                f"Fit: {current_best.scores.composite_fitness:.4f} [{spark}] │ "
                f"Pareto: {len(pareto_front):02d} │ "
                f"Succ: {current_best.scores.success_rate:.2f} │ "
                f"Safe: {current_best.scores.safety_score:.2f} │ "
                f"{current_best.classify_archetype()}"
            )

        # 3. Environmental Selection (Elitism + NSGA-II Replacement)
        if gen < generations - 1:
            next_generation: List[AgentIndividual] = []
            front_idx = 0
            while len(next_generation) + len(fronts[front_idx]) <= population_size:
                next_generation.extend(fronts[front_idx])
                front_idx += 1
                if front_idx >= len(fronts):
                    break

            # If space remains, fill by crowding distance
            if len(next_generation) < population_size and front_idx < len(fronts):
                last_front = fronts[front_idx]
                last_front.sort(key=lambda ind: ind.crowding_distance, reverse=True)
                remainder = population_size - len(next_generation)
                next_generation.extend(last_front[:remainder])

            # 4. Reproduction: Mating via Tournament + BLX-alpha + Adaptive Mutation
            parent_pool = next_generation
            offspring_population: List[AgentIndividual] = []

            # Keep top 3 Pareto individuals untouched (Elitism)
            for elite in pareto_front[:3]:
                offspring_population.append(AgentIndividual(elite.genome.copy()))

            # 1/5th Rule: Dynamically tune Gaussian mutation variance sigma
            if gen > 0 and len(history['best_fitness']) >= 2:
                if history['best_fitness'][-1] > history['best_fitness'][-2]:
                    sigma = min(0.35, round(sigma * 1.12, 4))
                else:
                    sigma = max(0.04, round(sigma * 0.88, 4))

            while len(offspring_population) < population_size:
                p1 = nsga2_tournament_select(parent_pool, k=2)
                p2 = nsga2_tournament_select(parent_pool, k=2)
                child = crossover_blx_alpha(p1, p2, alpha=0.3)
                mutated_child = mutate_adaptive(child, mutation_rate=mutation_rate, sigma=sigma)
                offspring_population.append(mutated_child)

            population = offspring_population

    # Final evaluation & Pareto frontier extraction
    for ind in population:
        SimulationBattery.evaluate(ind, telemetry)

    fronts = fast_non_dominated_sort(population)
    for front in fronts:
        assign_crowding_distance(front)

    pareto_front = fronts[0]
    pareto_front.sort(key=lambda a: a.scores.composite_fitness if a.scores else -1.0, reverse=True)
    winner = pareto_front[0]

    return winner, pareto_front, history


# ------------------------------------------------------------------------------
# 10. Backward Compatibility Layer (v1 Migration)
# ------------------------------------------------------------------------------

ParetoIndividual = AgentIndividual

GENE_SPECS = {
    'aggression': 'High temperature and speculative breadth',
    'caution': 'Pre-flight checks and verification overhead',
    'exploration_rate': 'Alternative tool picking and novelty',
    'verification_depth': 'Assertions and test suites',
    'tool_diversity': 'Multi-tool spanning',
    'anti_loop_sensitivity': 'Stagnation detection threshold'
}


class AgentStrategy:
    """Backward compatibility wrapper around AgentIndividual & MultiTaskGenome."""
    def __init__(self, params: Optional[Dict[str, float]] = None):
        if params:
            # Clamp parameters to [0.0, 1.0]
            clamped = {k: max(0.0, min(1.0, float(v))) for k, v in params.items()}
            genome_data = {
                'code_gen': {
                    'verification_depth': clamped.get('verification_depth', 0.85),
                    'precision': clamped.get('aggression', 0.5),
                    'diff_conservatism': clamped.get('caution', 0.75),
                    'caution': clamped.get('caution', 0.70),
                },
                'self_healing': {
                    'anti_loop_sensitivity': clamped.get('anti_loop_sensitivity', 0.85),
                    'tool_diversity': clamped.get('tool_diversity', 0.80),
                    'exploration_rate': clamped.get('exploration_rate', 0.60),
                    'retry_budget': clamped.get('aggression', 0.70),
                },
                'fast_query': {
                    'brevity': 0.85,
                    'latency_priority': clamped.get('aggression', 0.85),
                    'direct_response_ratio': 0.85,
                    'caution': clamped.get('caution', 0.30),
                },
                'systems_devops': {
                    'caution': clamped.get('caution', 0.90),
                    'pre_flight_dryrun': 0.85,
                    'container_isolation': 0.75,
                    'verification_depth': clamped.get('verification_depth', 0.80),
                },
                'global_meta': {
                    'temperature_bias': round((clamped.get('aggression', 0.5) - 0.5) * 0.4, 3),
                    'max_duration_ms': int(20000 + clamped.get('verification_depth', 0.5) * 15000),
                    'min_useful_chars': int(30 + clamped.get('caution', 0.5) * 30),
                    'anti_loop_strict': 1.0 if clamped.get('anti_loop_sensitivity', 0.8) > 0.5 else 0.0,
                }
            }
            self.individual = AgentIndividual(MultiTaskGenome(genome_data))
        else:
            self.individual = AgentIndividual()

    @property
    def params(self) -> Dict[str, float]:
        t = self.individual.genome.traits
        return {
            'aggression': t['fast_query']['latency_priority'],
            'caution': t['systems_devops']['caution'],
            'exploration_rate': t['self_healing']['exploration_rate'],
            'verification_depth': t['code_gen']['verification_depth'],
            'tool_diversity': t['self_healing']['tool_diversity'],
            'anti_loop_sensitivity': t['self_healing']['anti_loop_sensitivity'],
        }

    @property
    def scores(self) -> Optional[MultiObjectiveScores]:
        return self.individual.scores

    @scores.setter
    def scores(self, val: Optional[MultiObjectiveScores]):
        self.individual.scores = val

    def classify_archetype(self) -> str:
        return self.individual.classify_archetype()

    def crossover_blx(self, other: 'AgentStrategy', alpha: float = 0.3) -> 'AgentStrategy':
        child_ind = crossover_blx_alpha(self.individual, other.individual, alpha=alpha)
        res = AgentStrategy()
        res.individual = child_ind
        return res

    def mutate_adaptive(self, mutation_rate: float = 0.15, diversity_factor: float = 0.1) -> 'AgentStrategy':
        mutated_ind = mutate_adaptive(self.individual, mutation_rate=mutation_rate, sigma=max(0.05, diversity_factor))
        res = AgentStrategy()
        res.individual = mutated_ind
        return res


class BenchmarkEnvironment:
    """Backward compatibility evaluator wrapping SimulationBattery."""
    @staticmethod
    def evaluate_scenario(scenario_name: str, agent: AgentStrategy) -> Tuple[float, float, float, float]:
        scores = SimulationBattery.evaluate(agent.individual, TelemetryReplayHarness())
        return scores.success_rate, scores.turn_efficiency, scores.cost_efficiency, scores.safety_score

    @staticmethod
    def evaluate_agent(agent: AgentStrategy, scenarios: Optional[List[str]] = None) -> MultiObjectiveScores:
        scores = SimulationBattery.evaluate(agent.individual, TelemetryReplayHarness())
        agent.scores = scores
        return scores


def extract_pareto_front(population: List[Any]) -> List[Any]:
    """Backward compatibility wrapper around fast_non_dominated_sort."""
    if not population:
        return []
    is_legacy = isinstance(population[0], AgentStrategy)
    ind_pop = [p.individual if is_legacy else p for p in population]
    fronts = fast_non_dominated_sort(ind_pop)
    f1 = fronts[0] if fronts else []
    if is_legacy:
        return [p for p in population if p.individual in f1]
    return f1


def compute_population_diversity(population: List[Any]) -> float:
    return 0.5


def strategy_to_aiui_policy(agent: Any) -> Dict[str, Any]:
    """Backward compatibility alias for individual_to_aiui_policy."""
    ind = agent.individual if isinstance(agent, AgentStrategy) else agent
    policy = individual_to_aiui_policy(ind)
    # Ensure legacy 'genes' key exists under stats for backward compatibility
    if 'stats' in policy and isinstance(agent, AgentStrategy):
        policy['stats']['genes'] = agent.params
    return policy


def run_evolution(*args, **kwargs) -> Tuple[Any, List[Any], Dict[str, Any]]:
    """Backward compatibility alias for run_meta_evolution."""
    # Filter kwargs that don't belong to run_meta_evolution
    valid_args = {'generations', 'population_size', 'mutation_rate', 'telemetry_path', 'verbose'}
    filtered_kwargs = {k: v for k, v in kwargs.items() if k in valid_args}
    winner_ind, pareto_ind, history = run_meta_evolution(*args, **filtered_kwargs)
    winner_legacy = AgentStrategy()
    winner_legacy.individual = winner_ind
    pareto_legacy = []
    for ind in pareto_ind:
        s = AgentStrategy()
        s.individual = ind
        pareto_legacy.append(s)
    return winner_legacy, pareto_legacy, history


# ------------------------------------------------------------------------------
# 11. Daemon Mode & CLI
# ------------------------------------------------------------------------------

def run_daemon(interval_seconds: int = 300):
    """Standing autonomous background optimizer daemon."""
    print("=" * 84)
    print("🤖 STARTING AIUI AUTONOMOUS AGENT STRATEGY OPTIMIZATION DAEMON")
    print(f"   Polling Interval: {interval_seconds}s │ Telemetry: logs/agent-responses.jsonl")
    print("   Press Ctrl+C to terminate gracefully.")
    print("=" * 84)

    running = True

    def sig_handler(signum, frame):
        nonlocal running
        print("\n[daemon] Gracefully shutting down...")
        running = False

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    iteration = 1
    policy_path = Path(__file__).resolve().parent / 'logs' / 'chat-response-optimizer-policy.json'

    while running:
        print(f"\n[daemon cycle {iteration}] Evaluating telemetry & evolving micro-generations...")
        try:
            winner, pareto, _ = run_meta_evolution(generations=6, population_size=30, verbose=False)
            policy = individual_to_aiui_policy(winner)
            policy_path.parent.mkdir(parents=True, exist_ok=True)
            with open(policy_path, 'w', encoding='utf-8') as f:
                json.dump(policy, f, indent=2)

            print(f"[daemon cycle {iteration}] ✔ Updated AIUI Policy: Health {policy['healthIndex']} | {policy['stats']['archetype']} | TempBias {policy['temperatureBias']}")
            push_to_mempalace(pareto)
        except Exception as err:
            print(f"[daemon cycle {iteration}] Error: {err}")

        iteration += 1
        for _ in range(interval_seconds):
            if not running:
                break
            time.sleep(1)


def main():
    parser = argparse.ArgumentParser(
        description="AIUI Agent Strategy Meta-Evolutionary Optimizer & Auto-Tuning Engine (v2.0)"
    )
    parser.add_argument('-g', '--generations', type=int, default=15, help="Number of generations (default: 15)")
    parser.add_argument('-p', '--population', type=int, default=60, help="Population size (default: 60)")
    parser.add_argument('-m', '--mutation', type=float, default=0.15, help="Base mutation rate (default: 0.15)")
    parser.add_argument('--empirical', action='store_true', help="Force empirical replay from logs/agent-responses.jsonl")
    parser.add_argument('--telemetry-file', type=str, default=None, help="Custom path to agent telemetry JSONL file")
    parser.add_argument('--pareto-plot', action='store_true', default=True, help="Render 2D ASCII Pareto Phase-Space Scatter Plot")
    parser.add_argument('--export', type=str, default=None, help="Export winning policy JSON to specified path")
    parser.add_argument('--apply-policy', action='store_true', default=True, help="Hot-reload winning strategy into logs/chat-response-optimizer-policy.json (default: True)")
    parser.add_argument('--no-apply', action='store_false', dest='apply_policy', help="Do not update logs/chat-response-optimizer-policy.json")
    parser.add_argument('--mempalace', action='store_true', help="Archive Pareto front to MemPalace bridge (:17333)")
    parser.add_argument('--daemon', action='store_true', help="Run continuous background auto-tuning daemon")
    parser.add_argument('--interval', type=int, default=300, help="Daemon polling interval in seconds (default: 300)")

    args = parser.parse_args()

    if args.daemon:
        run_daemon(interval_seconds=args.interval)
        return

    telemetry_target = args.telemetry_file or (str(Path(__file__).resolve().parent / 'logs' / 'agent-responses.jsonl') if args.empirical else None)

    winner, pareto_front, history = run_meta_evolution(
        generations=args.generations,
        population_size=args.population,
        mutation_rate=args.mutation,
        telemetry_path=telemetry_target
    )

    # Output Presentation
    print("\n" + "=" * 84)
    print("🏆 META-EVOLUTION COMPLETE — OPTIMAL AGENT POLICY (Rank 1)")
    print("=" * 84)
    s = winner.scores
    print(f"Archetype: {winner.classify_archetype()}")
    print(f"Composite Fitness: {s.composite_fitness:.4f} │ "
          f"Success Rate: {s.success_rate:.2%} │ "
          f"Turn Efficiency: {s.turn_efficiency:.2%} │ "
          f"Cost Efficiency: {s.cost_efficiency:.2%} │ "
          f"Safety Score: {s.safety_score:.2%}")
    print("-" * 84)
    print("Multi-Task Contextual Genome:")
    for task, genes in winner.genome.traits.items():
        print(f"  [{task.upper()}]:")
        for g, val in genes.items():
            if task == 'global_meta':
                print(f"     • {g:24s}: {val}")
            else:
                bar = "█" * int(val * 20)
                print(f"     • {g:24s}: {val:.3f} |{bar:<20}|")

    if args.pareto_plot:
        print("\n" + "=" * 84)
        print(f"🌐 2D PARETO PHASE-SPACE SCATTER PLOT ({len(pareto_front)} Non-Dominated Solutions)")
        print("=" * 84)
        print(render_pareto_scatter_plot(pareto_front))

    policy = individual_to_aiui_policy(winner)

    # Handle Exports
    if args.export:
        out_path = Path(args.export).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(policy, f, indent=2)
        print(f"\n✔ Exported evolved policy to: {out_path}")

    if args.apply_policy:
        default_policy_path = Path(__file__).resolve().parent / 'logs' / 'chat-response-optimizer-policy.json'
        default_policy_path.parent.mkdir(parents=True, exist_ok=True)
        with open(default_policy_path, 'w', encoding='utf-8') as f:
            json.dump(policy, f, indent=2)
        print(f"\n✔ Live AIUI Policy updated: {default_policy_path}")
        print(f"   Directive: \"{policy['systemNudge']}\"")

    if args.mempalace:
        ok = push_to_mempalace(pareto_front)
        if ok:
            print("\n✔ Successfully archived Pareto frontier to MemPalace (:17333) [aiui/strategies/pareto_archive]")


if __name__ == '__main__':
    main()
