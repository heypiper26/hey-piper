import { useState, useEffect, useCallback, useRef } from 'react';

// 20s: generous for a cold-start serverless invocation + DB pool contention, but
// still bounded — without this, a hung request (e.g. Vercel cold start racing
// Supabase's pooler under a burst of simultaneous Dashboard requests) leaves the
// caller stuck on a loading skeleton forever with no feedback or way to retry.
const TIMEOUT_MS = 20000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tempo esgotado. Tente novamente.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      let result;
      try {
        result = await withTimeout(fetcher(), TIMEOUT_MS);
      } catch (first) {
        // One automatic retry: every useApi fetcher is an idempotent GET, and a
        // single failure is usually a cold-start/pooler hiccup that succeeds on
        // the second attempt (this is why the forecast chart sometimes "never
        // loads" — one of the burst of dashboard requests lost the race).
        if (mySeq !== seq.current) throw first;
        result = await withTimeout(fetcher(), TIMEOUT_MS);
      }
      if (mySeq === seq.current) setData(result);
    } catch (e) {
      if (mySeq === seq.current) setError(e.message);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, deps);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
