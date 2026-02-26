import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useOnboarding } from '../../contexts/OnboardingContext';

type Props = {
  navigation: any;
};

export default function ConnectAgentScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { completeStep, skipOnboarding } = useOnboarding();
  const [copied, setCopied] = useState(false);

  const configSnippet = `{
  "mcpServers": {
    "cachebash": {
      "url": "https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KEY"
      }
    }
  }
}`;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(configSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = async () => {
    await completeStep('connect-agent');
    navigation.navigate('FirstTask');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
      <View style={styles.content}>
        <Text style={styles.stepLabel}>Step 1 of 2</Text>
        <Text style={styles.title}>Connect Your IDE</Text>
        <Text style={styles.subtitle}>
          Add this to your IDE's MCP configuration file. Replace YOUR_KEY with the API key you just copied:
        </Text>

        <TouchableOpacity style={styles.codeBlock} onPress={handleCopy} activeOpacity={0.7}>
          <Text style={styles.codeText}>{configSnippet}</Text>
          <Text style={styles.copyHint}>{copied ? 'Copied!' : 'Tap to copy'}</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Claude Code: ~/.claude.json  •  Cursor: .cursor/mcp.json  •  VS Code: .vscode/mcp.json
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleContinue}>
          <Text style={styles.primaryButtonText}>I've Connected</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleContinue}>
          <Text style={styles.secondaryText}>I'll do this later</Text>
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
  content: { flex: 1, paddingHorizontal: 32 },
  stepLabel: { fontSize: 13, fontWeight: '600', color: '#00d4ff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: '700', color: '#f0f0f5', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#9ca3af', lineHeight: 24, marginBottom: 24 },
  codeBlock: {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: '#2a2a3e', marginBottom: 16,
  },
  codeText: { fontSize: 13, fontWeight: '600', color: '#00d4ff', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', textAlignVertical: 'top' },
  copyHint: { fontSize: 12, color: '#6b7280', marginTop: 8 },
  hint: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  footer: { paddingHorizontal: 32 },
  primaryButton: {
    backgroundColor: '#00d4ff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  primaryButtonText: { fontSize: 17, fontWeight: '600', color: '#0a0a0f' },
  secondaryButton: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  secondaryText: { fontSize: 15, color: '#9ca3af' },
  skipButton: { alignItems: 'center', paddingVertical: 8 },
  skipText: { fontSize: 14, color: '#4b5563' },
});
