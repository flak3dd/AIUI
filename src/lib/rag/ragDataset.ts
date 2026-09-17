/**
 * Verified 2026 Sovereign Spark & Cluster Architecture Ground-Truth Dataset.
 * Source of truth for on-device RAG to prevent LLM hallucinations.
 */

export interface KnowledgeRecord {
  id: string
  title: string
  path: string
  content: string
}

export const KNOWLEDGE_DATASET: KnowledgeRecord[] = [
  {
    id: 'seed_01_network_routing',
    title: 'Network Interfaces and Routing Matrix',
    path: 'knowledge/01-network-routing.md',
    content: `# Network Interfaces and Routing Matrix

Verified Spark / Mac / cloud routes for Abliterated.

## Hosts
- Direct LAN Spark (primary): 192.168.4.103 — NVIDIA DGX Spark GB10 (~10–13ms)
- Secondary LAN Spark NIC: 192.168.4.101 (~20–60ms)
- Tailscale Spark: 100.94.45.77 hostname gx10-d0e7 (~10–25ms)
- Mac host LAN: 192.168.4.50 — Gateway, web interfaces (~1–3ms)
- Mac Tailscale: 100.120.81.22
- Localhost: 127.0.0.1
- Featherless AI Mesh: https://api.featherless.ai/v1 — serverless open-weight router (~30–60ms)
- Abliterated Cloud IO (mirror): https://api.abliteration.ai/v1 HTTPS :443

## Service Ports
- Go API Gateway: 8080 (Mac reverse proxy with token-bucket rate limiting)
- Compute Coordinator: 8090 (FastAPI + DuckDB OLAP + asyncio.TaskGroup)
- vLLM Inference: 8000 (Blackwell GB10 GPU)
- Diffusers Bridge: 7860 (Image generation)
- Spark Controller: 17325 (GPU status & lifecycle)
- Sandbox Runner: 17330 (Ephemeral PTY & execution daemon)
- MemPalace Memory Bridge: 17333 (Associative memory)
- Cloud Proxy: 17332 (Key proxy for browser clients)
`,
  },
  {
    id: 'seed_02_vllm_inference',
    title: 'vLLM Inference API (:8000)',
    path: 'knowledge/02-vllm-inference.md',
    content: `# vLLM Inference API (:8000)

OpenAI-compatible high-throughput engine on Blackwell GB10 GPU.

## Served Models
- Primary: qwen-abliterated — RadixArk/Qwen3.8-Flash-Next-NVFP4 (~122 GiB NVFP4 + FP8 PLE) via blazux qwen38-flash-dgx with VLLM_PLE_MMAP=1.
- Weights: HF cache ~/.cache/huggingface/hub/models--RadixArk--Qwen3.8-Flash-Next-NVFP4.
- Defaults: --max-model-len 262144 (or 16384 on 27B) --gpu-memory-utilization 0.80 --enable-prefix-caching.

## Critical Parameters
- chat_template_kwargs.enable_thinking=false must be passed when immediate content is desired without the reasoning trace.
- Native tool calling requires --enable-auto-tool-choice --tool-call-parser qwen3_coder.
`,
  },
  {
    id: 'seed_04_comfy_controller_gateway',
    title: 'Spark Controller & Gateway Architecture',
    path: 'knowledge/04-comfy-controller-gateway.md',
    content: `# Spark Controller & Gateway Architecture

## Unified Go Gateway (:8080)
- In-memory concurrent token-bucket rate limiting.
- Inspects requests and proxies downstream to Compute Coordinator (:8090).
- Forwarding endpoints: /v1/chat/completions, /api/ingest, /api/analytics/velocity.

## Compute Coordinator (:8090)
- FastAPI with Python 3.11 asyncio.TaskGroup background worker.
- Embedded DuckDB in-process vectorized OLAP engine.
- Decoupled Pub/Sub event broker with FIFO ordering keys and Dead-Letter Queue (DLQ).
- NVIDIA RAPIDS cuDF hardware-accelerated tabular data processing on Blackwell GB10.
`,
  },
  {
    id: 'seed_06_model_storage',
    title: 'Hardware Specs & NVMe Storage Inventory',
    path: 'knowledge/06-model-storage.md',
    content: `# Hardware Specs & NVMe Storage Inventory

## Hardware Context (DGX Spark)
- GPU: NVIDIA Blackwell GB10 (sm_121a)
- Unified memory spec: 128 GB LPDDR5x coherent (CPU+GPU), 273 GB/s bandwidth.
- CUDA visible pool: ~121.7 GiB (MemTotal).
- Power Envelope: 140 W SOC TDP envelope.
- NVMe storage path: /mnt/nvme/ (high-speed Gen5 NVMe for parquet files and models).
`,
  },
]
