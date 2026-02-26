import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { theme } from '../theme';

interface KeyGenerationModalProps {
  visible: boolean;
  onClose: () => void;
  onKeyCreated: () => void;
}

export function KeyGenerationModal({ visible, onClose, onKeyCreated }: KeyGenerationModalProps) {
  const [label, setLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setLabel('');
    setGeneratedKey(null);
    setCopied(false);
    setError(null);
    setGenerating(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleDone = () => {
    onKeyCreated();
    resetState();
    onClose();
  };

  const handleGenerate = async () => {
    if (generating) return;

    setGenerating(true);
    setError(null);

    try {
      const functions = getFunctions();
      const createKey = httpsCallable(functions, 'createUserKey');
      const result = await createKey({ label: label.trim() || 'API Key' });
      const data = result.data as { success: boolean; key: string; keyHash: string; label: string };

      if (data.success && data.key) {
        setGeneratedKey(data.key);
      } else {
        setError('Failed to generate key');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate key');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;

    try {
      await Clipboard.setStringAsync(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {!generatedKey ? (
            // Phase 1: Input
            <View style={styles.content}>
              <Text style={styles.header}>Generate New Key</Text>

              <TextInput
                style={styles.input}
                placeholder="API Key"
                placeholderTextColor={theme.colors.textMuted}
                value={label}
                onChangeText={setLabel}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {error && (
                <Text style={styles.errorText}>{error}</Text>
              )}

              <TouchableOpacity
                style={[styles.button, styles.primaryButton, generating && styles.buttonDisabled]}
                onPress={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator color={theme.colors.background} />
                ) : (
                  <Text style={styles.buttonText}>Generate</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={handleClose}
              >
                <Text style={styles.textButtonLabel}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Phase 2: Key display
            <View style={styles.content}>
              <Text style={styles.header}>Your New API Key</Text>

              <Text style={styles.warningText}>
                Save this key now. You won't see it again.
              </Text>

              <View style={styles.keyContainer}>
                <Text style={styles.keyText} selectable>
                  {generatedKey}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.button, copied ? styles.successButton : styles.primaryButton]}
                onPress={handleCopy}
              >
                <Text style={styles.buttonText}>
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </Text>
              </TouchableOpacity>

              <View style={styles.configContainer}>
                <Text style={styles.configLabel}>MCP Configuration:</Text>
                <View style={styles.configBox}>
                  <Text style={styles.configText} selectable>
{`{
  "mcpServers": {
    "cachebash": {
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KEY_HERE"
      }
    }
  }
}`}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleDone}
              >
                <Text style={styles.secondaryButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  header: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    color: theme.colors.text,
    fontSize: theme.fontSize.md,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  warningText: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.md,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
    fontWeight: '600',
  },
  keyContainer: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  keyText: {
    fontFamily: 'monospace',
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    lineHeight: 20,
  },
  configContainer: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  configLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
    fontWeight: '600',
  },
  configBox: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
  },
  configText: {
    fontFamily: 'monospace',
    fontSize: theme.fontSize.xs,
    color: theme.colors.text,
    lineHeight: 16,
  },
  button: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
    minHeight: 50,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
  },
  successButton: {
    backgroundColor: theme.colors.success,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.background,
  },
  secondaryButtonText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  textButton: {
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  textButtonLabel: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
});
