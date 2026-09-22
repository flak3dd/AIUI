import React from 'react'

export interface QuickStartHeroProps {
  onSelectPrompt: (prompt: string) => void
  sparkHost?: string
  sandboxOnline?: boolean
  mempalaceOnline?: boolean
}

interface PromptCard {
  id: string
  title: string
  description: string
  prompt: string
}

const PROMPT_CARDS: PromptCard[] = [
  {
    id: 'chat',
    title: 'Just chat',
    description: 'Ask anything — write, explain, or brainstorm.',
    prompt: 'Help me think through what I should work on next.',
  },
  {
    id: 'agent',
    title: 'Fix something',
    description: 'Agent mode: inspect, edit, run, and verify.',
    prompt:
      'Diagnose the local environment, run a quick health check, and fix anything broken you find.',
  },
  {
    id: 'build',
    title: 'Build a feature',
    description: 'Plan and implement with tests when Agent + Deep Build are on.',
    prompt:
      'Plan and build a small resilient Python utility with clear error handling and a basic test.',
  },
  {
    id: 'local',
    title: 'Use Spark local',
    description: 'Talk to your GX10 model and sandbox.',
    prompt: 'Confirm Spark is reachable, list models, and show a one-line system summary.',
  },
]

export const QuickStartHero: React.FC<QuickStartHeroProps> = ({
  onSelectPrompt,
  sparkHost = '192.168.4.103',
  sandboxOnline = true,
  mempalaceOnline = false,
}) => {
  return (
    <div className="quickstart-hero-container">
      <div className="hero-header-calm">
        <h1 className="hero-headline">What are we working on?</h1>
        <p className="hero-lead">
          Chat is the main stage. Tools, files, and mesh stay out of the way until you need them.
        </p>
      </div>

      <div className="hero-cards-grid hero-cards-grid-simple">
        {PROMPT_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="hero-action-card"
            onClick={() => onSelectPrompt(card.prompt)}
          >
            <div className="card-title">{card.title}</div>
            <div className="card-description">{card.description}</div>
          </button>
        ))}
      </div>

      <div className="hero-mesh-status-strip hero-mesh-calm">
        <span className="mesh-mini-name" title={sparkHost}>
          <span className="mesh-mini-dot online" /> Spark
        </span>
        <span className="mesh-mini-name">
          <span className={`mesh-mini-dot ${sandboxOnline ? 'online' : 'offline'}`} /> Sandbox
        </span>
        <span className="mesh-mini-name">
          <span className={`mesh-mini-dot ${mempalaceOnline ? 'online' : 'standby'}`} /> Memory
        </span>
      </div>

      <div className="hero-shortcuts-bar">
        <div className="shortcut-pill">
          <kbd>⌘K</kbd>
          <span>Commands</span>
        </div>
        <div className="shortcut-pill">
          <kbd>⌘B</kbd>
          <span>Chats</span>
        </div>
        <div className="shortcut-pill">
          <kbd>⌘N</kbd>
          <span>New</span>
        </div>
        <div className="shortcut-pill">
          <kbd>↵</kbd>
          <span>Send</span>
        </div>
      </div>
    </div>
  )
}
