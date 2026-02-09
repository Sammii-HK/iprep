export interface TemplateQuestion {
  text: string;
  hint?: string;
  tags: string[];
  difficulty: number;
  type: string;
}

export interface QuestionBankTemplate {
  id: string;
  title: string;
  description: string;
  questions: TemplateQuestion[];
}

export const QUESTION_BANK_TEMPLATES: QuestionBankTemplate[] = [
  {
    id: "behavioral-50",
    title: "Top 50 Behavioral Interview Questions",
    description: "Common behavioral questions covering leadership, teamwork, conflict resolution, and problem-solving.",
    questions: [
      { text: "Tell me about a time you led a team through a difficult project.", hint: "Use STAR: Describe the situation, your specific role as leader, actions you took to guide the team, and measurable results. Include team size and project impact.", tags: ["leadership", "teamwork"], difficulty: 3, type: "BEHAVIORAL" },
      { text: "Describe a situation where you had to deal with a difficult coworker.", hint: "Focus on: the specific conflict, how you approached the conversation, what resolution was reached, and what you learned about working with different personalities.", tags: ["conflict", "communication"], difficulty: 3, type: "BEHAVIORAL" },
      { text: "Give me an example of a time you failed and what you learned.", hint: "Be honest about the failure. Describe what went wrong, why, what you learned, and how you applied that lesson to future situations. Show growth mindset.", tags: ["resilience", "growth"], difficulty: 3, type: "BEHAVIORAL" },
      { text: "Tell me about a time you had to make a decision with incomplete information.", hint: "Describe the situation, what information was missing, how you assessed risks, the decision framework you used, and the outcome.", tags: ["decision-making"], difficulty: 4, type: "BEHAVIORAL" },
      { text: "Describe a project where you had to prioritize competing demands.", hint: "Explain the competing priorities, your prioritization framework (urgency vs importance), how you communicated tradeoffs to stakeholders, and the results.", tags: ["prioritization", "time-management"], difficulty: 3, type: "BEHAVIORAL" },
      { text: "Tell me about a time you went above and beyond for a customer or user.", hint: "Describe who the customer was, what their need was, what extra effort you put in beyond your role, and the impact it had.", tags: ["customer-focus"], difficulty: 2, type: "BEHAVIORAL" },
      { text: "Give an example of when you had to adapt to a significant change at work.", hint: "Describe the change, your initial reaction, how you adapted your approach, and what the outcome was. Show flexibility.", tags: ["adaptability"], difficulty: 3, type: "BEHAVIORAL" },
      { text: "Tell me about a time you mentored or coached someone.", hint: "Describe who you mentored, what they needed help with, your approach to teaching/coaching, and the improvement they showed.", tags: ["leadership", "mentoring"], difficulty: 3, type: "BEHAVIORAL" },
      { text: "Describe a situation where you had to influence others without authority.", hint: "Explain who you needed to influence, why you lacked formal authority, what persuasion techniques you used, and the result.", tags: ["influence", "leadership"], difficulty: 4, type: "BEHAVIORAL" },
      { text: "Tell me about a time you identified and solved a problem before it became critical.", hint: "Describe how you noticed the problem early, what analysis you did, the proactive steps you took, and the impact of early intervention.", tags: ["problem-solving", "proactive"], difficulty: 3, type: "BEHAVIORAL" },
    ],
  },
  {
    id: "system-design",
    title: "Technical System Design Questions",
    description: "System design and architecture questions for engineering interviews.",
    questions: [
      { text: "How would you design a URL shortener like bit.ly?", hint: "Key components: hashing/encoding algorithm, database schema (short_code, original_url, created_at), redirect service, analytics tracking. Consider: collision handling, custom URLs, expiration, rate limiting, caching with Redis, and horizontal scaling.", tags: ["system-design", "web"], difficulty: 3, type: "TECHNICAL" },
      { text: "Design a real-time chat application.", hint: "Key decisions: WebSocket vs SSE vs long polling, message storage (SQL vs NoSQL), presence tracking, message delivery guarantees (at-least-once), group chats, read receipts. Consider: connection management, horizontal scaling with pub/sub, offline message queue.", tags: ["system-design", "real-time"], difficulty: 4, type: "TECHNICAL" },
      { text: "How would you design a rate limiter?", hint: "Algorithms: token bucket, sliding window, fixed window. Storage: Redis for distributed rate limiting. Consider: per-user vs per-IP vs per-API-key, different limits for different endpoints, burst handling, distributed consistency.", tags: ["system-design", "infrastructure"], difficulty: 3, type: "TECHNICAL" },
      { text: "Design a notification system that supports email, SMS, and push notifications.", hint: "Architecture: notification service, template engine, delivery channels (email/SMS/push adapters), preference management, retry logic. Consider: priority levels, batching, rate limiting per channel, delivery tracking, unsubscribe handling.", tags: ["system-design", "distributed"], difficulty: 4, type: "TECHNICAL" },
      { text: "How would you design a file storage service like Dropbox?", hint: "Key components: file chunking, deduplication, metadata service, sync protocol, conflict resolution. Consider: chunk-level sync (delta sync), compression, CDN for distribution, versioning, sharing permissions, encryption at rest.", tags: ["system-design", "storage"], difficulty: 5, type: "TECHNICAL" },
      { text: "What is the CAP theorem and how does it apply to distributed databases?", hint: "CAP: Consistency, Availability, Partition tolerance - can only guarantee 2 of 3. CP systems (e.g., HBase, MongoDB): strong consistency, may be unavailable during partitions. AP systems (e.g., Cassandra, DynamoDB): always available, eventually consistent. Real-world: partitions are inevitable, so the real choice is between C and A.", tags: ["databases", "distributed-systems"], difficulty: 3, type: "DEFINITION" },
      { text: "Explain the difference between horizontal and vertical scaling.", hint: "Vertical scaling: adding more resources (CPU, RAM) to existing server. Horizontal scaling: adding more servers. Vertical is simpler but has limits. Horizontal requires: load balancing, data partitioning, stateless services, session management. Most production systems use horizontal scaling.", tags: ["scalability", "infrastructure"], difficulty: 2, type: "DEFINITION" },
    ],
  },
  {
    id: "investor-qa",
    title: "Investor Q&A for Startups",
    description: "Common questions investors ask during pitch meetings and due diligence.",
    questions: [
      { text: "What problem are you solving and for whom?", hint: "State the problem in one sentence. Quantify the pain point (time wasted, money lost, inefficiency). Define your target customer precisely. Use a specific example or story.", tags: ["pitch", "problem"], difficulty: 2, type: "PITCH" },
      { text: "What is your unique competitive advantage?", hint: "Explain what you do differently (not just better). Address: proprietary technology, network effects, data moat, team expertise, or unique market insight. Explain why this advantage is defensible and hard to replicate.", tags: ["pitch", "competition"], difficulty: 3, type: "PITCH" },
      { text: "What is your business model and how do you make money?", hint: "Clearly state: who pays, how much, how often (subscription, transaction, freemium). Include current revenue/ARR if applicable. Show unit economics: CAC, LTV, gross margin. Explain pricing strategy rationale.", tags: ["pitch", "business-model"], difficulty: 3, type: "PITCH" },
      { text: "What are your key metrics and how are they trending?", hint: "Share 3-5 key metrics: MRR/ARR, user growth rate, retention/churn, engagement metrics. Show month-over-month or year-over-year trends. Highlight inflection points. Be honest about metrics that need improvement.", tags: ["pitch", "metrics"], difficulty: 3, type: "PITCH" },
      { text: "How will you use this funding?", hint: "Break down by category: engineering (X%), sales/marketing (Y%), operations (Z%). Explain what milestones this funding will help you reach. Be specific about timeline (12-18 months). Show how this leads to the next funding round or profitability.", tags: ["pitch", "fundraising"], difficulty: 3, type: "PITCH" },
      { text: "What is your go-to-market strategy?", hint: "Describe your customer acquisition channels. Explain your sales motion (self-serve, inside sales, enterprise). Share current CAC and target. Describe launch strategy for new markets. Include partnerships or distribution advantages.", tags: ["pitch", "go-to-market"], difficulty: 4, type: "PITCH" },
      { text: "Who is on your team and why are you the right people to build this?", hint: "Highlight relevant domain expertise, previous exits or successes, technical capabilities, and complementary skills. Address any gaps in the team and your plan to fill them.", tags: ["pitch", "team"], difficulty: 2, type: "PITCH" },
      { text: "What keeps you up at night about this business?", hint: "Be honest and self-aware. Mention 1-2 real risks (market risk, execution risk, regulatory). For each risk, explain your mitigation strategy. Shows investor maturity and strategic thinking.", tags: ["pitch", "risk"], difficulty: 4, type: "PITCH" },
    ],
  },
];
