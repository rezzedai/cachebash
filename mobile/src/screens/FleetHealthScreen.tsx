import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFleetHealth } from '../hooks/useFleetHealth';
import { theme } from '../theme';

function formatHeartbeat(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return 'offline';
}

function getHeartbeatColor(seconds: number): string {
  if (seconds < 60) return theme.colors.success;     // green
  if (seconds < 120) return theme.colors.warning;     // yellow
  return theme.colors.error;                           // red
}

type Props = NativeStackScreenProps<any, 'FleetHealth'>;

export default function FleetHealthScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const {
    programs,
    healthyCount,
    totalCount,
    error,
    isLoading,
    refetch,
    lastUpdated,
    isCached,
  } = useFleetHealth();

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Sort programs: unhealthy first, then by heartbeat age descending
  const sortedPrograms = React.useMemo(() => {
    return [...programs].sort((a, b) => {
      // Unhealthy first
      if (!a.isHealthy && b.isHealthy) return -1;
      if (a.isHealthy && !b.isHealthy) return 1;
      // Then by heartbeat age descending
      return b.heartbeatAge - a.heartbeatAge;
    });
  }, [programs]);

  // Overall health indicator color
  const overallHealthColor = React.useMemo(() => {
    if (totalCount === 0) return theme.colors.textMuted;
    if (healthyCount === totalCount) return theme.colors.success;
    if (healthyCount > 0) return theme.colors.warning;
    return theme.colors.error;
  }, [healthyCount, totalCount]);

  const lastUpdateStr = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : 'never';

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + theme.spacing.sm },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Fleet Health</Text>
          {isCached && (
            <View style={styles.cachedBadge}>
              <Text style={styles.cachedBadgeText}>CACHED</Text>
            </View>
          )}
        </View>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View
              style={[
                styles.healthDot,
                { backgroundColor: overallHealthColor },
              ]}
            />
            <Text style={styles.summaryText}>
              {healthyCount}/{totalCount} Healthy
            </Text>
          </View>
          <Text style={styles.lastUpdateText}>
            Updated {lastUpdateStr}
          </Text>
        </View>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              Unable to fetch fleet health
            </Text>
          </View>
        )}

        {/* Program Cards */}
        {sortedPrograms.length === 0 && !isLoading && !error ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No fleet data available
            </Text>
            <Text style={styles.emptyStateHint}>
              Pull down to refresh
            </Text>
          </View>
        ) : (
          <View style={styles.programList}>
            {sortedPrograms.map((program) => {
              const heartbeatColor = getHeartbeatColor(program.heartbeatAge);
              const isUnhealthy = !program.isHealthy;

              return (
                <TouchableOpacity
                  key={program.programId}
                  style={[
                    styles.programCard,
                    isUnhealthy && styles.programCardUnhealthy,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('ProgramDetail', { programId: program.programId })}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${program.programId} details`}
                >
                  {/* Program Name + Health Dot */}
                  <View style={styles.programHeader}>
                    <Text style={styles.programName}>
                      {program.programId.toUpperCase()}
                    </Text>
                    <View
                      style={[
                        styles.programHealthDot,
                        { backgroundColor: heartbeatColor },
                      ]}
                    />
                  </View>

                  {/* Heartbeat Age */}
                  <Text
                    style={[
                      styles.heartbeatText,
                      { color: heartbeatColor },
                    ]}
                  >
                    {formatHeartbeat(program.heartbeatAge)}
                  </Text>

                  {/* Pending Counts */}
                  <View style={styles.pendingRow}>
                    <View style={styles.pendingItem}>
                      <Text style={styles.pendingIcon}>◈</Text>
                      <Text style={styles.pendingText}>
                        {program.pendingMessages} pending
                      </Text>
                    </View>
                    <View style={styles.pendingItem}>
                      <Text style={styles.pendingIcon}>☰</Text>
                      <Text style={styles.pendingText}>
                        {program.pendingTasks} pending
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
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
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  cachedBadge: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  cachedBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },

  // Summary Card
  summaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  healthDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  summaryText: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
  },
  lastUpdateText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },

  // Error Card
  errorCard: {
    backgroundColor: theme.colors.error + '15',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '30',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    fontWeight: '500',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
  },
  emptyStateText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  emptyStateHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },

  // Program List
  programList: {
    gap: theme.spacing.sm,
  },
  programCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  programCardUnhealthy: {
    borderColor: theme.colors.error,
  },
  programHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  programName: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: 1,
  },
  programHealthDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  heartbeatText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  pendingRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  pendingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  pendingIcon: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  pendingText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
});
