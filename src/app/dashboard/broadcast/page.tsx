'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BroadcastRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/marketing?action=broadcast');
  }, [router]);

  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
    </div>
  );
}
