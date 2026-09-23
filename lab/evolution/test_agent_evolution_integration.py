#!/usr/bin/env python3
"""
================================================================================
COMPREHENSIVE TEST SUITE FOR AGENT STRATEGY EVOLUTION ENGINE (v2.0)
================================================================================
Validates:
1. Multi-Task Contextual Genome (GENE_SCHEMA, bounds clamping, copy)
2. Continuous Genetic Operators (BLX-alpha crossover & adaptive Gaussian mutation)
3. Telemetry Replay Harness (live logs/agent-responses.jsonl & synthetic trace parsing)
4. Multi-Scenario Simulation Battery & MultiObjectiveScores
5. NSGA-II Fast Non-Dominated Sorting & Crowding Distance Assignment
6. 2D ASCII Pareto Phase-Space Scatter Plot Rendering
7. AIUI Policy Schema Translation & Round-Trip JSON Compliance
8. Backward Compatibility Layer (AgentStrategy, GENE_SPECS, BenchmarkEnvironment)
9. End-to-End Meta-Evolutionary Optimization Run (run_meta_evolution)
10. MemPalace Bridge Checkpoint Serialization
================================================================================
"""

import sys
import json
import tempfile
from pathlib import Path

# Target module imports
from agent_strategy_evolution import (
    GENE_SCHEMA,
    MultiTaskGenome,
    MultiObjectiveScores,
    AgentIndividual,
    TelemetryReplayHarness,
    SimulationBattery,
    fast_non_dominated_sort,
    assign_crowding_distance,
    nsga2_tournament_select,
    crossover_blx_alpha,
    mutate_adaptive,
    sparkline,
    render_pareto_scatter_plot,
    individual_to_aiui_policy,
    push_to_mempalace,
    run_meta_evolution,
    # Backward compatibility
    AgentStrategy,
    GENE_SPECS,
    BenchmarkEnvironment,
    extract_pareto_front,
    strategy_to_aiui_policy,
    run_evolution,
)


def test_1_multitask_genome_schema_and_clamping():
    print("• [Suite 1/10] Multi-Task Genome Schema & Clamping...")
    
    # Custom values testing boundary clamping and types
    raw_data = {
        'code_gen': {
            'verification_depth': 1.8,   # clamp to 1.0
            'precision': -0.4,           # clamp to 0.0
            'diff_conservatism': 0.77,
            'caution': 0.65,
        },
        'global_meta': {
            'temperature_bias': 0.85,    # clamp to 0.35
            'max_duration_ms': 99999,    # clamp to 45000
            'min_useful_chars': 5,       # clamp to 15
            'anti_loop_strict': 1.0,
        }
    }
    genome = MultiTaskGenome(raw_data)
    
    # Check bounds
    assert genome.traits['code_gen']['verification_depth'] == 1.0, "code_gen verification_depth should clamp to 1.0"
    assert genome.traits['code_gen']['precision'] == 0.0, "code_gen precision should clamp to 0.0"
    assert genome.traits['global_meta']['temperature_bias'] == 0.35, "temperature_bias should clamp to 0.35"
    assert genome.traits['global_meta']['max_duration_ms'] == 45000, "max_duration_ms should clamp to 45000"
    assert genome.traits['global_meta']['min_useful_chars'] == 15, "min_useful_chars should clamp to 15"
    
    # Verify all tasks in schema exist
    for task in GENE_SCHEMA:
        assert task in genome.traits, f"Missing task {task} in traits"
        for gene in GENE_SCHEMA[task]:
            assert gene in genome.traits[task], f"Missing gene {gene} in task {task}"

    # Verify deep copy
    copied = genome.copy()
    copied.traits['code_gen']['verification_depth'] = 0.42
    assert genome.traits['code_gen']['verification_depth'] == 1.0, "Genome deep copy must be isolated"
    print("  ✔ Multi-task genome schema, clamping, and isolation passed.")


def test_2_continuous_genetic_operators():
    print("• [Suite 2/10] Continuous BLX-alpha Crossover & Adaptive Gaussian Mutation...")
    
    p1 = AgentIndividual()
    p2 = AgentIndividual()
    
    # Force distinct values
    for task in GENE_SCHEMA:
        for gene in GENE_SCHEMA[task]:
            p1.genome.traits[task][gene] = 0.2
            p2.genome.traits[task][gene] = 0.8
            
    child = crossover_blx_alpha(p1, p2, alpha=0.3)
    assert child is not None
    assert isinstance(child.genome, MultiTaskGenome)
    
    # Verify continuous spread within alpha expansion
    for task in GENE_SCHEMA:
        if task == 'global_meta':
            continue
        for gene, val in child.genome.traits[task].items():
            assert 0.0 <= val <= 1.0, f"Child gene out of bounds: {task}.{gene}={val}"

    # Mutate adaptive
    mutated = mutate_adaptive(child, mutation_rate=1.0, sigma=0.1)
    assert mutated is not None
    for task in GENE_SCHEMA:
        if task == 'global_meta':
            continue
        for gene, val in mutated.genome.traits[task].items():
            assert 0.0 <= val <= 1.0, f"Mutated gene out of bounds: {task}.{gene}={val}"
            
    print("  ✔ Continuous BLX-alpha crossover and adaptive mutation passed.")


