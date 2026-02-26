import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

interface FirstKeyScreenProps {
  onComplete: () => void;
}

export default function FirstKeyScreen({ onComplete }: FirstKeyScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchFirstKey() {
      if (!user) return;

      try {
        const keyDoc = await getDoc(doc(db, `tenants/${user.uid}/config/firstKey`));
        if (keyDoc.exists() && !keyDoc.data().retrieved) {
          const encoded = keyDoc.data().key;
          const decoded = atob(encoded);
          setApiKey(decoded);
        } else {
          onComplete();
        }
      } catch (error) {
        console.error('Failed to fetch first key:', error);
        onComplete();
      } finally {
        setLoading(false);
      }
    }

    fetchFirstKey();
  }, [user]);

  const handleCopy = async () => {
    if (!apiKey) return;
    await Clipboard.setStringAsync(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleContinue = async () => {
    if (!user) return;

    try {
      await updateDoc(doc(db, `tenants/${user.uid}/config/firstKey`), {
        retrieved: true,
      });
    } catch (error) {
      console.error('Failed to mark key as retrieved:', error);
    }

    onComplete();
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Your API Key</Text>
        <Text style={styles.subtitle}>
          Use this key to connect your terminal to CacheBash. You won't see it again.
        </Text>
      </View>

      <View style={styles.keyContainer}>
        <Text style={styles.keyText} selectable>
          {apiKey}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.copyButton, copied && styles.copyButtonSuccess]}
        onPress={handleCopy}
        accessibilityRole="button"
        accessibilityLabel="Copy API key to clipboard"
      >
        <Text style={styles.copyButtonText}>
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </Text>
      </TouchableOpacity>

      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>TERMINAL SETUP</Text>
        <Text style={styles.setupText}>
          Add to your MCP config:
        </Text>
        <View style={styles.codeBlock}>
          <Text style={styles.codeText} selectable>{`{
  "mcpServers": {
    "cachebash": {
      "url": "https://api.cachebash.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KEY_HERE"
      }
    }
  }
}`}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.continueButton}
        onPress={handleContinue}
        accessibilityRole="button"
        accessibilityLabel="Continue to dashboard"
      >
        <Text style={styles.continueButtonText}>Continue to Dashboard</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  header: {
    marginTop: 48,
    marginBottom: 32,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.primary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    lineHeight: 22,
  },
  keyContainer: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  keyText: {
    fontFamily: 'Courier',
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    lineHeight: 20,
  },
  copyButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginBottom: 32,
  },
  copyButtonSuccess: {
    backgroundColor: theme.colors.success,
  },
  copyButtonText: {
    color: theme.colors.background,
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
  },
  setupContainer: {
    marginBottom: 32,
  },
  setupTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    letterSpacing: 1,
    marginBottom: theme.spacing.sm,
  },
  setupText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  codeBlock: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
  },
  codeText: {
    fontFamily: 'Courier',
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    lineHeight: 20,
  },
  continueButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  continueButtonText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
  },
});
