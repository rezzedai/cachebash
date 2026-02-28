import type { Metadata } from 'next';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Memory SDK — CacheBash',
  description:
    'Persistent pattern storage for AI agents. Store learned patterns, recall insights across sessions, and build compound intelligence over time.',
};

const INSTALL_CODE = `npm install @rezzed.ai/memory`;

const BASIC_USAGE = `import { CacheBashMemory } from "@rezzed.ai/memory";

const memory = new CacheBashMemory({
  apiKey: "cb_your_key_here",
  programId: "my-agent",
});

// Store a learned pattern
await memory.store({
  id: "pattern-001",
  domain: "customer-support",
  pattern: "Users who mention billing in first message have 3x higher churn risk",
  confidence: 0.85,
  evidence: "Analyzed 500 support transcripts, 127 mentioned billing, 89 churned within 30 days",
});`;

const RECALL_CODE = `// Recall patterns by domain
const patterns = await memory.recall({
  domain: "customer-support",
});

// Search across all domains
const results = await memory.recall({
  search: "billing",
  minConfidence: 0.8,
  limit: 10,
});

// Check memory health
const health = await memory.health();
console.log(health.status);       // "healthy"
console.log(health.patternCount); // 42`;

const COMPOUND_CODE = `// Session 1: Store initial pattern
await memory.store({
  id: "ptn-churn-001",
  domain: "product-market-fit",
  pattern: "Billing friction causes churn even when product has PMF",
  confidence: 0.78,
  evidence: "User churned despite stating they liked the product",
});

// Session 2: Recall and reinforce
const prior = await memory.recall({ domain: "product-market-fit" });
// New evidence confirms pattern — update confidence
await memory.store({
  ...prior[0],
  confidence: 0.85,
  evidence: prior[0].evidence + " | Second user confirmed same pattern",
});

// Session 3: Cross-reference reveals sub-pattern
// Billing friction has multiple sources: UX, payment failures, pricing clarity`;

const RESPONSE_JSON = `[
  {
    "id": "pattern-001",
    "domain": "customer-support",
    "pattern": "Users who mention billing in first message have 3x higher churn risk",
    "confidence": 0.85,
    "evidence": "Analyzed 500 support transcripts...",
    "discoveredAt": "2026-02-28T10:15:00Z",
    "lastReinforced": "2026-02-28T10:15:00Z",
    "stale": false
  }
]`;