def test_3_telemetry_replay_harness():
    print("• [Suite 3/10] Telemetry Replay Harness (Empirical Backtesting)...")
    
    # 1. Test against synthetic trace file
    synthetic_events = [
        {"timestamp": 1789629000000, "type": "response", "durationMs": 32000, "responseText": "Slow turn"},
        {"timestamp": 1789629005000, "type": "anti_loop", "analysis": {"isLooping": True}},
        {"timestamp": 1789629010000, "type": "error", "error": "command failed"},
        {"timestamp": 1789629015000, "type": "response", "durationMs": 450, "responseText": "ok"},
    ]
    
    with tempfile.NamedTemporaryFile(suffix='.jsonl', mode='w', delete=False, encoding='utf-8') as f:
        for ev in synthetic_events:
            f.write(json.dumps(ev) + "\n")
        temp_log_path = Path(f.name)
        
    try:
        harness = TelemetryReplayHarness(str(temp_log_path))
        assert len(harness.events) == 4, f"Expected 4 events, got {len(harness.events)}"
        
        # Test individual with strong defense & anti-loop
        defensive = AgentIndividual()
        defensive.genome.traits['self_healing']['anti_loop_sensitivity'] = 0.95
        defensive.genome.traits['systems_devops']['caution'] = 0.95
        defensive.genome.traits['fast_query']['latency_priority'] = 0.90
        defensive.genome.traits['code_gen']['precision'] = 0.90
        
        score_defensive = harness.evaluate_against_telemetry(defensive)
        
        # Test individual with weak traits
        fragile = AgentIndividual()
        fragile.genome.traits['self_healing']['anti_loop_sensitivity'] = 0.10
        fragile.genome.traits['systems_devops']['caution'] = 0.10
        fragile.genome.traits['fast_query']['latency_priority'] = 0.10
        fragile.genome.traits['code_gen']['precision'] = 0.10
        
        score_fragile = harness.evaluate_against_telemetry(fragile)
        
        assert score_defensive > score_fragile, f"Defensive {score_defensive} should beat fragile {score_fragile}"
        assert 0.0 <= score_defensive <= 1.0
        assert 0.0 <= score_fragile <= 1.0
    finally:
        temp_log_path.unlink(missing_ok=True)
        
    # 2. Test live logs/agent-responses.jsonl if present
    live_log = Path(__file__).resolve().parent / 'logs' / 'agent-responses.jsonl'
    if live_log.exists():
        live_harness = TelemetryReplayHarness(str(live_log))
        assert len(live_harness.events) > 0, "Should load live events from logs/agent-responses.jsonl"
        live_score = live_harness.evaluate_against_telemetry(defensive)
        assert 0.0 <= live_score <= 1.0
        print(f"  ✔ Telemetry replay passed ({len(live_harness.events)} live events ingested, score: {live_score:.4f}).")
    else:
        print("  ✔ Telemetry replay passed with synthetic trace.")


def test_4_simulation_battery_and_scores():
    print("• [Suite 4/10] Multi-Scenario Simulation Battery & Objective Scoring...")
    
    ind = AgentIndividual()
    harness = TelemetryReplayHarness()
    scores = SimulationBattery.evaluate(ind, harness)
    
    assert ind.scores is not None
    assert 0.0 <= scores.success_rate <= 1.0
    assert 0.0 <= scores.turn_efficiency <= 1.0
    assert 0.0 <= scores.cost_efficiency <= 1.0
    assert 0.0 <= scores.safety_score <= 1.0
    assert 0.0 <= scores.empirical_alignment <= 1.0
    assert 0.0 <= scores.composite_fitness <= 1.0
    
    # Test Pareto dominance logic
    s1 = MultiObjectiveScores(0.95, 0.85, 0.80, 0.90)
    s2 = MultiObjectiveScores(0.80, 0.70, 0.65, 0.75)
    s3 = MultiObjectiveScores(0.98, 0.60, 0.90, 0.85)  # Trade-off
    
    assert s1.dominates(s2), "s1 must dominate s2"
    assert not s2.dominates(s1), "s2 must not dominate s1"
    assert not s1.dominates(s3), "s1 must not dominate trade-off s3"
    assert not s3.dominates(s1), "s3 must not dominate s1"
    print("  ✔ Simulation battery and Pareto dominance assertions passed.")


