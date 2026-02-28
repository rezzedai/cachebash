import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.main}>
      <nav className={styles.nav}>
        <span className={styles.logo}>CacheBash</span>
        <div className={styles.navLinks}>
          <Link href="/memory">Memory SDK</Link>
        </div>
      </nav>
      <section className={styles.hero}>
        <h1 className={styles.title}>
          Multi-Agent Coordination Platform
        </h1>
        <p className={styles.subtitle}>
          Infrastructure for AI agents that learn, coordinate, and operate autonomously.
          Store patterns. Recall insights. Build compound intelligence.
        </p>
        <div className={styles.cta}>
          <Link href="/memory" className={styles.ctaPrimary}>
            Explore Memory SDK
          </Link>
          <a
            href="https://www.npmjs.com/package/@rezzed.ai/memory"
            className={styles.ctaSecondary}
            target="_blank"
            rel="noopener noreferrer"
          >
            npm install @rezzed.ai/memory
          </a>
        </div>
      </section>
    </main>
  );
}
