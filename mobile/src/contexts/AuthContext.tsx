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
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithCredential,
  User,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import CacheBashAPI, { CacheBashAPIError } from '../services/api';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  user: User | null;
  api: CacheBashAPI | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signInWithGitHub: () => Promise<boolean>;
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

  // OAuth configuration
  const googleRedirectUri = 'com.googleusercontent.apps.922749444863-4g3prl9dm17ho82975ur3c9209r36s5q:/oauthredirect';

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    redirectUri: googleRedirectUri,
  });

  // GitHub OAuth endpoints
  const githubDiscovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
  };

  // Set up Firebase auth state listener
  useEffect(() => {
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

  // Handle Google OAuth response
  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { id_token } = googleResponse.params;
      if (id_token) {
        const credential = GoogleAuthProvider.credential(id_token);
        signInWithCredential(auth, credential).catch((error) => {
          setError(error.message || 'Google sign-in failed');
          setState((prev) => ({ ...prev, isLoading: false }));
        });
      }
    } else if (googleResponse?.type === 'error') {
      setError(googleResponse.error?.message || 'Google sign-in failed');
      setState((prev) => ({ ...prev, isLoading: false }));
    } else if (googleResponse?.type === 'dismiss') {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [googleResponse]);

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

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    setError(null);
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const result = await googlePromptAsync();
      // Response handling happens in the useEffect above
      // Return false here — the useEffect will update state on success
      if (result?.type !== 'success') {
        setState((prev) => ({ ...prev, isLoading: false }));
        return false;
      }
      return true;
    } catch (error: any) {
      const errorMessage = error.message || 'Google sign-in failed';
      setError(errorMessage);
      setState({
        user: null,
        api: null,
        isLoading: false,
        isAuthenticated: false,
      });
      return false;
    }
  }, [googlePromptAsync]);

  const signInWithGitHub = useCallback(async (): Promise<boolean> => {
    setError(null);
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'cachebash' });

      const request = new AuthSession.AuthRequest({
        clientId: process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID || '',
        scopes: ['read:user', 'user:email'],
        redirectUri,
      });

      const result = await request.promptAsync(githubDiscovery);

      if (result.type === 'success' && result.params.code) {
        // Exchange code for token via Firebase's GitHub provider
        const credential = GithubAuthProvider.credential(result.params.code);
        await signInWithCredential(auth, credential);
        return true;
      }

      setState((prev) => ({ ...prev, isLoading: false }));
      return false;
    } catch (error: any) {
      const errorMessage = error.message || 'GitHub sign-in failed';
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
    signInWithGoogle,
    signInWithGitHub,
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
