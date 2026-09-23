# Palace slug conventions

Stable names are the pathway. A room slug that appears in more than one wing is a tunnel. Do not invent near-synonyms.

## Wings

| Slug | Holds |
| --- | --- |
| `wing_agent_design` | This project's agent and response-workflow decisions |

People and other projects get their own `wing_<slug>` wings. One specialist agent owns one wing and one diary.

## Rooms

Use kebab-case idea names. Reuse the slug when the same idea shows up in another wing.

| Slug | Means |
| --- | --- |
| `response-workflow` | How a turn plans, retrieves, acts, reflects, and consolidates |
| `mempalace-integration` | How that loop uses MemPalace |

`auth-stuff` and `auth-migration` are different rooms. Pick one and keep it.

## Halls

| Slug | Edge |
| --- | --- |
| `hall_facts` | Decisions locked in |
| `hall_events` | Sessions, milestones, debugging |
| `hall_discoveries` | Insights and breakthroughs |
| `hall_preferences` | Habits, likes, style |
| `hall_advice` | Recommendations and solutions |

## Write shape

```
wing:   wing_agent_design
room:   response-workflow
hall:   hall_discoveries
drawer: verbatim user wording
kg:     (entity, relation, value, valid_from)
diary:  what was tried, what failed, which tunnel was used
```

Drawers keep the user's words. Summaries go in closets or the diary, not in place of the drawer.
