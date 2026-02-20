import { useState, useEffect, useCallback, useRef } from 'react';

interface UsePollingOptions<T> {
  fetcher: () => Promise<T>;
  interval?: number; // ms, default 10000 (10 seconds)
  enabled?: boolean; // default true
}

interface UsePollingResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
  lastUpdated: Date | null;
}

export function usePolling<T>({
  fetcher,
  interval = 10000,
  enabled = true,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const fetcherRef = useRef(fetcher);

  // Keep fetcher ref current without triggering effect re-runs
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      if (isMountedRef.current) {
        setData(result);
        setError(null);
        setLastUpdated(new Date());
        setIsLoading(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setIsLoading(false);
      }
    }
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await doFetch();
  }, [doFetch]);

  // Initial fetch + polling interval
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      setIsLoading(false);
      return () => { isMountedRef.current = false; };
    }

    doFetch();

    intervalRef.current = setInterval(doFetch, interval);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [doFetch, interval, enabled]);

  return {
    data,
    error,
    isLoading,
    refetch,
    lastUpdated,
  };
}
