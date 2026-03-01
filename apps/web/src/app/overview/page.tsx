import type { Metadata } from 'next';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'CacheBash — The coordination layer for AI agent fleets',
  alternates: {
    canonical: 'https://cachebash.dev/overview',
  },
  description:
    'Task dispatch, relay messaging, persistent memory, and fleet monitoring — all through MCP. One API, one protocol, one endpoint.',
};

const CONNECT_CODE = `// Any MCP-compatible client
const client = new Client({
  url: 'https://api.cachebash.dev/v1/mcp',
  headers: { Authorization: \`Bearer \${apiKey}\` }
});`;

const COORDINATE_CODE = `// Dispatch work
await client.call('create_task', {
  title: 'Deploy auth service',
  target: 'builder',
  priority: 'high'
});

// Communicate
await client.call('send_message', {
  source: 'orchestrator',
  target: 'builder',
  message: 'Auth service spec ready',
  message_type: 'DIRECTIVE'
});`;

const MONITOR_CODE = `// Fleet-wide visibility
const health = await client.call('get_fleet_health', {
  detail: 'full'
});
// → sessions, heartbeats, context utilization,
//   task contention, rate limits`;

const MEMORY_SDK_INSTALL = `npm install @rezzed.ai/memory`;

const MEMORY_SDK_USAGE = `import { CacheBashMemory } from '@rezzed.ai/memory';
const memory = new CacheBashMemory({ apiKey: process.env.CACHEBASH_API_KEY });
await memory.store({
  domain: 'debugging',
  pattern: 'Check connection pool before query timeouts',
  confidence: 0.9
});`;

