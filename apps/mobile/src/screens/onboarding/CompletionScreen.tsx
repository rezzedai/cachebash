import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnboarding } from '../../contexts/OnboardingContext';

type Props = {
  navigation: any;
};

export default function CompletionScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { completeStep } = useOnboarding();

  const handleFinish = async () => {
    await completeStep('completion');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>🎉</Text>
        </View>
        <Text style={styles.title}>You're All Set!</Text>
        <Text style={styles.subtitle}>
          CacheBash is ready to coordinate your AI agents.
        </Text>

        <View style={styles.tips}>
          <View style={styles.tip}>
            <Text style={styles.tipBullet}>→</Text>
            <Text style={styles.tipText}>View agent sessions on the Home tab</Text>
          </View>
          <View style={styles.tip}>
            <Text style={styles.tipBullet}>→</Text>
            <Text style={styles.tipText}>Send tasks from the Tasks tab</Text>
          </View>
          <View style={styles.tip}>
            <Text style={styles.tipBullet}>→</Text>
            <Text style={styles.tipText}>Monitor agent messages in real-time</Text>
          </View>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleFinish}>
          <Text style={styles.primaryButtonText}>Go to Dashboard</Text>
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
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 32,
  },
  icon: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: '700', color: '#f0f0f5', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#9ca3af', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  tips: { alignSelf: 'stretch' },
  tip: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 8 },
  tipBullet: { fontSize: 16, color: '#00d4ff', marginRight: 12 },
  tipText: { fontSize: 15, color: '#d1d5db' },
  footer: { paddingHorizontal: 32 },
  primaryButton: {
    backgroundColor: '#00d4ff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 17, fontWeight: '600', color: '#0a0a0f' },
});
