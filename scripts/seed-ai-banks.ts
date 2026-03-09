/**
 * Seed script: AI & Architecture question banks
 * Run: DATABASE_URL="..." npx tsx scripts/seed-ai-banks.ts
 *
 * Creates 3 new banks under a new "AI & Architecture" folder:
 *  - AI Orchestration & Agent Systems
 *  - MCP & Tool Architecture
 *  - System Design & Scalability
 */

import { PrismaClient, QuestionType } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_USER_ID = 'cmhnuilov0000ju04yxn0cmqz';

// The "AI & Architecture" folder created at end
const AI_FOLDER_COLOR = '#06b6d4';

const banks = [
  {
    title: 'AI Orchestration & Agent Systems',
    description: 'LLM orchestration, multi-agent pipelines, prompt engineering, evaluation, and production AI systems.',
    questions: [
      {
        text: 'What is an AI agent and how does it differ from a standard LLM API call?',
        hint: 'An agent has a control loop: it decides which tool to call, calls it, observes the result, then decides the next action — unlike a single stateless completion. Key properties: planning, tool use, memory, feedback loops.',
        type: QuestionType.TECHNICAL,
        tags: ['agents', 'LLMs', 'orchestration'],
      },
      {
        text: 'Explain the ReAct (Reasoning + Acting) pattern for LLM agents.',
        hint: 'Interleaves Thought → Action → Observation steps. The model reasons in scratchpad text before each tool call. Helps with multi-step problems. Key tradeoff: more tokens, but much better at decomposing tasks.',
        type: QuestionType.TECHNICAL,
        tags: ['agents', 'ReAct', 'prompting'],
      },
      {
        text: 'What are the main failure modes of multi-agent systems and how do you mitigate them?',
        hint: 'Hallucinated tool calls, infinite loops, context overflow, error propagation, non-determinism. Mitigations: max-step limits, structured output schemas, idempotent tools, retry budgets, human-in-the-loop checkpoints.',
        type: QuestionType.TECHNICAL,
        tags: ['agents', 'reliability', 'production'],
      },
      {
        text: 'How would you design a multi-agent pipeline where agents collaborate on a complex coding task?',
        hint: 'Consider roles: planner, coder, reviewer, test runner. Each agent has a focused context and tool set. Orchestrator routes tasks. Use shared state (e.g. file system, DB) as the communication layer. Think about parallelism vs sequential dependencies.',
        type: QuestionType.TECHNICAL,
        tags: ['multi-agent', 'architecture', 'coding'],
      },
      {
        text: 'What is RAG (Retrieval Augmented Generation) and when would you use it over fine-tuning?',
        hint: 'RAG retrieves relevant docs at inference time and injects them into context. Prefer RAG when: data changes frequently, you need citations, budget is limited, or you need interpretability. Fine-tune when: style/format matters, latency is critical, knowledge is stable.',
        type: QuestionType.TECHNICAL,
        tags: ['RAG', 'fine-tuning', 'LLMs'],
      },
      {
        text: 'How do you evaluate an LLM-powered feature in production?',
        hint: 'Layer evaluation: (1) unit evals with golden fixtures, (2) LLM-as-judge scoring, (3) A/B test with user metrics, (4) tracing with tools like Lunary or LangSmith. Key metrics: task completion, hallucination rate, latency p95, cost per call.',
        type: QuestionType.TECHNICAL,
        tags: ['evals', 'observability', 'production'],
      },
      {
        text: 'What is prompt injection and how do you defend against it in an agent system?',
        hint: 'Attacker embeds instructions in external data (web page, doc) that hijack the agent. Defences: strict system prompt with explicit boundary, never execute user content as system instructions, validate all tool outputs, separate trust levels for different data sources.',
        type: QuestionType.TECHNICAL,
        tags: ['security', 'agents', 'prompting'],
      },
      {
        text: 'How do you manage long-running context in an agent that needs to process thousands of tokens of history?',
        hint: 'Techniques: sliding window (keep recent N), summarisation (compress old turns), hierarchical memory (episodic + semantic stores), vector retrieval of relevant past context. Each has latency/accuracy tradeoffs.',
        type: QuestionType.TECHNICAL,
        tags: ['memory', 'context', 'agents'],
      },
      {
        text: 'Describe the role of structured outputs (e.g. JSON mode, tool calls) in production LLM systems.',
        hint: 'Structured outputs guarantee parseable responses, eliminating fragile regex parsing. Use tool/function calling for actions (web search, DB query). Use JSON schema for data extraction. Reduces hallucination in structured fields. Critical for agentic pipelines.',
        type: QuestionType.TECHNICAL,
        tags: ['structured-output', 'tool-use', 'reliability'],
      },
      {
        text: 'Walk me through how you would add observability and cost tracking to an AI feature.',
        hint: 'Instrument every LLM call: log model, tokens (input/output), latency, prompt hash, response, user ID, trace ID. Tools: Lunary, LangSmith, Helicone. Calculate cost from token usage × per-token price. Alert on p99 latency spikes and cost-per-session thresholds.',
        type: QuestionType.TECHNICAL,
        tags: ['observability', 'cost', 'production'],
      },
      {
        text: 'What is an orchestration framework (e.g. LangChain, LlamaIndex, Mastra) and when would you use one vs rolling your own?',
        hint: 'Frameworks provide abstractions for chains, agents, memory, tools, retrievers. Use them for rapid prototyping or standard patterns. Roll your own when: you need full control, framework adds too much magic/overhead, you need specific optimisations. Know the tradeoffs.',
        type: QuestionType.TECHNICAL,
        tags: ['frameworks', 'orchestration', 'architecture'],
      },
      {
        text: 'How do you handle rate limits and cost budgets when multiple users are hitting the same LLM API?',
        hint: 'Rate limit per user/tenant, use request queues, implement retry with exponential backoff + jitter. Cost: budget per user per day, track spend in DB, degrade gracefully (shorter context, cheaper model). Use model routing to cheaper models for simpler tasks.',
        type: QuestionType.TECHNICAL,
        tags: ['rate-limiting', 'cost', 'scalability'],
      },
      {
        text: 'What is the difference between zero-shot, few-shot, and chain-of-thought prompting?',
        hint: 'Zero-shot: task description only. Few-shot: include example input/output pairs. CoT: ask model to reason step-by-step before answering. CoT dramatically improves complex reasoning. Few-shot reduces ambiguity. Combine CoT + few-shot for best results on hard tasks.',
        type: QuestionType.TECHNICAL,
        tags: ['prompting', 'LLMs', 'techniques'],
      },
      {
        text: 'How would you build a feedback loop to continuously improve an AI feature post-launch?',
        hint: 'Collect implicit signals (thumbs up/down, re-runs, abandonment) + explicit (rating). Log inputs/outputs. Sample for human review. Build eval harness. Run new model/prompt candidates against regression set. Ship incrementally with A/B tests.',
        type: QuestionType.SCENARIO,
        tags: ['feedback', 'iteration', 'production'],
      },
      {
        text: 'What are the key considerations when choosing between different LLM providers (OpenAI, Anthropic, open-source)?',
        hint: 'Cost (per-token pricing), latency, context window, quality on your task, rate limits, data privacy/residency, fine-tuning support, reliability/uptime, API stability. Also: open-source lets you self-host for privacy + zero per-token cost at scale.',
        type: QuestionType.TECHNICAL,
        tags: ['LLMs', 'providers', 'architecture'],
      },
      {
        text: 'Describe how you built an AI-powered feature in a project you shipped.',
        hint: 'Walk through: the problem, the model/approach chosen, prompt design, evaluation, integration, monitoring. For iprep: audio transcription (Whisper → Deep Infra), LLM scoring (GPT → Llama), structured feedback generation, cost optimisation journey.',
        type: QuestionType.BEHAVIORAL,
        tags: ['experience', 'production', 'AI'],
      },
      {
        text: 'What is agentic RAG and how does it improve on naive RAG?',
        hint: 'Naive RAG: single retrieval step. Agentic RAG: agent decides when and what to retrieve, can issue multiple queries, re-rank, verify results, ask clarifying questions, or combine with other tools. Better for ambiguous queries or multi-hop reasoning.',
        type: QuestionType.TECHNICAL,
        tags: ['RAG', 'agents', 'advanced'],
      },
      {
        text: 'How do you prevent an LLM agent from taking irreversible destructive actions?',
        hint: 'Principle of least privilege for tools. Confirmation gates for destructive operations. Dry-run mode. Audit log every action. Human-in-the-loop for high-stakes decisions. Explicit "safe" vs "unsafe" tool categories in system prompt. Test with adversarial inputs.',
        type: QuestionType.TECHNICAL,
        tags: ['safety', 'agents', 'production'],
      },
      {
        text: 'What is speculative decoding and how does it reduce LLM latency?',
        hint: 'A small draft model predicts multiple tokens ahead; the large model verifies them in one forward pass. If correct, all tokens accepted at once — effectively parallelising sequential generation. 2-4x speedup for tasks where draft model predictions are accurate.',
        type: QuestionType.TECHNICAL,
        tags: ['performance', 'inference', 'LLMs'],
      },
      {
        text: 'How would you architect a system where multiple AI agents share state and coordinate work without colliding?',
        hint: 'Options: (1) central orchestrator assigns tasks, no direct agent-to-agent comms, (2) shared message queue (each agent picks up work items), (3) shared persistent state (DB/file system) with locking, (4) event-driven with pub/sub. Consider idempotency and rollback.',
        type: QuestionType.TECHNICAL,
        tags: ['multi-agent', 'coordination', 'architecture'],
      },
    ],
  },
  {
    title: 'MCP & Tool Architecture',
    description: 'Model Context Protocol, tool design, server architecture, and integrating AI with external systems.',
    questions: [
      {
        text: 'What is the Model Context Protocol (MCP) and what problem does it solve?',
        hint: 'MCP is an open protocol that standardises how AI models connect to external tools and data sources. Solves the N×M integration problem: instead of each AI app integrating each tool separately, MCP gives a common interface. Like LSP for AI tool use.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'protocol', 'architecture'],
      },
      {
        text: 'What are the main components of an MCP server?',
        hint: 'Transport (stdio or HTTP/SSE), request handlers (ListTools, CallTool, ListResources, ReadResource, ListPrompts), tool schemas (JSON Schema for inputs), server metadata. The SDK handles the wire protocol; you just implement the handlers.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'server', 'implementation'],
      },
      {
        text: 'What are the differences between stdio and HTTP/SSE transports in MCP?',
        hint: 'stdio: process spawned by client, communication via stdin/stdout. Simple, secure (no network), great for local tools. HTTP/SSE: client connects over network, events streamed via SSE. Enables remote tools, multi-client, deployable as microservice.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'transport', 'architecture'],
      },
      {
        text: 'How do you design good tool schemas for an MCP server?',
        hint: 'Be explicit: good descriptions (LLM reads these), precise types, sensible defaults, enum constraints where appropriate. Keep tools focused — one responsibility each. Avoid boolean hell (use enum instead). Name clearly: verb_noun pattern (get_user, create_post).',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'design', 'tools'],
      },
      {
        text: 'How would you add authentication to an MCP server used by a local AI client?',
        hint: 'For local/trusted clients: shared secret via env var checked in request handler (x-internal-key pattern). For remote: OAuth 2.0 or API key in HTTP headers. Never expose internal key in logs or error messages. Scope permissions to minimum needed.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'auth', 'security'],
      },
      {
        text: 'What is the difference between MCP Tools, Resources, and Prompts?',
        hint: 'Tools: callable functions with side effects (send email, query DB). Resources: read-only data sources (file contents, live metrics — like REST GET). Prompts: reusable prompt templates the client can inject. Tools are the most commonly used.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'concepts', 'design'],
      },
      {
        text: 'Walk me through how you built the iprep MCP server.',
        hint: 'What problem: checking study progress from Claude/Open WebUI without logging in. How: @modelcontextprotocol/sdk, 4 tools (progress, weak topics, recent sessions, review queue), auth via x-internal-key header bypass in Next.js, stdio transport, registered in ~/.claude.json.',
        type: QuestionType.BEHAVIORAL,
        tags: ['MCP', 'iprep', 'experience'],
      },
      {
        text: 'How do you handle errors gracefully in an MCP tool handler?',
        hint: 'Return structured error in content (not throw, which crashes the tool call). Always return { content: [{ type: "text", text: "Error: ..." }], isError: true }. Log the full error server-side. Give the AI enough context to retry with corrected params.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'error-handling', 'reliability'],
      },
      {
        text: 'What are the security implications of giving an AI model tool access to your production database?',
        hint: 'Prompt injection via DB content could trigger unintended queries. Principle of least privilege: read-only DB user for read tools. Parameterised queries only. Rate limit tool calls. Log all DB operations. Consider a separate read replica for AI tool access.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'security', 'database'],
      },
      {
        text: 'How would you make an MCP server that exposes your personal projects as structured data for AI assistants?',
        hint: 'Resources for read-only data (project status, metrics, task lists). Tools for write actions (create task, update status). Good descriptions so the AI knows when to use each. Auth to prevent public access. Could pull from Notion, GitHub, your own DB.',
        type: QuestionType.SCENARIO,
        tags: ['MCP', 'personal', 'design'],
      },
      {
        text: 'How does MCP compare to OpenAI function calling / Anthropic tool use?',
        hint: 'Function calling / tool use are model-side APIs for structured tool invocation within a single API call. MCP is a separate protocol for connecting AI applications to external services — client-server, transport-agnostic, works across any model. MCP servers can expose tools that any MCP-compatible client calls via tool use.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'tool-use', 'comparison'],
      },
      {
        text: 'What patterns would you follow to build a reliable MCP tool that calls an external API?',
        hint: 'Validate inputs first. Set explicit timeouts (never let AI hang indefinitely). Retry with backoff on transient errors. Return structured, informative errors. Cache idempotent responses where appropriate. Monitor latency — slow tools degrade agentic pipelines significantly.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'reliability', 'API'],
      },
      {
        text: 'How would you test an MCP server?',
        hint: 'Unit test each tool handler in isolation (mock the external deps). Integration test with MCP Inspector (official CLI tool). E2E test by connecting Claude Desktop or Open WebUI and exercising real workflows. Also test error paths: bad inputs, API failures, timeouts.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'testing', 'quality'],
      },
      {
        text: 'What does "context window management" mean for a client that aggregates many MCP tools?',
        hint: 'Each tool schema takes tokens. Many tools = large system context. Solutions: group tools by category (only load relevant set), lazy-load tool schemas, summarise tool descriptions. Also: tool responses should be concise — verbose responses fill context fast.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'context', 'performance'],
      },
      {
        text: 'How would you evolve an MCP server API without breaking existing clients?',
        hint: 'Add new tools freely (additive). For breaking changes to existing tools: version the tool name (get_user_v2) or add optional parameters with defaults. Document deprecation. Avoid removing tools — mark as deprecated in description instead.',
        type: QuestionType.TECHNICAL,
        tags: ['MCP', 'versioning', 'API-design'],
      },
    ],
  },
  {
    title: 'System Design & Scalability',
    description: 'Distributed systems, API design, caching, queues, and scaling web applications.',
    questions: [
      {
        text: 'Walk me through how you would design a URL shortener at scale.',
        hint: 'Key decisions: ID generation (base62 hash vs counter), storage (KV store for fast reads), redirect latency (CDN edge caching), analytics (async write to queue), abuse prevention (rate limiting). Handle 10k redirects/sec: cache in Redis/CDN, shard DB by ID prefix.',
        type: QuestionType.TECHNICAL,
        tags: ['system-design', 'scalability', 'classic'],
      },
      {
        text: 'When would you use a message queue vs a direct API call?',
        hint: 'Queue: async work, producer/consumer rate mismatch, retry logic, fan-out to multiple consumers, durability. Direct call: synchronous response needed, simple one-to-one, low latency requirement. E.g. email sending → queue. User auth check → direct.',
        type: QuestionType.TECHNICAL,
        tags: ['queues', 'architecture', 'async'],
      },
      {
        text: 'Explain the difference between horizontal and vertical scaling. When do you choose each?',
        hint: 'Vertical: bigger machine (more CPU/RAM). Simple but has ceiling and single point of failure. Horizontal: more machines, load-balanced. Requires stateless services or shared state layer. Prefer horizontal for web servers; vertical for DB (until sharding is needed).',
        type: QuestionType.TECHNICAL,
        tags: ['scaling', 'infrastructure', 'architecture'],
      },
      {
        text: 'What is the CAP theorem and how does it affect your database choice?',
        hint: 'You can only guarantee 2 of 3: Consistency, Availability, Partition tolerance. Partition tolerance is non-negotiable in distributed systems. So: CP (PostgreSQL, Zookeeper — strong consistency, may be unavailable) vs AP (Cassandra, DynamoDB — always available, eventually consistent).',
        type: QuestionType.TECHNICAL,
        tags: ['CAP', 'databases', 'distributed-systems'],
      },
      {
        text: 'How do you design an idempotent API endpoint?',
        hint: 'Same request, same result regardless of how many times called. Techniques: client-supplied idempotency key (UUID stored in DB), check-then-act with unique constraint, return cached response for same key. Critical for payments, retries, at-least-once delivery.',
        type: QuestionType.TECHNICAL,
        tags: ['API-design', 'idempotency', 'reliability'],
      },
      {
        text: 'What caching strategies do you know and when do you use each?',
        hint: 'Cache-aside (app checks cache, loads from DB on miss). Write-through (write to cache + DB together). Write-behind (cache, async flush). Read-through (cache handles DB). TTL vs event-based invalidation. CDN for static/semi-static content. Redis for session, rate limiting, hot data.',
        type: QuestionType.TECHNICAL,
        tags: ['caching', 'Redis', 'performance'],
      },
      {
        text: 'How would you design the data model for a social feed (e.g. Twitter-style)?',
        hint: 'Fan-out on write (pre-compute feeds) vs fan-out on read (aggregate at read time). Write: fast reads, storage heavy, stale for high-follower accounts. Read: always fresh, slow for users with many follows. Hybrid: fan-out on write for normal users, pull for celebrities.',
        type: QuestionType.TECHNICAL,
        tags: ['system-design', 'social', 'data-model'],
      },
      {
        text: 'What is the N+1 query problem and how do you fix it?',
        hint: 'Fetching a list then making one DB query per item = N+1 queries. Fix: eager loading (JOIN or include in ORM), batch loading (DataLoader pattern), or denormalisation. In Prisma: use `include` or `select` with nested queries. Monitor with query logs.',
        type: QuestionType.TECHNICAL,
        tags: ['database', 'performance', 'ORM'],
      },
      {
        text: 'How do you handle database migrations in production without downtime?',
        hint: 'Expand-contract pattern: (1) add new column nullable, (2) deploy code that writes both old + new, (3) backfill, (4) deploy code reading new column, (5) drop old column. Never add NOT NULL without default in a single migration. Blue/green deployments help.',
        type: QuestionType.TECHNICAL,
        tags: ['database', 'migrations', 'zero-downtime'],
      },
      {
        text: 'What is a rate limiter and how would you implement one for an API?',
        hint: 'Algorithms: fixed window (simple), sliding window (smoother), token bucket (bursty-friendly), leaky bucket (smooth output). Implementation: Redis with INCR + EXPIRE per key (user ID or IP). Return 429 with Retry-After header. Consider per-endpoint and per-tier limits.',
        type: QuestionType.TECHNICAL,
        tags: ['rate-limiting', 'API', 'Redis'],
      },
      {
        text: 'Explain how you would implement real-time features (e.g. live notifications) in a Next.js app.',
        hint: 'Options: WebSockets (bidirectional, stateful), SSE (server-sent events, unidirectional, simpler), polling (simplest but wasteful). In Next.js: SSE via Route Handler with ReadableStream. For scale: pub/sub via Redis to broadcast across multiple instances.',
        type: QuestionType.TECHNICAL,
        tags: ['realtime', 'Next.js', 'WebSockets'],
      },
      {
        text: 'What is eventual consistency and when is it acceptable in a system you design?',
        hint: 'Data replicas converge to same value given no new updates — but reads may be stale temporarily. Acceptable for: social feeds, analytics, search indexes, CDN cache, leaderboards. Not acceptable for: payments, inventory (overselling risk), auth tokens.',
        type: QuestionType.TECHNICAL,
        tags: ['consistency', 'distributed-systems', 'tradeoffs'],
      },
      {
        text: 'How would you design a system to process millions of audio files asynchronously?',
        hint: 'Upload to object storage (R2/S3). Publish job to queue (Redis Bull, SQS). Worker pool picks up jobs: download from storage, transcribe, store result, update DB status. Retry failed jobs with backoff. Monitor queue depth. Scale workers horizontally based on queue lag.',
        type: QuestionType.SCENARIO,
        tags: ['async', 'queues', 'media-processing'],
      },
      {
        text: 'What are the tradeoffs between REST, GraphQL, and tRPC for an API?',
        hint: 'REST: simple, cacheable, well-understood. GraphQL: flexible queries, reduces over-fetching, complex tooling, harder to cache. tRPC: type-safe RPC for TypeScript monorepos, no runtime overhead, no schema. Choose: REST for public APIs, tRPC for internal TypeScript, GraphQL when clients have very different data needs.',
        type: QuestionType.TECHNICAL,
        tags: ['API-design', 'REST', 'GraphQL', 'tRPC'],
      },
      {
        text: 'How would you monitor and alert on a production web application?',
        hint: 'Layers: infrastructure (CPU, memory, disk), application (error rate, latency p50/p95/p99, throughput), business (user signups, conversion, revenue). Tools: Vercel Analytics, Sentry (errors), Datadog/Grafana (infra). Alerts: error rate spike, p99 > threshold, queue backlog.',
        type: QuestionType.TECHNICAL,
        tags: ['monitoring', 'observability', 'production'],
      },
    ],
  },
];

async function main() {
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  console.log('Creating AI & Architecture banks...\n');

  const bankIds: string[] = [];

  for (const bank of banks) {
    const { questions, ...bankData } = bank;

    const created = await prisma.questionBank.create({
      data: {
        ...bankData,
        userId: ADMIN_USER_ID,
        questions: {
          create: questions.map((q, i) => ({
            text: q.text,
            hint: q.hint,
            type: q.type,
            tags: q.tags,
            difficulty: 3,
            order: i,
          })),
        },
      },
    });

    console.log(`✓ ${created.title} — ${questions.length} questions (${created.id})`);
    bankIds.push(created.id);
  }

  // Create "AI & Architecture" folder and add all three banks
  console.log('\nCreating AI & Architecture folder...');

  const folder = await prisma.bankFolder.create({
    data: {
      title: 'AI & Architecture',
      color: AI_FOLDER_COLOR,
      order: 5,
      userId: ADMIN_USER_ID,
      items: {
        create: bankIds.map((bankId, index) => ({
          bankId,
          order: index,
        })),
      },
    },
  });

  console.log(`✓ Folder created: ${folder.title} (${folder.id})`);
  console.log('\nDone!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
