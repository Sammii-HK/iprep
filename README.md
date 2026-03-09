# iPrep

AI-powered spoken interview practice platform. Record answers, get automatic transcription, and receive multi-dimensional scoring on delivery and content quality.

## Features

- **Voice recording** via Web Audio API + MediaRecorder
- **Transcription** via Deep Infra Whisper (`openai/whisper-large-v3-turbo`)
- **Multi-dimensional scoring** via Deep Infra Llama (`meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo`)
  - Delivery: WPM, filler words, confidence, intonation
  - Content: STAR methodology (behavioural/scenario only), clarity, impact, structure
- **Spaced repetition (SM-2)** — review queue of questions due for practice
- **Study tracking** — streak, daily goal, interview countdown, daily quota
- **Question banks** with role-focused folders (Full Stack, Frontend, Leadership, AI & Architecture, etc.)
- **Quiz mode** for rapid-fire question review
- **MCP server** — check study progress from Claude or Open WebUI

## Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Prisma + Neon PostgreSQL
- **Auth**: JWT (HttpOnly cookie)
- **AI**: Deep Infra (Whisper + Llama 3.3 70B) — falls back to OpenAI if `DEEPINFRA_API_KEY` is not set
- **Hosting**: Vercel

## Environment Variables

```env
# Required
JWT_SECRET=                    # Secret for JWT signing
ADMIN_EMAIL=                   # Email of the admin user

# Database
DATABASE_URL=                  # Neon PostgreSQL pooled connection string
DATABASE_URL_UNPOOLED=         # Neon PostgreSQL direct connection string

# AI — Deep Infra (preferred, ~13x cheaper than OpenAI for Whisper)
DEEPINFRA_API_KEY=             # Deep Infra API key

# AI — OpenAI (fallback if Deep Infra key is not set)
OPENAI_API_KEY=                # OpenAI API key

# MCP server auth — never expose publicly
IPREP_INTERNAL_KEY=            # Shared secret for MCP server bypass

# Optional
NODE_ENV=development
ENABLE_LIVE_CAPTIONS=true
MAX_AUDIO_SIZE_MB=50
```

## Getting Started

```bash
pnpm install
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Run migrations
pnpm dev
```

## MCP Server

The companion MCP server at `../iprep-mcp/` exposes 4 tools for AI assistants:

| Tool | Description |
|------|-------------|
| `get_study_progress` | Streak, daily goal, interview countdown, review due count |
| `get_weak_topics` | Aggregated weak/strong tags from all sessions |
| `get_recent_performance` | Recent sessions and score trends |
| `get_review_queue` | Questions due for spaced-repetition review today |

```bash
cd ../iprep-mcp
pnpm build
# Register in ~/.claude.json with IPREP_BASE_URL and IPREP_INTERNAL_KEY
```

## AI Model Notes

| Task | Model | Provider |
|------|-------|----------|
| Transcription | `openai/whisper-large-v3-turbo` | Deep Infra |
| Answer scoring | `meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo` | Deep Infra |
| Fallback (both) | `whisper-1` / `gpt-4o-mini` | OpenAI |

The app auto-detects which key is available and routes accordingly.
