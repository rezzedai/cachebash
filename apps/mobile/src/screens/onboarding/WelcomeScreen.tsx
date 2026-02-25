import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnboarding } from '../../contexts/OnboardingContext';

type Props = {
  navigation: any;
};

export default function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { completeStep, skipOnboarding } = useOnboarding();

  const handleContinue = async () => {
    await completeStep('welcome');
    navigation.navigate('ConnectAgent');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>⚡</Text>
        </View>
        <Text style={styles.title}>Welcome to CacheBash</Text>
        <Text style={styles.subtitle}>
          Coordinate AI agents across any MCP-compatible IDE.{'\n'}
          Let's get you set up in under a minute.
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleContinue}>
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={skipOnboarding}>
          <Text style={styles.skipText}>Skip setup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    borderWidth: 1, borderColor: 'rgba(0, 212, 255, 0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 32,
  },
  icon: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: '700', color: '#f0f0f5', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#9ca3af', textAlign: 'center', lineHeight: 24 },
  footer: { paddingHorizontal: 32 },
  primaryButton: {
    backgroundColor: '#00d4ff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  primaryButtonText: { fontSize: 17, fontWeight: '600', color: '#0a0a0f' },
  skipButton: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 15, color: '#6b7280' },
});
