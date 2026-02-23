import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, resetPassword, error: authError } = useAuth();

  const handleAuth = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const success = mode === 'signIn'
        ? await signIn(email.trim(), password.trim())
        : await signUp(email.trim(), password.trim());

      if (!success && authError) {
        setError(authError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Email Required', 'Please enter your email address to reset your password');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email.trim());
      Alert.alert(
        'Password Reset Email Sent',
        'Check your email for instructions to reset your password',
        [{ text: 'OK' }]
      );
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'signIn' ? 'signUp' : 'signIn');
    setError('');
    setPassword('');
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Text style={styles.logo}>CacheBash</Text>
          <Text style={styles.subtitle}>MOBILE OPERATIONS BRIDGE</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.inputLabel}>EMAIL</Text>
          <TextInput
            style={styles.input}
            placeholder="user@example.com"
            placeholderTextColor={theme.colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            editable={!loading}
            accessibilityLabel="Email address"
          />

          <Text style={styles.inputLabel}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            placeholder={mode === 'signUp' ? 'At least 6 characters' : 'Enter your password'}
            placeholderTextColor={theme.colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signUp' ? 'new-password' : 'password'}
            editable={!loading}
            accessibilityLabel="Password"
          />

          {error || authError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error || authError}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={mode === 'signIn' ? 'Sign in' : 'Create account'}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.background} />
            ) : (
              <Text style={styles.buttonText}>
                {mode === 'signIn' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>

          {mode === 'signIn' && (
            <TouchableOpacity
              style={styles.forgotPasswordButton}
              onPress={handleForgotPassword}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
            >
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          <View style={styles.toggleContainer}>
            <Text style={styles.toggleText}>
              {mode === 'signIn' ? "Don't have an account?" : 'Already have an account?'}
            </Text>
            <TouchableOpacity
              onPress={toggleMode}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={mode === 'signIn' ? 'Switch to sign up' : 'Switch to sign in'}
            >
              <Text style={styles.toggleLink}>
                {mode === 'signIn' ? 'Sign Up' : 'Sign In'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.footer}>CacheBash</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 64,
  },
  logo: {
    fontSize: 48,
    fontWeight: '700',
    color: theme.colors.primary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    letterSpacing: 3,
    fontWeight: '600',
  },
  formContainer: {
    width: '100%',
  },
  inputLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    letterSpacing: 1,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 14,
    fontSize: theme.fontSize.lg,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    minHeight: 52,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: theme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: theme.colors.background,
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
  },
  forgotPasswordButton: {
    marginTop: theme.spacing.md,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  forgotPasswordText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  toggleText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
  },
  toggleLink: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
  },
  footer: {
    textAlign: 'center',
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.xs,
    marginTop: 48,
  },
});
