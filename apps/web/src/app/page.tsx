import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.main}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>CacheBash</Link>
        <div className={styles.navLinks}>
          <Link href="/memory">Memory SDK</Link>
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
        <h1 className={styles.title}>
          Multi-Agent Coordination Platform
        </h1>
        <p className={styles.subtitle}>
          Infrastructure for AI agents that learn, coordinate, and operate
          autonomously. Built by{' '}
          <a
            href="https://rezzed.ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            Rezzed.ai
          </a>
          .
        </p>
        <div className={styles.cta}>
          <Link href="/memory" className={styles.ctaPrimary}>
            Explore Memory SDK
          </Link>
          <a
            href="https://github.com/rezzedai/cachebash"
            className={styles.ctaSecondary}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Products */}
      <section className={styles.products}>
        <div className={styles.productCard}>
          <h3 className={styles.productTitle}>Memory SDK</h3>
          <p className={styles.productDesc}>
            Persistent pattern storage for AI agents.
          </p>
          <Link href="/memory" className={styles.productLink}>
            Learn More &rarr;
          </Link>
        </div>
        <div className={styles.productCard}>
          <h3 className={styles.productTitle}>CLU</h3>
          <p className={styles.productDesc}>
            Multi-transcript intelligence analysis.
          </p>
          <span className={styles.productSoon}>Coming Soon</span>
        </div>
      </section>

      {/* Built by Rezzed.ai */}
      <section className={styles.builtBy}>
        <p className={styles.builtByText}>
          Built by{' '}
          <a
            href="https://rezzed.ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            Rezzed.ai
          </a>
          {' '}&mdash; engineering tools for the agentic era.
        </p>
        <a
          href="https://rezzed.ai"
          className={styles.ctaSecondary}
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit rezzed.ai &rarr;
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
