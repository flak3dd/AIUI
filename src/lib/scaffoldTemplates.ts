/**
 * Standardized Project Scaffold Templates
 * Full catalog of 52 repository, service, CI, Docker, testing, and component scaffolds.
 */
import rawTemplates from './scaffoldTemplates.json' with { type: 'json' }

export interface ScaffoldTemplate {
  id: string
  name: string
  description: string
  files: Record<string, string>
}

export interface ScaffoldFile {
  path: string
  content: string
  description?: string
}

export interface ScaffoldDefinition {
  id: string
  name: string
  description: string
  tree: string
  files: ScaffoldFile[]
}

export const SCAFFOLD_CATALOG: Record<string, ScaffoldTemplate> = rawTemplates as Record<
  string,
  ScaffoldTemplate
>

/**
 * Returns all 52 scaffold templates from the catalog.
 */
export function getAllScaffolds(): ScaffoldTemplate[] {
  return Object.values(SCAFFOLD_CATALOG)
}

/**
 * Get a specific scaffold template by ID.
 */
export function getScaffoldById(id: string): ScaffoldTemplate | undefined {
  return SCAFFOLD_CATALOG[id]
}

/**
 * Retrieve scaffold files by template ID with optional project name interpolation.
 */
export function getScaffoldFiles(
  id: string,
  options?: { projectName?: string },
): ScaffoldFile[] {
  const name = options?.projectName || 'app'
  const template = SCAFFOLD_CATALOG[id] || SCAFFOLD_CATALOG['generic']
  if (!template || !template.files) return []

  return Object.entries(template.files).map(([filePath, content]) => ({
    path: filePath,
    content: content.replace(/\{\{PROJECT_NAME\}\}/g, name),
    description: `${template.name} - ${filePath}`,
  }))
}

/**
 * Automatically detects recommended scaffold template from a prompt, goal, or query.
 */
export function detectScaffoldType(goalOrQuery: string): string | null {
  const text = (goalOrQuery || '').toLowerCase()

  if (/\b(helm|helm-chart|chart\.yaml)\b/i.test(text)) return 'helm-chart'
  if (/\b(k8s|kubernetes|deployment\.yaml)\b/i.test(text)) return 'k8s-basic'
  if (/\b(monorepo|turbo(repo)?|workspaces)\b/i.test(text)) return 'monorepo-turbo'
  if (/\b(playwright|e2e|end-to-end)\b/i.test(text)) return 'playwright-e2e'
  if (/\b(fastapi|python\s+api|uvicorn|pydantic)\b/i.test(text)) return 'fastapi'
  if (/\b(go\s*api|golang|gin|net\/http)\b/i.test(text)) return 'go-api'
  if (/\b(next(\.?js)?|next-app|app\s+router)\b/i.test(text)) return 'next-app'
  if (/\b(graphql\s*resolver|graphql\s*schema)\b/i.test(text)) return 'graphql-schema'
  if (/\b(prisma|schema\.prisma)\b/i.test(text)) return 'prisma-schema'
  if (/\b(node\s*api|express(\s*api)?|rest\s*api|backend\s*api|ts\s*api)\b/i.test(text))
    return 'node-api'
  if (/\b(user\s*route|user\s*service|controller\s*service)\b/i.test(text)) return 'express-users'
  if (/\b(card\s*component|react\s*component|ui\s*component)\b/i.test(text))
    return 'react-component'
  if (/\b(useasync|hook|react\s*hook)\b/i.test(text)) return 'react-hook'
  if (/\b(docker-compose|compose\.ya?ml|postgres\s+redis)\b/i.test(text)) return 'docker-compose'
  if (/\b(github\s*action|github-ci|ci\.ya?ml|workflow)\b/i.test(text)) return 'github-ci'
  if (/\b(rate-limit(er)?)\b/i.test(text)) return 'rate-limiter'
  if (/\b(circuit-breaker)\b/i.test(text)) return 'circuit-breaker'
  if (/\b(queue|job\s*queue)\b/i.test(text)) return 'simple-queue'
  if (/\b(vitest|unit\s*test)\b/i.test(text)) return 'vitest-unit'
  if (/\b(scaffold|bootstrap|from\s+scratch|new\s+project|init(iali[sz]e)?|template)\b/i.test(text))
    return 'generic'

  return null
}

/**
 * Formats a clean markdown section detailing the scaffold template for build plans.
 */
export function formatScaffoldPlanSection(id: string, projectName: string = 'app'): string {
  const template = getScaffoldById(id) || SCAFFOLD_CATALOG['generic']
  if (!template) return ''

  const files = getScaffoldFiles(id, { projectName })
  const fileLines = files
    .map((f) => `- \`${f.path}\`: ${f.description || 'Scaffold file'}`)
    .join('\n')

  return `### Standard Project Scaffold (${template.name} — \`${template.id}\`)

> ${template.description}

**Files to scaffold (${files.length}):**
${fileLines}`
}
