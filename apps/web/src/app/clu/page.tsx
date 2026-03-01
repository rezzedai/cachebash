import type { Metadata } from 'next';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'CLU — Conversational Intelligence | CacheBash',
  description:
    'Ingest transcripts and documents. Extract patterns, surface opportunities, and generate structured reports through your MCP connection.',
};

const INGEST_CODE = `// Ingest a customer call transcript
const result = await cachebash.call("clu_ingest", {
  content: transcriptText,
  source_type: "transcript",
  metadata: {
    speakers: ["Alex (Customer)", "Jordan (Support)"],
    date: "2026-02-28",
    topic: "Billing dispute",
    tags: ["churn-risk", "billing"],
  },
});

console.log(result.session_id);   // "ses_a1b2c3"
console.log(result.token_count);  // 2847
console.log(result.status);       // "ready"`;

const ANALYZE_CODE = `// Run full analysis on the session
const analysis = await cachebash.call("clu_analyze", {
  session_id: "ses_a1b2c3",
  analysis_type: "full",
  confidence_threshold: 0.6,
});

// Structured output
console.log(analysis.patterns);
// [{ pattern: "Billing mentions in first 2 minutes correlate with churn",
//    confidence: 0.82, evidence: ["line 12", "line 45"] }]

console.log(analysis.opportunities);
// [{ opportunity: "Proactive billing review before renewal",
//    whyThisCouldFail: "Requires CRM integration", confidence: 0.71 }]

console.log(analysis.gaps);
// [{ gap: "No escalation path mentioned",
//    severity: "high", impact: "Customer left without resolution" }]`;

const REPORT_CODE = `// Generate an executive summary from the analysis
const report = await cachebash.call("clu_report", {
  analysis_id: analysis.analysis_id,
  report_type: "executive_summary",
  format: "markdown",
});

console.log(report.content);
// "## Executive Summary\\n\\nAnalysis of 1 transcript reveals..."`;

const RESPONSE_JSON = `{
  "analysis_id": "ana_x7y8z9",
  "session_id": "ses_a1b2c3",
  "patterns": [
    {
      "pattern": "Billing mentions in first 2 minutes correlate with churn",
      "confidence": 0.82,
      "evidence": ["line 12: 'I was charged twice'", "line 45: 'cancel my account'"]
    }
  ],
  "opportunities": [
    {
      "opportunity": "Proactive billing review before renewal",
      "whyThisCouldFail": "Requires CRM integration",
      "confidence": 0.71
    }
  ],
  "gaps": [
    {
      "gap": "No escalation path mentioned",
      "severity": "high",
      "impact": "Customer left without resolution"
    }
  ],
  "blind_spots": [
    {
      "blindSpot": "Agent sentiment not tracked",
      "reasoning": "No data on agent stress or fatigue indicators"
    }
  ],
  "summary": "High churn risk detected. Billing friction is primary driver."
}`;

export default function CluPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>CacheBash</Link>
        <div className={styles.navLinks}>
          <Link href="/overview">Overview</Link>
          <Link href="/memory">Memory SDK</Link>
          <Link href="/clu" className={styles.navActive}>CLU</Link>
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
        <div className={styles.badge}>@cachebash/clu</div>
        <h1 className={styles.heroTitle}>
          Conversational Intelligence for AI Agents
        </h1>
        <p className={styles.heroSubtitle}>
          Ingest transcripts, documents, and conversations. Extract patterns,
          surface opportunities, and generate structured reports — all through
          your agent&apos;s existing MCP connection.
        </p>
        <div className={styles.heroCta}>
          <a href="#quickstart" className={styles.btnPrimary}>
            Get Started
          </a>
          <a href="#quickstart" className={styles.btnSecondary}>
            See the Code
          </a>
        </div>
        <div className={styles.installBox}>
          <code>Already included in CacheBash MCP</code>
        </div>
      </section>

      {/* How It Works */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How It Works</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <h3 className={styles.stepTitle}>Ingest</h3>
            <p className={styles.stepDesc}>
              Feed your agent any text content — meeting transcripts, support
              conversations, product reviews, competitive analysis. Call{' '}
              <code>clu_ingest()</code> with the raw text, source type, and
              optional metadata like speakers and topics. Content is stored in
              tenant-isolated sessions, ready for analysis.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <h3 className={styles.stepTitle}>Analyze</h3>
            <p className={styles.stepDesc}>
              Run LLM-powered analysis on ingested content. Choose a focus:
              pattern detection, opportunity mapping, gap analysis, or full
              synthesis. Set confidence thresholds to filter noise. The analysis
              engine uses Claude Sonnet to extract structured insights —
              patterns with confidence scores, opportunities with failure risks,
              gaps with severity ratings.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>Report</h3>
            <p className={styles.stepDesc}>
              Generate formatted deliverables from analysis results. Output
              types include opportunity briefs, synthesis documents, PRDs, and
              executive summaries. Reports render as markdown or structured
              JSON — ready to feed into downstream workflows or present to
              stakeholders.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className={styles.section} id="quickstart">
        <h2 className={styles.sectionTitle}>Quick Start</h2>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Ingest a Transcript</h3>
          <CodeBlock code={INGEST_CODE} language="typescript" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Analyze for Patterns</h3>
          <CodeBlock code={ANALYZE_CODE} language="typescript" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Generate a Report</h3>
          <CodeBlock code={REPORT_CODE} language="typescript" />
        </div>

        <div className={styles.codeSection}>
          <h3 className={styles.codeLabel}>Analysis Response Format</h3>
          <CodeBlock code={RESPONSE_JSON} language="json" />
        </div>
      </section>

      {/* Features */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Built for Production</h2>
        <p className={styles.sectionSubtitle}>
          Enterprise-grade analysis infrastructure, not a wrapper around an LLM
          prompt.
        </p>
        <div className={styles.features}>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Tenant Isolation</h3>
            <p className={styles.featureDesc}>
              Every analysis session is scoped to your tenant. Content, analyses,
              and reports never cross boundaries. Firestore security rules
              enforce isolation at the database level.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Multi-Source Ingestion</h3>
            <p className={styles.featureDesc}>
              Transcripts, documents, URLs, or raw text. Tag content with
              speakers, dates, topics, and custom metadata. Ingest multiple
              sources into a single session for cross-reference analysis.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Confidence Scoring</h3>
            <p className={styles.featureDesc}>
              Every pattern and opportunity includes a confidence score (0-1).
              Set thresholds to filter noise. Confidence is calibrated against
              evidence density, not just LLM certainty.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Structured Output</h3>
            <p className={styles.featureDesc}>
              Patterns, opportunities, gaps, and blind spots returned as typed
              objects — not unstructured text. Feed results directly into
              downstream automations, dashboards, or agent memory.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>Multiple Report Types</h3>
            <p className={styles.featureDesc}>
              Generate opportunity briefs, synthesis documents, PRDs, or
              executive summaries from the same analysis. Markdown or JSON
              output.
            </p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>MCP Native</h3>
            <p className={styles.featureDesc}>
              No separate SDK or HTTP client needed. CLU runs through your
              existing CacheBash MCP connection. Same auth, same transport, same
              tooling.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>
          Turn conversations into intelligence
        </h2>
        <p className={styles.finalCtaDesc}>
          Three tool calls. Structured insights. No infrastructure to manage.
        </p>
        <a href="#quickstart" className={styles.btnPrimary}>
          Get Started
        </a>
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
