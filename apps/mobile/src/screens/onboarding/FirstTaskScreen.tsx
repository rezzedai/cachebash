import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useAuth } from '../../contexts/AuthContext';

type Props = {
  navigation: any;
};

export default function FirstTaskScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { completeStep, skipOnboarding } = useOnboarding();
  const { api } = useAuth();
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);

  const handleSendTask = async () => {
    if (!title.trim() || !api) return;

    setSending(true);
    try {
      await api.createTask({
        title: title.trim(),
        target: 'all',
        instructions: title.trim(),
      });
      await completeStep('first-task');
      navigation.navigate('Completion');
    } catch (error) {
      console.error('Failed to create task:', error);
      // Still advance — don't block onboarding
      await completeStep('first-task');
      navigation.navigate('Completion');
    } finally {
      setSending(false);
    }
  };

  const handleSkipStep = async () => {
    await completeStep('first-task');
    navigation.navigate('Completion');
  };

  return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top + 40 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.stepLabel}>Step 2 of 2</Text>
          <Text style={styles.title}>Send Your First Task</Text>
          <Text style={styles.subtitle}>
            Create a task that your connected agents can pick up. Try something simple:
          </Text>

          <TextInput
            style={styles.input}
            placeholder='e.g., "Run the test suite and report results"'
            placeholderTextColor="#4b5563"
            value={title}
            onChangeText={setTitle}
            multiline
            maxLength={200}
          />

          <Text style={styles.hint}>
            Tasks are delivered to all connected agents via MCP.
          </Text>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity
            style={[styles.primaryButton, (!title.trim() || sending) && styles.primaryButtonDisabled]}
            onPress={handleSendTask}
            disabled={!title.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#0a0a0f" />
            ) : (
              <Text style={styles.primaryButtonText}>Send Task</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleSkipStep}>
            <Text style={styles.secondaryText}>Skip for now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipButton} onPress={skipOnboarding}>
            <Text style={styles.skipText}>Skip setup</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { flex: 1, paddingHorizontal: 32 },
  stepLabel: { fontSize: 13, fontWeight: '600', color: '#00d4ff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: '700', color: '#f0f0f5', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#9ca3af', lineHeight: 24, marginBottom: 24 },
  input: {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#2a2a3e',
    color: '#f0f0f5', fontSize: 16, minHeight: 80,
    textAlignVertical: 'top', marginBottom: 12,
  },
  hint: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  footer: { paddingHorizontal: 32 },
  primaryButton: {
    backgroundColor: '#00d4ff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 17, fontWeight: '600', color: '#0a0a0f' },
  secondaryButton: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  secondaryText: { fontSize: 15, color: '#9ca3af' },
  skipButton: { alignItems: 'center', paddingVertical: 8 },
  skipText: { fontSize: 14, color: '#4b5563' },
});
