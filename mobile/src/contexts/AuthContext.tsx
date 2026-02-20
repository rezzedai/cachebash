import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  User,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import CacheBashAPI, { CacheBashAPIError } from '../services/api';

interface AuthState {
  user: User | null;
  api: CacheBashAPI | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    api: null,
    isLoading: true,
    isAuthenticated: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Set up Firebase auth state listener
  useEffect(() => {
    // Dev mode auto-login bypass using API key
    if (__DEV__) {
      const devKey = 'cb_7302ac94ee5c64c84903206d582c80ed0a8aa19b66b2cedd6ed30ffb9832637b';
      const api = new CacheBashAPI(devKey);
      setState({
        user: null,
        api,
        isLoading: false,
        isAuthenticated: true,
      });
      return;
    }

    // Listen for ID token changes (includes auth state + token refresh)
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try {
          // Get the Firebase ID token
          const idToken = await user.getIdToken();
          const api = new CacheBashAPI(idToken);

          setState({
            user,
            api,
            isLoading: false,
            isAuthenticated: true,
          });
        } catch (error) {
          console.error('Failed to get ID token:', error);
          setState({
            user: null,
            api: null,
            isLoading: false,
            isAuthenticated: false,
          });
        }
      } else {
        setState({
          user: null,
          api: null,
          isLoading: false,
          isAuthenticated: false,
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    setError(null);

    if (!email || email.trim() === '') {
      setError('Email cannot be empty');
      return false;
    }

    if (!password || password.trim() === '') {
      setError('Password cannot be empty');
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return true;
    } catch (error: any) {
      let errorMessage = 'Failed to sign in';

      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/user-disabled':
          errorMessage = 'This account has been disabled';
          break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          errorMessage = 'Invalid email or password';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many failed attempts. Try again later';
          break;
        default:
          errorMessage = error.message || 'Failed to sign in';
      }

      setError(errorMessage);
      setState({
        user: null,
        api: null,
        isLoading: false,
        isAuthenticated: false,
      });

      return false;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<boolean> => {
    setError(null);

    if (!email || email.trim() === '') {
      setError('Email cannot be empty');
      return false;
    }

    if (!password || password.trim() === '') {
      setError('Password cannot be empty');
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      return true;
    } catch (error: any) {
      let errorMessage = 'Failed to create account';

      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'Email already in use';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Email/password accounts are not enabled';
          break;
        case 'auth/weak-password':
          errorMessage = 'Password is too weak. Use at least 6 characters';
          break;
        default:
          errorMessage = error.message || 'Failed to create account';
      }

      setError(errorMessage);
      setState({
        user: null,
        api: null,
        isLoading: false,
        isAuthenticated: false,
      });

      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
    setError(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    setError(null);

    if (!email || email.trim() === '') {
      setError('Email cannot be empty');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error: any) {
      let errorMessage = 'Failed to send reset email';

      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email';
          break;
        default:
          errorMessage = error.message || 'Failed to send reset email';
      }

      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  const value: AuthContextType = {
    ...state,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
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
