import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';
import { haptic } from '../utils/haptics';

type Period = 'today' | 'this_week' | 'this_month' | 'all';

// Token formatting helper
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

// Cost formatting helper
function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export default function UsageScreen() {
  const { api } = useAuth();
  const [period, setPeriod] = useState<Period>('this_month');
  const [costData, setCostData] = useState<any>(null);
  const [commsData, setCommsData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    setError(null);
    try {
      const [cost, comms] = await Promise.all([
        api.getCostSummary({ period, groupBy: 'program' }),
        api.getCommsMetrics({ period }),
      ]);
      setCostData(cost);
      setCommsData(comms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setIsLoading(false);
    }
  }, [api, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const renderPeriodSelector = () => {
    const periods: Period[] = ['today', 'this_week', 'this_month', 'all'];
    const labels: Record<Period, string> = {
      today: 'Today',
      this_week: 'This Week',
      this_month: 'This Month',
      all: 'All Time',
    };

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.periodRow}
        contentContainerStyle={styles.periodContent}
      >
        {periods.map((p) => {
          const isActive = period === p;
          return (
            <TouchableOpacity
              key={p}
              style={[styles.periodChip, isActive && styles.periodChipActive]}
              onPress={() => { haptic.selection(); setPeriod(p); }}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.periodChipText, isActive && styles.periodChipTextActive]}>
                {labels[p]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const renderCostSummary = () => {
    if (!costData) return null;

    return (
      <View style={styles.summaryCard}>
        <Text style={styles.sectionTitle}>Token Spend</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {formatTokens(costData?.totalTokens || costData?.total_tokens || 0)}
            </Text>
            <Text style={styles.metricLabel}>Tokens</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {formatCost(costData?.totalCost || costData?.total_cost || 0)}
            </Text>
            <Text style={styles.metricLabel}>Cost</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {costData?.taskCount || costData?.task_count || 0}
            </Text>
            <Text style={styles.metricLabel}>Tasks</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderProgramBreakdown = () => {
    if (!costData) return null;

    const programBreakdown = costData?.breakdown || costData?.programs || costData?.groups || [];
    if (programBreakdown.length === 0) return null;

    const maxCost = Math.max(...programBreakdown.map((p: any) => p.cost || p.total_cost || 0), 1);

    return (
      <View style={styles.breakdownCard}>
        <Text style={styles.sectionTitle}>By Program</Text>
        {programBreakdown
          .sort((a: any, b: any) => (b.cost || b.total_cost || 0) - (a.cost || a.total_cost || 0))
          .map((program: any) => {
            const cost = program.cost || program.total_cost || 0;
            const pct = (cost / maxCost) * 100;
            const name = program.programId || program.program || program.source || 'unknown';
            return (
              <View key={name} style={styles.barRow}>
                <Text style={styles.barLabel}>{name.toUpperCase()}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.barValue}>{formatCost(cost)}</Text>
              </View>
            );
          })}
      </View>
    );
  };

  const renderCommsMetrics = () => {
    if (!commsData) return null;

    return (
      <View style={styles.summaryCard}>
        <Text style={styles.sectionTitle}>Communications</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {commsData?.totalMessages || commsData?.total_messages || 0}
            </Text>
            <Text style={styles.metricLabel}>Messages</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {commsData?.successRate != null ? `${Math.round(commsData.successRate)}%` :
               commsData?.success_rate != null ? `${Math.round(commsData.success_rate)}%` : 'N/A'}
            </Text>
            <Text style={styles.metricLabel}>Success Rate</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>
              {commsData?.avgLatency != null ? `${Math.round(commsData.avgLatency)}ms` :
               commsData?.avg_latency != null ? `${Math.round(commsData.avg_latency)}ms` : 'N/A'}
            </Text>
            <Text style={styles.metricLabel}>Avg Latency</Text>
          </View>
        </View>
      </View>
    );
  };

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Usage</Text>
        </View>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={fetchData}
            accessibilityRole="button"
            accessibilityLabel="Retry loading usage data"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Usage</Text>
      </View>

      {renderPeriodSelector()}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchData}
            tintColor={theme.colors.primary}
          />
        }
      >
        {isLoading && !costData && !commsData ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <>
            {renderCostSummary()}
            {renderProgramBreakdown()}
            {renderCommsMetrics()}

            {!costData && !commsData && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No usage data available</Text>
                <Text style={styles.emptyHintText}>Pull down to refresh</Text>
              </View>
            )}
          </>
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
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  periodRow: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  periodContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  periodChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
  },
  periodChipActive: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.primary,
  },
  periodChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  periodChipTextActive: {
    color: theme.colors.primary,
  },
  summaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.md,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  metricItem: {
    alignItems: 'center',
  },
  metricValue: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  metricLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  breakdownCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  barLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '500',
    width: 80,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing.sm,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  barValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '600',
    width: 60,
    textAlign: 'right',
  },
  loadingContainer: {
    paddingVertical: theme.spacing.xl * 2,
    alignItems: 'center',
  },
  errorCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error,
    padding: theme.spacing.lg,
    margin: theme.spacing.lg,
    alignItems: 'center',
  },
  errorText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  retryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  emptyState: {
    paddingVertical: theme.spacing.xl * 2,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textMuted,
  },
  emptyHintText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
});
