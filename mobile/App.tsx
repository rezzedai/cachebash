import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { NotificationProvider } from './src/contexts/NotificationContext';
import { ConnectivityProvider } from './src/contexts/ConnectivityContext';
import ConnectionBanner from './src/components/ConnectionBanner';
import AppNavigation from './src/navigation';
import SignInScreen from './src/screens/SignInScreen';
import LoadingScreen from './src/screens/LoadingScreen';
import ErrorBoundary from './src/components/ErrorBoundary';

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  return (
    <NotificationProvider>
      <ConnectionBanner />
      <AppNavigation />
    </NotificationProvider>
  );
}

export default function App() {
  return (
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
  );
}
