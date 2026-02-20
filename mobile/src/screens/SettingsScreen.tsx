import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useSessions } from '../hooks/useSessions';
import { useNotifications } from '../contexts/NotificationContext';
import { theme } from '../theme';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { signOut, user } = useAuth();
  const { error: sessionsError } = useSessions();
  const { permissionStatus, preferences, updatePreferences, requestPermissions } = useNotifications();

  const handleDisconnect = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: signOut,
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Account</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Account</Text>
            <Text style={styles.rowValue}>{user?.email || 'Unknown'}</Text>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.buttonRow}
            onPress={handleDisconnect}
            activeOpacity={0.7}
            accessibilityLabel="Sign out of CacheBash"
          >
            <Text style={styles.disconnectText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Notifications</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View>
              <Text style={styles.rowLabel}>Permission</Text>
              <Text style={styles.rowSubtext}>
                {permissionStatus === 'granted' ? 'Notifications allowed' :
                 permissionStatus === 'denied' ? 'Blocked in Settings' : 'Not yet requested'}
              </Text>
            </View>
            {permissionStatus !== 'granted' && (
              <TouchableOpacity
                onPress={requestPermissions}
                style={styles.enableButton}
                accessibilityRole="button"
                accessibilityLabel="Enable notifications"
              >
                <Text style={styles.enableButtonText}>Enable</Text>
              </TouchableOpacity>
            )}
            {permissionStatus === 'granted' && (
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Enabled</Text>
              </View>
            )}
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View>
              <Text style={styles.rowLabel}>Critical</Text>
              <Text style={styles.rowSubtext}>Always enabled</Text>
            </View>
            <Switch
              value={true}
              disabled={true}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#fff"
              accessibilityLabel="Critical notifications"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View>
              <Text style={styles.rowLabel}>Operational</Text>
              <Text style={styles.rowSubtext}>Task updates, status changes</Text>
            </View>
            <Switch
              value={preferences.operational}
              onValueChange={(val) => updatePreferences({ operational: val })}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#fff"
              accessibilityLabel="Operational notifications"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View>
              <Text style={styles.rowLabel}>Informational</Text>
              <Text style={styles.rowSubtext}>General updates</Text>
            </View>
            <Switch
              value={preferences.informational}
              onValueChange={(val) => updatePreferences({ informational: val })}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#fff"
              accessibilityLabel="Informational notifications"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Quiet Hours</Text>
              <Text style={styles.rowSubtext}>Mute non-critical alerts</Text>
              {preferences.quietHoursEnabled && (
                <Text style={[styles.rowSubtext, { marginTop: 4 }]}>
                  {preferences.quietHoursStart} - {preferences.quietHoursEnd}
                </Text>
              )}
            </View>
            <Switch
              value={preferences.quietHoursEnabled}
              onValueChange={(val) => updatePreferences({ quietHoursEnabled: val })}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#fff"
              accessibilityLabel="Quiet hours"
            />
          </View>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">About</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('Usage')}
            activeOpacity={0.7}
            accessibilityLabel="View usage and cost metrics"
            accessibilityRole="button"
          >
            <Text style={styles.rowLabel}>Usage & Costs</Text>
            <Text style={[styles.rowValue, { color: theme.colors.primary }]}>→</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Grid Status</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, sessionsError && { backgroundColor: theme.colors.error }]} />
              <Text style={[styles.statusText, sessionsError && { color: theme.colors.error }]}>
                {sessionsError ? 'Disconnected' : 'Connected'}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>App Version</Text>
            <Text style={styles.rowValue}>v2.0.0-dev</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Build</Text>
            <Text style={styles.rowValue}>Expo SDK 54</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>CacheBash Mobile</Text>
        <Text style={styles.footerSubtext}>Part of The Grid</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingBottom: theme.spacing.xl,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  section: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  rowLabel: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
  },
  rowSubtext: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  rowValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  buttonRow: {
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  disconnectText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.success,
    fontWeight: '600',
  },
  footer: {
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  footerSubtext: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  enableButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.primary + '20',
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  enableButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '600',
  },
});
