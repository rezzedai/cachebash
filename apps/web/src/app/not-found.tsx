import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '1rem' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>404</h1>
      <p style={{ color: '#a0a0b8' }}>Page not found.</p>
      <Link href="/" style={{ color: '#6366f1' }}>Return home</Link>
    </div>
  );
}
