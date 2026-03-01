'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '1rem' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Something went wrong</h1>
      <button onClick={reset} style={{ padding: '0.5rem 1.5rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
        Try again
      </button>
    </div>
  );
}
