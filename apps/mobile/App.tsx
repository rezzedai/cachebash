import React, { useState, useEffect } from 'react';
import { Keyboard, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './src/utils/navigationRef';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { OnboardingProvider, useOnboarding } from './src/contexts/OnboardingContext';
import { NotificationProvider } from './src/contexts/NotificationContext';
import { ConnectivityProvider } from './src/contexts/ConnectivityContext';
import OnboardingNavigator from './src/navigation/OnboardingNavigator';
import ConnectionBanner from './src/components/ConnectionBanner';
import AppNavigation from './src/navigation';
import SignInScreen from './src/screens/SignInScreen';
import LoadingScreen from './src/screens/LoadingScreen';
import FirstKeyScreen from './src/screens/FirstKeyScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './src/config/firebase';

function AppContent() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [showFirstKey, setShowFirstKey] = useState(false);
  const [checkingFirstKey, setCheckingFirstKey] = useState(false);

  useEffect(() => {
    async function checkFirstKey() {
      if (!isAuthenticated || !user) return;

      setCheckingFirstKey(true);
      try {
        // Poll for firstKey doc — Cloud Function may still be provisioning
        const maxAttempts = 15;
        const delayMs = 2000;
        for (let i = 0; i < maxAttempts; i++) {
          const keyDoc = await getDoc(doc(db, `tenants/${user.uid}/config/firstKey`));
          if (keyDoc.exists()) {
            if (!keyDoc.data().retrieved) {
              setShowFirstKey(true);
            }
            return;
          }
          // Doc doesn't exist yet — wait and retry
          if (i < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, delayMs));
          }
        }
        // Timed out — proceed without showing first key
      } catch (error) {
        console.error('Failed to check first key:', error);
      } finally {
        setCheckingFirstKey(false);
      }
    }

    checkFirstKey();
  }, [isAuthenticated, user]);

  if (isLoading || checkingFirstKey) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  if (showFirstKey) {
    return <FirstKeyScreen onComplete={() => setShowFirstKey(false)} />;
  }

  return (
    <OnboardingProvider>
      <AppContentWithOnboarding />
    </OnboardingProvider>
  );
}

function AppContentWithOnboarding() {
  const { isFirstRun, isLoading } = useOnboarding();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={navigationRef}>
      {isFirstRun ? (
        <OnboardingNavigator />
      ) : (
        <NotificationProvider>
          <ConnectionBanner />
          <AppNavigation />
        </NotificationProvider>
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaProvider>
        <ConnectivityProvider>
          <AuthProvider>
            <ErrorBoundary>
              <StatusBar style="light" />
              <AppContent />
            </ErrorBoundary>
          </AuthProvider>
        </ConnectivityProvider>
      </SafeAreaProvider>
      </Pressable>
    </GestureHandlerRootView>
  );
}
