'use client';
import { useParams, redirect } from 'next/navigation';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PassPage() {
  const { id } = useParams();
  const router = useRouter();

  useEffect(() => {
    // Redirect to the trip page — the Pass tab lives there
    router.replace(`/trips/${id}`);
  }, [id, router]);

  return null;
}
