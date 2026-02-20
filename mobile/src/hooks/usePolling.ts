import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UsePollingOptions<T> {
  fetcher: (signal?: AbortSignal) => Promise<T>;
  interval?: number; // ms, default 10000 (10 seconds)
  enabled?: boolean; // default true
  cacheKey?: string; // AsyncStorage key for offline caching
}

interface UsePollingResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isInitialLoad: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  isCached: boolean; // true if data came from cache (not fresh fetch)
  refetch: () => Promise<void>;
  lastUpdated: Date | null;
}

export function usePolling<T>({
  fetcher,
  interval = 10000,
  enabled = true,
  cacheKey,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isCached, setIsCached] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const fetcherRef = useRef(fetcher);
  const abortControllerRef = useRef<AbortController | null>(null);
  const errorCountRef = useRef<number>(0);
  const currentIntervalRef = useRef<number>(interval);

  // Keep fetcher ref current without triggering effect re-runs
  fetcherRef.current = fetcher;

  // Calculate if data is stale (more than 30 seconds old)
  const isStale = lastUpdated ? Date.now() - lastUpdated.getTime() > 30000 : true;

  const doFetch = useCallback(async (isManualRefetch = false) => {
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (isManualRefetch) {
      setIsRefreshing(true);
    }

    try {
      const result = await fetcherRef.current(signal);
      if (isMountedRef.current && !signal.aborted) {
        setData(result);
        setError(null);
        setLastUpdated(new Date());
        setIsCached(false);

        // Write to cache asynchronously (don't await)
        if (cacheKey) {
          AsyncStorage.setItem(
            `polling_cache_${cacheKey}`,
            JSON.stringify({ data: result, timestamp: Date.now() })
          ).catch(() => {}); // Swallow cache write errors
        }

        setIsLoading(false);
        setIsInitialLoad(false);
        setIsRefreshing(false);

        // Reset error count and interval on success
        errorCountRef.current = 0;
        currentIntervalRef.current = interval;
      }
    } catch (err) {
      // Don't treat AbortError as a real error
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      if (isMountedRef.current && !signal.aborted) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setIsLoading(false);
        setIsInitialLoad(false);
        setIsRefreshing(false);

        // Exponential backoff on error
        errorCountRef.current += 1;
        const backoffInterval = Math.min(
          interval * Math.pow(2, errorCountRef.current),
          60000
        );
        currentIntervalRef.current = backoffInterval;

        // Restart interval with new backoff time
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(() => doFetch(false), backoffInterval);
        }
      }
    }
  }, [interval]);

  const refetch = useCallback(async () => {
    await doFetch(true);
  }, [doFetch]);

  // Load cached data on mount (before first fetch)
  useEffect(() => {
    if (!cacheKey) return;

    const loadCache = async () => {
      try {
        const cached = await AsyncStorage.getItem(`polling_cache_${cacheKey}`);
        if (cached && isMountedRef.current) {
          const { data: cachedData, timestamp } = JSON.parse(cached);
          // Only use cache if less than 5 minutes old
          if (Date.now() - timestamp < 300000) {
            setData(cachedData);
            setLastUpdated(new Date(timestamp));
            setIsCached(true);
            // Don't set isLoading=false here — let the real fetch do that
            // But do clear isInitialLoad so the UI shows cached data
            setIsInitialLoad(false);
          }
        }
      } catch (e) {
        // Cache read failure is non-fatal
      }
    };

    loadCache();
  }, [cacheKey]);

  // Initial fetch + polling interval
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      setIsLoading(false);
      setIsInitialLoad(false);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        isMountedRef.current = false;
      };
    }

    doFetch(false);

    intervalRef.current = setInterval(() => doFetch(false), interval);

    return () => {
      // Clear interval BEFORE setting isMountedRef = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Abort in-flight requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      isMountedRef.current = false;
    };
  }, [doFetch, interval, enabled]);

  // AppState listener for background/foreground handling
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background') {
        // Pause polling when app goes to background
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if (nextAppState === 'active') {
        // Resume polling when app comes to foreground
        // Do an immediate burst refetch, then resume normal interval
        doFetch(false);

        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(
          () => doFetch(false),
          currentIntervalRef.current
        );
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [doFetch]);

  return {
    data,
    error,
    isLoading, // Backwards compat: true during initial load or refresh
    isInitialLoad,
    isRefreshing,
    isStale,
    isCached,
    refetch,
    lastUpdated,
  };
}