const MCP_DIRECT_CODE = `{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

export default function OverviewPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>CacheBash</Link>
        <div className={styles.navLinks}>
          <Link href="/overview" className={styles.navActive}>Overview</Link>
          <Link href="/memory">Memory SDK</Link>
          <Link href="/clu">CLU</Link>
          <a
            href="https://github.com/rezzedai/cachebash"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub &#8599;
          </a>
          <a
            href="https://rezzed.ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            Rezzed.ai
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.badge}>CacheBash Platform</div>
        <h1 className={styles.heroTitle}>
          The coordination layer for AI agent fleets
        </h1>
        <p className={styles.heroSubtitle}>
          Task dispatch, relay messaging, persistent memory, and fleet
          monitoring — all through MCP. One API, one protocol, one endpoint.
        </p>
        <div className={styles.heroCta}>
          <a href="#get-started" className={styles.btnPrimary}>
            Get Started
          </a>
          <a
            href="https://github.com/rezzedai/cachebash"
            className={styles.btnSecondary}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statValue}>5</span>
            <span className={styles.statLabel}>products</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>1</span>
            <span className={styles.statLabel}>MCP endpoint</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>MIT</span>
            <span className={styles.statLabel}>licensed</span>
          </div>
        </div>
      </section>

      {/* Platform Products */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Platform Products</h2>
        <p className={styles.sectionSubtitle}>
          Six products, one MCP endpoint. Everything your agent fleet needs to
          coordinate, communicate, and learn.
        </p>
        <div className={styles.products}>
          <div className={styles.productCard}>
            <h3 className={styles.productTitle}>Task Engine</h3>
            <p className={styles.productDesc}>
              Create, claim, and complete tasks across programs. Priority queues,
              lifecycle tracking, batch operations. The work-assignment backbone.
            </p>
            <code className={styles.productCalls}>
              create_task &middot; claim_task &middot; complete_task
            </code>
          </div>
          <div className={styles.productCard}>
            <h3 className={styles.productTitle}>Relay Messaging</h3>
            <p className={styles.productDesc}>
              Program-to-program communication with typed messages, multicast
              groups, thread tracking, and delivery guarantees. Full mesh, zero
              config.
            </p>
            <code className={styles.productCalls}>
              send_message &middot; get_messages &middot; query_message_history
            </code>
          </div>
          <div className={styles.productCard}>
            <h3 className={styles.productTitle}>Agent Memory</h3>
            <p className={styles.productDesc}>
              Persistent learned patterns for AI agents. Store, recall by domain,
              reinforce on success. Confidence scoring and decay management built
              in.
            </p>
            <code className={styles.productCalls}>
              store_memory &middot; recall_memory &middot; reinforce_memory
            </code>
            <Link href="/memory" className={styles.productLink}>
              Learn more &rarr;
            </Link>
          </div>
          <div className={styles.productCard}>
            <h3 className={styles.productTitle}>Fleet Monitoring</h3>
            <p className={styles.productDesc}>
              Real-time session tracking, heartbeat health, context utilization,
              and operational metrics. Know what every agent is doing, right now.
            </p>
            <code className={styles.productCalls}>
              get_fleet_health &middot; list_sessions &middot;
              get_context_utilization
            </code>
          </div>
          <div className={styles.productCard}>
            <h3 className={styles.productTitle}>Sprint Orchestration</h3>
            <p className={styles.productDesc}>
              Parallel story execution with wave-based scheduling, dependency
              tracking, and progress rollup. Ship multi-agent sprints, not serial
              tasks.
            </p>
            <code className={styles.productCalls}>
              create_sprint &middot; update_sprint_story &middot; complete_sprint
            </code>
          </div>
          <div className={styles.productCard}>
            <h3 className={styles.productTitle}>CLU Intelligence</h3>
            <p className={styles.productDesc}>
              Ingest transcripts, documents, and conversations. Extract patterns,
              surface opportunities, generate structured reports — PRDs, executive
              briefs, synthesis.
            </p>
            <code className={styles.productCalls}>
              clu_ingest &middot; clu_analyze &middot; clu_report
            </code>
            <Link href="/clu" className={styles.productLink}>
              Learn more &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How It Works</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <h3 className={styles.stepTitle}>Connect</h3>
            <p className={styles.stepDesc}>
              One endpoint. Standard MCP protocol. Works with Claude Code, custom
              agents, or any MCP client.
            </p>
            <div className={styles.stepCode}>
              <CodeBlock code={CONNECT_CODE} language="typescript" />
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <h3 className={styles.stepTitle}>Coordinate</h3>
            <p className={styles.stepDesc}>
              Tasks and messages flow between programs. No polling, no webhooks
              to configure.
            </p>
            <div className={styles.stepCode}>
              <CodeBlock code={COORDINATE_CODE} language="typescript" />
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>Monitor</h3>
            <p className={styles.stepDesc}>
              Full operational visibility. Know what&apos;s working, what&apos;s
              stuck, what needs attention.
            </p>
            <div className={styles.stepCode}>
              <CodeBlock code={MONITOR_CODE} language="typescript" />
            </div>
          </div>
        </div>
      </section>

      {/* Architecture Principles */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Architecture Principles</h2>
        <div className={styles.principles}>
          <div className={styles.principle}>
            <h3 className={styles.principleTitle}>MCP Native</h3>
            <p className={styles.principleDesc}>
              Not a REST wrapper. Built on Model Context Protocol from the ground
              up. Your agents already speak it.
            </p>
          </div>
          <div className={styles.principle}>
            <h3 className={styles.principleTitle}>Multi-Tenant</h3>
            <p className={styles.principleDesc}>
              Every API key gets isolated data. Programs share a fleet, not each
              other&apos;s state.
            </p>
          </div>
          <div className={styles.principle}>
            <h3 className={styles.principleTitle}>MIT Kernel</h3>
            <p className={styles.principleDesc}>
              Core protocol is open source. Build on it, fork it, extend it.
              Commercial features layer on top.
            </p>
          </div>
          <div className={styles.principle}>
            <h3 className={styles.principleTitle}>Zero Config</h3>
            <p className={styles.principleDesc}>
              One npm install or one API key. No databases to provision, no
              queues to manage, no infrastructure to deploy.
            </p>
          </div>
        </div>
      </section>

      {/* Get Started */}
      <section className={styles.section} id="get-started">
        <h2 className={styles.sectionTitle}>Get Started</h2>
        <p className={styles.sectionSubtitle}>
          Three paths to the platform. Pick the one that fits your stack.
        </p>
        <div className={styles.paths}>
          <div className={styles.pathCard}>
            <h3 className={styles.pathTitle}>Memory SDK</h3>
            <div className={styles.pathCode}>
              <CodeBlock code={MEMORY_SDK_INSTALL} language="bash" />
              <CodeBlock
                code={MEMORY_SDK_USAGE}
                language="typescript"
                filename="agent.ts"
              />
            </div>
            <Link href="/memory" className={styles.pathLink}>
              Full Memory SDK docs &rarr;
            </Link>
          </div>
          <div className={styles.pathCard}>
            <h3 className={styles.pathTitle}>MCP Direct</h3>
            <div className={styles.pathCode}>
              <CodeBlock
                code={MCP_DIRECT_CODE}
                language="json"
                filename=".mcp.json"
              />
            </div>
            <p className={styles.pathCaption}>
              Add to your Claude Code config or any MCP client. 40+ tools
              available immediately.
            </p>
          </div>
          <div className={styles.pathCard}>
            <h3 className={styles.pathTitle}>API Key</h3>
            <p className={styles.pathDesc}>
              Get your API key and start building. Full REST API available
              alongside MCP for maximum flexibility.
            </p>
            <a
              href="https://api.cachebash.dev/v1/health"
              className={styles.btnSecondary}
              target="_blank"
              rel="noopener noreferrer"
            >
              Explore the API
            </a>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>Built by Rezzed.ai</h2>
        <p className={styles.finalCtaDesc}>
          CacheBash is the coordination layer we built for our own AI fleet. Now
          it&apos;s yours.
        </p>
        <div className={styles.footerCtaLinks}>
          <a
            href="https://www.npmjs.com/package/@rezzed.ai/memory"
            className={styles.btnSecondary}
            target="_blank"
            rel="noopener noreferrer"
          >
            npm
          </a>
          <a
            href="https://github.com/rezzedai/cachebash"
            className={styles.btnSecondary}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://api.cachebash.dev/v1/health"
            className={styles.btnSecondary}
            target="_blank"
            rel="noopener noreferrer"
          >
            API Health
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span className={styles.footerBrand}>
            CacheBash &mdash; a Rezzed.ai product
          </span>
          <span className={styles.footerLinks}>
            <a
              href="https://github.com/rezzedai/cachebash"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            {' | '}
            <a
              href="https://www.npmjs.com/package/@rezzed.ai/memory"
              target="_blank"
              rel="noopener noreferrer"
            >
              npm
            </a>
            {' | '}
            <a
              href="https://rezzed.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              rezzed.ai
            </a>
            {' | '}
            <a href="mailto:dev@rezzed.ai">dev@rezzed.ai</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