export default function MemoryPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>CacheBash</Link>
        <div className={styles.navLinks}>
          <Link href="/memory" className={styles.navActive}>Memory SDK</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.badge}>@rezzed.ai/memory</div>
        <h1 className={styles.heroTitle}>
          Persistent Memory for AI Agents
        </h1>
        <p className={styles.heroSubtitle}>
          Store learned patterns, recall insights across sessions, and build
          compound intelligence that grows with every interaction.
        </p>
        <div className={styles.heroCta}>
          <a
            href="https://www.npmjs.com/package/@rezzed.ai/memory"
            className={styles.btnPrimary}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get Started
          </a>
          <a href="#quickstart" className={styles.btnSecondary}>
            See the Code
          </a>
        </div>
        <div className={styles.installBox}>
          <code>npm install @rezzed.ai/memory</code>
        </div>
      </section>

      {/* How It Works */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How It Works</h2>
        <p className={styles.sectionSubtitle}>
          Three operations. No infrastructure to manage. Your agents start
          remembering in under five minutes.
        </p>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <h3 className={styles.stepTitle}>Store</h3>
            <p className={styles.stepDesc}>
              Your agent discovers a pattern during execution. Call{' '}
              <code>memory.store()</code> with the domain, pattern text,
              confidence score, and supporting evidence. The pattern persists
              across sessions in tenant-isolated Firestore storage.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <h3 className={styles.stepTitle}>Recall</h3>
            <p className={styles.stepDesc}>
              Before an agent starts work, call <code>memory.recall()</code>{' '}
              to retrieve relevant patterns. Filter by domain, search by
              keyword, or set a minimum confidence threshold. Recall latency is
              50-100ms.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>Compound</h3>
            <p className={styles.stepDesc}>
              As more sessions confirm or refute a pattern, confidence scores
              adjust. Stale patterns decay automatically. Over time, your
              agents build a knowledge graph of interconnected insights.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className={styles.section} id="quickstart">
        <h2 className={styles.sectionTitle}>Quick Start</h2>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Install</h3>
          <CodeBlock code={INSTALL_CODE} language="bash" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Store a Pattern</h3>
          <CodeBlock code={BASIC_USAGE} language="typescript" filename="agent.ts" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Recall Patterns</h3>
          <CodeBlock code={RECALL_CODE} language="typescript" filename="agent.ts" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Response Format</h3>
          <CodeBlock code={RESPONSE_JSON} language="json" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Compound Intelligence Across Sessions</h3>
          <p className={styles.codeDesc}>
            Each session builds on the last. Patterns are reinforced with new
            evidence, confidence scores adjust, and sub-patterns emerge.
          </p>
          <CodeBlock code={COMPOUND_CODE} language="typescript" filename="compound-example.ts" />
        </div>
      </section>

      {/* Features */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Built for Production</h2>
        <div className={styles.features}>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Tenant Isolation</h3>
            <p className={styles.featureDesc}>
              Every API key maps to an isolated tenant. No cross-tenant data
              leakage. Audit trail for all operations.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Automatic Decay</h3>
            <p className={styles.featureDesc}>
              Patterns that aren&apos;t reinforced are marked stale
              automatically. Your knowledge base stays current without manual
              pruning.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>50ms Recall</h3>
            <p className={styles.featureDesc}>
              Backed by Firestore with optimized indexes. Recall latency stays
              under 100ms even at thousands of stored patterns.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Zero Infrastructure</h3>
            <p className={styles.featureDesc}>
              Fully managed on Cloud Run. No databases to provision, no
              servers to maintain. Install the SDK and start storing.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Multi-Agent Ready</h3>
            <p className={styles.featureDesc}>
              Multiple agents can share a tenant&apos;s memory store. Each
              agent writes to its own program namespace while reading across
              all.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>TypeScript Native</h3>
            <p className={styles.featureDesc}>
              Full type definitions included. Strict mode compatible.
              Works with any TypeScript or JavaScript project.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.section} id="pricing">
        <h2 className={styles.sectionTitle}>Pricing</h2>
        <p className={styles.sectionSubtitle}>
          Start free. Scale when you need to.
        </p>
        <div className={styles.pricing}>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingTier}>Free</h3>
            <div className={styles.pricingPrice}>$0</div>
            <ul className={styles.pricingFeatures}>
              <li>100 stored patterns</li>
              <li>10 analyses per month</li>
              <li>3 sources per session</li>
              <li>Community support</li>
            </ul>
            <a
              href="https://www.npmjs.com/package/@rezzed.ai/memory"
              className={styles.pricingBtn}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get Started
            </a>
          </div>
          <div className={`${styles.pricingCard} ${styles.pricingHighlight}`}>
            <h3 className={styles.pricingTier}>Pro</h3>
            <div className={styles.pricingPrice}>
              $29<span className={styles.pricingPeriod}>/month</span>
            </div>
            <ul className={styles.pricingFeatures}>
              <li>1,000 stored patterns</li>
              <li>100 analyses per month</li>
              <li>10 sources per session</li>
              <li>Email support</li>
            </ul>
            <a href="mailto:dev@rezzed.ai" className={styles.pricingBtnPrimary}>
              Contact Us
            </a>
          </div>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingTier}>Enterprise</h3>
            <div className={styles.pricingPrice}>Custom</div>
            <ul className={styles.pricingFeatures}>
              <li>Unlimited patterns</li>
              <li>Unlimited analyses</li>
              <li>Unlimited sources</li>
              <li>Dedicated support + SLA</li>
            </ul>
            <a href="mailto:dev@rezzed.ai" className={styles.pricingBtnPrimary}>
              Contact Us
            </a>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>
          Give Your Agents Memory
        </h2>
        <p className={styles.finalCtaDesc}>
          Install the SDK, store your first pattern, and start building
          compound intelligence across sessions.
        </p>
        <div className={styles.installBox}>
          <code>npm install @rezzed.ai/memory</code>
        </div>
        <a
          href="https://www.npmjs.com/package/@rezzed.ai/memory"
          className={styles.btnPrimary}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on npm
        </a>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span className={styles.footerBrand}>CacheBash</span>
          <span className={styles.footerLinks}>
            <a href="mailto:dev@rezzed.ai">dev@rezzed.ai</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
