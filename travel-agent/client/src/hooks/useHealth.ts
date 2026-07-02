import { useEffect, useState } from 'react';

interface HealthSources {
  anthropic: boolean;
  subscription: boolean;
  subscriptionTokenConfigured: boolean;
  [key: string]: boolean;
}

interface Health {
  ok: boolean;
  model: string;
  sources: HealthSources;
}

/** Fetch /api/health once so the UI can gate the subscription toggle. */
export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Health | null) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return health;
}
