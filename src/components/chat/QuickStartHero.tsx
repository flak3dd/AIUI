import React from 'react'
import type { AssistMode } from '../../lib/providers'

export interface QuickStartHeroProps {
  onSelectPrompt: (prompt: string) => void
  onChooseMode?: (mode: AssistMode) => void
  assistMode?: AssistMode
  sparkHost?: string
  sandboxOnline?: boolean
  mempalaceOnline?: boolean
}

interface PromptCard {
  id: AssistMode
  title: string
  description: string
  prompt: string
}

const PROMPT_CARDS: PromptCard[] = [
  {
    id: 'chat',
    title: 'Talk',
    description: 'Think it through. Nothing runs.',
    prompt: 'Help me think this through before anything changes.',
  },
  {
    id: 'agent',
    title: 'Do it',
    description: 'Look, change, and check.',
    prompt: 'Look at the work, change what needs changing, and check the result.',
  },
  {
    id: 'deep',
    title: 'Build it',
    description: 'Plan, implement, and verify.',
    prompt: 'Plan the change, implement it, and verify it before you finish.',
  },
]

export const QuickStartHero: React.FC<QuickStartHeroProps> = ({
  onSelectPrompt,
  onChooseMode,
  assistMode,
}) => {
  return (
    <section className="quickstart-hero-container" aria-label="Start">
      <div className="hero-header-calm">
        <h1 className="hero-headline">What should happen?</h1>
        <p className="hero-lead">Choose a job first. The sentence lands in the box. Nothing is sent until you send it.</p>
      </div>

      <div className="hero-cards-grid hero-cards-grid-simple" role="group" aria-label="Job">
        {PROMPT_CARDS.map((card) => {
          const selected = assistMode === card.id
          return (
            <button
              key={card.id}
              type="button"
              className={`hero-action-card${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => {
                onChooseMode?.(card.id)
                onSelectPrompt(card.prompt)
              }}
            >
              <span className="card-title">{card.title}</span>
              <span className="card-description">{card.description}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