def test_5_nsga2_non_dominated_sorting_and_crowding():
    print("• [Suite 5/10] NSGA-II Fast Non-Dominated Sorting & Crowding Distance...")
    
    pop = [AgentIndividual() for _ in range(20)]
    harness = TelemetryReplayHarness()
    for ind in pop:
        SimulationBattery.evaluate(ind, harness)
        
    fronts = fast_non_dominated_sort(pop)
    assert len(fronts) >= 1, "Must produce at least one Pareto front"
    
    # Verify rank monotonicity and partition completeness
    total_in_fronts = sum(len(f) for f in fronts)
    assert total_in_fronts == len(pop), f"All {len(pop)} individuals must be in a front, found {total_in_fronts}"
    
    for rank_idx, front in enumerate(fronts):
        for ind in front:
            assert ind.rank == rank_idx + 1, f"Individual rank {ind.rank} != expected {rank_idx + 1}"
            
    # Test crowding distance assignment on Front 1
    assign_crowding_distance(fronts[0])
    if len(fronts[0]) > 2:
        # Boundary solutions must receive inf
        inf_count = sum(1 for ind in fronts[0] if ind.crowding_distance == float('inf'))
        assert inf_count >= 2, f"Boundary solutions must have inf distance, found {inf_count}"
        
    # Test tournament selection
    best = nsga2_tournament_select(pop, k=3)
    assert best in pop
    print(f"  ✔ NSGA-II sorting passed ({len(fronts)} Pareto layers, Front 1 size: {len(fronts[0])}).")


def test_6_ascii_pareto_scatter_plot():
    print("• [Suite 6/10] 2D ASCII Pareto Phase-Space Scatter Plot Renderer...")
    
    pop = [AgentIndividual() for _ in range(15)]
    harness = TelemetryReplayHarness()
    for ind in pop:
        SimulationBattery.evaluate(ind, harness)
        
    fronts = fast_non_dominated_sort(pop)
    plot_str = render_pareto_scatter_plot(fronts[0], width=40, height=10)
    
    assert "Quality (Success + Safety)" in plot_str
    assert "Efficiency (Turn + Cost)" in plot_str
    assert "Legend: [D]" in plot_str
    lines = plot_str.strip().split("\n")
    assert len(lines) >= 12, f"Expected coordinate grid lines, got {len(lines)}"
    print("  ✔ 2D ASCII Pareto scatter plot rendering verified.")


def test_7_aiui_policy_export_and_json_compliance():
    print("• [Suite 7/10] AIUI Policy Schema Translation & JSON Compliance...")
    
    ind = AgentIndividual()
    harness = TelemetryReplayHarness()
    SimulationBattery.evaluate(ind, harness)
    
    policy = individual_to_aiui_policy(ind)
    
    # Required keys matching src/lib/chatResponseOptimizer.ts
    assert policy['enabled'] is True
    assert isinstance(policy['updatedAt'], int)
    assert 0 <= policy['healthIndex'] <= 100
    assert 10000 <= policy['maxDurationMs'] <= 45000
    assert 15 <= policy['minUsefulChars'] <= 90
    assert isinstance(policy['antiLoopStrict'], bool)
    assert -0.35 <= policy['temperatureBias'] <= 0.35
    assert isinstance(policy['systemNudge'], str) and len(policy['systemNudge']) > 5
    assert isinstance(policy['reasons'], list) and len(policy['reasons']) > 0
    assert 'stats' in policy
    assert 'multiTaskGenome' in policy['stats']
    assert 'compositeFitness' in policy['stats']
    assert 'archetype' in policy['stats']
    
    # Round-trip JSON file serialization
    with tempfile.NamedTemporaryFile(suffix='.json', mode='w', delete=False, encoding='utf-8') as f:
        json.dump(policy, f, indent=2)
        tmp_policy = Path(f.name)
        
    try:
        with open(tmp_policy, 'r', encoding='utf-8') as f:
            reloaded = json.load(f)
        assert reloaded['healthIndex'] == policy['healthIndex']
        assert reloaded['temperatureBias'] == policy['temperatureBias']
        assert reloaded['systemNudge'] == policy['systemNudge']
    finally:
        tmp_policy.unlink(missing_ok=True)
        
    print("  ✔ AIUI Policy Schema compliance and JSON serialization passed.")


