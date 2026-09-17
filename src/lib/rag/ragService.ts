import { KNOWLEDGE_DATASET, type KnowledgeRecord } from './ragDataset'

export interface RagChunk {
  id: string
  docId: string
  title: string
  text: string
  tokens: string[]
  embedding: number[]
}

export interface RagHit {
  chunk: RagChunk
  score: number
  bm25: number
  dense: number
}

const EMBED_DIM = 256
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it',
  'this', 'that', 'with', 'as', 'at', 'by', 'be', 'are', 'was', 'were', 'from',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s/.:-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hashEmbed(tokens: string[]): number[] {
  const vec = new Array(EMBED_DIM).fill(0)
  if (!tokens.length) return vec
  for (const t of tokens) {
    const h = hash32(t)
    const idx = h % EMBED_DIM
    const sign = (h & 0x80000000) === 0 ? 1 : -1
    vec[idx] += sign
  }
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm
  }
  return vec
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < EMBED_DIM; i++) dot += a[i] * b[i]
  return Math.max(0, dot)
}

class InProcessRagIndex {
  private chunks: RagChunk[] = []
  private avgDocLen = 0
  private docFreq: Map<string, number> = new Map()

  constructor(records: KnowledgeRecord[]) {
    this.buildIndex(records)
  }

  private buildIndex(records: KnowledgeRecord[]) {
    const allChunks: RagChunk[] = []
    let totalTokens = 0

    for (const rec of records) {
      // Split by markdown headers or sections
      const sections = rec.content.split(/\n(?=##?\s)/)
      for (let i = 0; i < sections.length; i++) {
        const text = sections[i].trim()
        if (!text) continue
        const tokens = tokenize(text)
        if (!tokens.length) continue
        totalTokens += tokens.length

        allChunks.push({
          id: `${rec.id}_c${i}`,
          docId: rec.id,
          title: rec.title,
          text,
          tokens,
          embedding: hashEmbed(tokens),
        })
      }
    }

    this.chunks = allChunks
    this.avgDocLen = allChunks.length ? totalTokens / allChunks.length : 1

    // Document frequencies for BM25
    for (const c of allChunks) {
      const seenInChunk = new Set(c.tokens)
      for (const t of seenInChunk) {
        this.docFreq.set(t, (this.docFreq.get(t) || 0) + 1)
      }
    }
  }

  public search(query: string, topK = 3): RagHit[] {
    const qTokens = tokenize(query)
    if (!qTokens.length) return []
    const qEmbed = hashEmbed(qTokens)
    const k1 = 1.4
    const b = 0.75
    const N = Math.max(1, this.chunks.length)

    const scored: RagHit[] = []

    for (const chunk of this.chunks) {
      // 1. BM25 score
      let bm25 = 0
      const chunkLen = chunk.tokens.length
      const tfMap = new Map<string, number>()
      for (const t of chunk.tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1)

      for (const qt of qTokens) {
        const tf = tfMap.get(qt) || 0
        if (tf === 0) continue
        const df = this.docFreq.get(qt) || 0
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
        const num = tf * (k1 + 1)
        const den = tf + k1 * (1 - b + b * (chunkLen / this.avgDocLen))
        bm25 += idf * (num / den)
      }

      // 2. Dense Cosine similarity
      const dense = cosine(qEmbed, chunk.embedding)

      // 3. Hybrid blend
      const finalScore = 0.65 * Math.min(1.0, bm25 / 4.0) + 0.35 * dense

      if (finalScore > 0.15) {
        scored.push({ chunk, score: finalScore, bm25, dense })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }
}

// Singleton RAG Index
export const ragIndex = new InProcessRagIndex(KNOWLEDGE_DATASET)

export function queryRagKnowledge(query: string, topK = 3): RagHit[] {
  return ragIndex.search(query, topK)
}

export const RAG_MIN_SCORE = 0.22

export function formatRagContextBlock(hits: RagHit[]): string {
  if (!hits.length) return ''
  const passages = hits
    .map((h, i) => {
      const body = h.chunk.text.length > 900 ? `${h.chunk.text.slice(0, 900)}…` : h.chunk.text
      return `[Source ${i + 1}: ${h.chunk.title} | score=${h.score.toFixed(2)}]\n${body}`
    })
    .join('\n\n')
  return `\n\n=== VERIFIED CLUSTER CONTEXT (high-relevance only) ===\n${passages}\n=== END CLUSTER CONTEXT ===\n`
}
