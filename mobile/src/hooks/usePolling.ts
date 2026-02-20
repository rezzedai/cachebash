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

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const fetch = useCallback(async () => {
    if (!enabled) return;

    try {
      setError(null);
      const result = await fetcher();

      if (isMountedRef.current) {
        setData(result);
        setLastUpdated(new Date());
        setIsLoading(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setIsLoading(false);
      }
    }
  }, [fetcher, enabled]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetch();
  }, [fetch]);

  // Initial fetch on mount
  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) {
      fetch();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetch, enabled]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      fetch();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetch, interval, enabled]);

  return {
    data,
    error,
    isLoading,
    refetch,
    lastUpdated,
  };
}