def test_8_backward_compatibility_layer():
    print("• [Suite 8/10] Backward Compatibility Layer (v1 Migration)...")
    
    # Test AgentStrategy wrapper
    legacy_agent = AgentStrategy({
        'aggression': 0.85,
        'caution': 0.70,
        'exploration_rate': 0.55,
        'verification_depth': 0.90,
        'tool_diversity': 0.75,
        'anti_loop_sensitivity': 0.88,
    })
    
    # Test properties and mapping
    assert legacy_agent.params['caution'] == 0.70
    assert legacy_agent.params['verification_depth'] == 0.90
    assert legacy_agent.classify_archetype() != ""
    
    # Test BenchmarkEnvironment
    scores = BenchmarkEnvironment.evaluate_agent(legacy_agent)
    assert scores.composite_fitness > 0.0
    assert legacy_agent.scores is not None
    
    # Test legacy crossover and mutation
    other = AgentStrategy({'aggression': 0.3, 'caution': 0.8})
    child = legacy_agent.crossover_blx(other)
    assert 0.0 <= child.params['caution'] <= 1.0
    mutated = child.mutate_adaptive(mutation_rate=1.0)
    assert 0.0 <= mutated.params['caution'] <= 1.0
    
    # Test extract_pareto_front
    pop = [legacy_agent, other]
    front = extract_pareto_front(pop)
    assert len(front) >= 1
    assert isinstance(front[0], AgentStrategy)
    
    # Test strategy_to_aiui_policy
    legacy_policy = strategy_to_aiui_policy(legacy_agent)
    assert legacy_policy['enabled'] is True
    assert 'genes' in legacy_policy['stats']
    
    print("  ✔ Backward compatibility layer verified.")


def test_9_end_to_end_meta_evolution_run():
    print("• [Suite 9/10] End-to-End Generational Meta-Evolution Run (5 gens, pop 24)...")
    
    winner, pareto_front, history = run_meta_evolution(
        generations=5,
        population_size=24,
        mutation_rate=0.15,
        verbose=False
    )
    
    assert winner is not None
    assert winner.scores is not None
    assert len(pareto_front) >= 1
    assert len(history['best_fitness']) == 5
    assert len(history['pareto_size']) == 5
    
    # Monotonicity of best fitness (with elitism, best fitness does not degrade)
    first_fit = history['best_fitness'][0]
    last_fit = history['best_fitness'][-1]
    assert last_fit >= first_fit - 1e-4, f"Elitism regression: {last_fit} < {first_fit}"
    
    spark = sparkline(history['best_fitness'])
    assert len(spark) == 5
    print(f"  ✔ End-to-end evolution converged (Winner: {winner.scores.composite_fitness:.4f} [{spark}], Archetype: {winner.classify_archetype()}).")


def test_10_mempalace_bridge_serialization():
    print("• [Suite 10/10] MemPalace Bridge Checkpoint Serialization...")
    
    ind = AgentIndividual()
    SimulationBattery.evaluate(ind, TelemetryReplayHarness())
    
    # Should handle offline gracefully without throwing unhandled exceptions
    ok = push_to_mempalace([ind], url="http://127.0.0.1:99999")
    assert ok is False, "Expected false when target port is offline"
    print("  ✔ MemPalace bridge offline safety handling verified.")


def run_all_tests():
    print("=" * 80)
    print("🧬 AGENT STRATEGY EVOLUTION ENGINE v2.0 INTEGRATION TEST HARNESS")
    print("=" * 80)
    try:
        test_1_multitask_genome_schema_and_clamping()
        test_2_continuous_genetic_operators()
        test_3_telemetry_replay_harness()
        test_4_simulation_battery_and_scores()
        test_5_nsga2_non_dominated_sorting_and_crowding()
        test_6_ascii_pareto_scatter_plot()
        test_7_aiui_policy_export_and_json_compliance()
        test_8_backward_compatibility_layer()
        test_9_end_to_end_meta_evolution_run()
        test_10_mempalace_bridge_serialization()
        print("\n" + "=" * 80)
        print("🎉 ALL 10 TEST SUITES PASSED FLAWLESSLY")
        print("=" * 80)
        return 0
    except AssertionError as err:
        print(f"\n❌ TEST SUITE ASSERTION FAILED: {err}")
        import traceback
        traceback.print_exc()
        return 1
    except Exception as err:
        print(f"\n💥 UNEXPECTED EXCEPTION: {err}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(run_all_tests())
