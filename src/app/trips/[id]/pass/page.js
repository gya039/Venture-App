'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TopNav from '@/components/TopNav';

export default function PassPage() {
  const { id } = useParams();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <TopNav />
      <div style={{ flex: 1, padding: '40px 48px' }}>
        <Link href={`/trips/${id}`} style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 24 }}>← Back to trip</Link>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>Day Pass Calculator</h1>
        <p style={{ color: 'var(--text-muted)' }}>Available on the trip detail page under the Pass tab.</p>
      </div>
    </div>
  );
}
