import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import CacheBashAPI, { CacheBashAPIError } from '../services/api';

interface AuthState {
  apiKey: string | null;
  api: CacheBashAPI | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (apiKey: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  error: string | null;
}

const STORAGE_KEY = 'cachebash_api_key';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    apiKey: null,
    api: null,
    isLoading: true,
    isAuthenticated: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Load saved API key on mount
  useEffect(() => {
    const loadApiKey = async () => {
      try {
        const savedKey = await SecureStore.getItemAsync(STORAGE_KEY);
        if (savedKey) {
          const api = new CacheBashAPI(savedKey);

          // Validate the saved key
          try {
            await api.getFleetHealth();
            setState({
              apiKey: savedKey,
              api,
              isLoading: false,
              isAuthenticated: true,
            });
          } catch (validationError) {
            // Saved key is invalid, clear it
            await SecureStore.deleteItemAsync(STORAGE_KEY);
            setState({
              apiKey: null,
              api: null,
              isLoading: false,
              isAuthenticated: false,
            });
          }
        } else {
          setState({
            apiKey: null,
            api: null,
            isLoading: false,
            isAuthenticated: false,
          });
        }
      } catch (error) {
        console.error('Failed to load API key:', error);
        setState({
          apiKey: null,
          api: null,
          isLoading: false,
          isAuthenticated: false,
        });
      }
    };

    loadApiKey();
  }, []);

  const signIn = useCallback(async (apiKey: string): Promise<boolean> => {
    setError(null);

    if (!apiKey || apiKey.trim() === '') {
      setError('API key cannot be empty');
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const api = new CacheBashAPI(apiKey.trim());

      // Validate the API key by making a test call
      await api.getFleetHealth();

      // Key is valid, save it
      await SecureStore.setItemAsync(STORAGE_KEY, apiKey.trim());

      setState({
        apiKey: apiKey.trim(),
        api,
        isLoading: false,
        isAuthenticated: true,
      });

      return true;
    } catch (error) {
      let errorMessage = 'Failed to authenticate';

      if (error instanceof CacheBashAPIError) {
        if (error.code === 401 || error.code === 403) {
          errorMessage = 'Invalid API key';
        } else {
          errorMessage = error.message;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setError(errorMessage);
      setState({
        apiKey: null,
        api: null,
        isLoading: false,
        isAuthenticated: false,
      });

      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to delete API key:', error);
    }

    setState({
      apiKey: null,
      api: null,
      isLoading: false,
      isAuthenticated: false,
    });
    setError(null);
  }, []);

  const value: AuthContextType = {
    ...state,
    error,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
