import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Task } from '../types';
import { theme } from '../theme';
import { getStatusColor } from '../utils';
import { useAuth } from '../contexts/AuthContext';
import { haptic } from '../utils/haptics';

type Props = NativeStackScreenProps<any, 'TaskDetail'>;

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: 'Pending',
    active: 'Active',
    done: 'Done',
    failed: 'Failed',
  };
  return labels[status] || status;
}

export default function TaskDetailScreen({ route, navigation }: Props) {
  const task: Task = route.params?.task;
  const { api } = useAuth();
  const [selectedOption, setSelectedOption] = React.useState<string | null>(null);
  const [isAnswering, setIsAnswering] = React.useState(false);
  const [isAnswered, setIsAnswered] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const answeringRef = React.useRef(false);
  const cooldownRef = React.useRef(false);

  if (!task) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Task not found</Text>
      </View>
    );
  }

  const handleAnswer = async (option: string) => {
    // Prevent double-submit via ref (synchronous check)
    if (answeringRef.current || cooldownRef.current || !api || !task.id) return;
    answeringRef.current = true;

    haptic.medium();
    setSelectedOption(option);
    setIsAnswering(true);

    try {
      await api.sendMessage({
        source: 'flynn',
        target: task.source || 'iso',
        message: option,
        message_type: 'RESULT',
        priority: task.priority || 'normal',
        reply_to: task.id,
      });

      // Mark as answered with persistent UI feedback
      setIsAnswered(true);
      haptic.success();

      // 2-second cooldown
      cooldownRef.current = true;
      setTimeout(() => {
        cooldownRef.current = false;
      }, 2000);
    } catch (err) {
      haptic.error();
      Alert.alert('Error', 'Failed to send response');
      setSelectedOption(null);
      setIsAnswered(false);
    } finally {
      setIsAnswering(false);
      answeringRef.current = false;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(task.status) + '20' }]}>
        <Text style={[styles.statusText, { color: getStatusColor(task.status) }]}>
          {getStatusLabel(task.status)}
        </Text>
      </View>

      <Text style={styles.title} ellipsizeMode="tail">{task.title}</Text>

      <View style={styles.metadataRow}>
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeLabel}>Type</Text>
          <Text style={styles.metaBadgeValue}>{task.type}</Text>
        </View>
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeLabel}>Priority</Text>
          <Text style={styles.metaBadgeValue}>{task.priority || 'normal'}</Text>
        </View>
        {task.action && (
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeLabel}>Action</Text>
            <Text style={styles.metaBadgeValue}>{task.action}</Text>
          </View>
        )}
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Source</Text>
          <TouchableOpacity
            onPress={() => task.source && navigation.navigate('ProgramDetail', { programId: task.source })}
            disabled={!task.source}
          >
            <Text style={[styles.infoValue, task.source && styles.infoValueLink]}>
              {task.source || 'Unknown'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Target</Text>
          <TouchableOpacity
            onPress={() => task.target && navigation.navigate('ProgramDetail', { programId: task.target })}
            disabled={!task.target}
          >
            <Text style={[styles.infoValue, task.target && styles.infoValueLink]}>
              {task.target || 'Unknown'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Created</Text>
          <Text style={styles.infoValue}>{formatDate(task.createdAt)}</Text>
        </View>
        {task.projectId && (
          <>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Project</Text>
              <Text style={styles.infoValue}>{task.projectId}</Text>
            </View>
          </>
        )}
      </View>

      {task.instructions && (
        <View style={styles.instructionsCard}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Text style={styles.instructionsText}>
            {isExpanded || task.instructions.length <= 500
              ? task.instructions
              : `${task.instructions.slice(0, 500)}...`}
          </Text>
          {task.instructions.length > 500 && (
            <TouchableOpacity
              style={styles.showMoreButton}
              onPress={() => setIsExpanded(!isExpanded)}
              activeOpacity={0.7}
            >
              <Text style={styles.showMoreText}>
                {isExpanded ? 'Show less' : 'Show more'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {task.type === 'question' && task.options && task.options.length > 0 && (
        <View style={styles.optionsCard}>
          <Text style={styles.sectionTitle}>Options</Text>
          {isAnswered && (
            <Text style={styles.answeredText}>✓ Answer sent</Text>
          )}
          {task.options.map((option, index) => {
            const isSelected = selectedOption === option;
            const isDisabled = isAnswering || isAnswered;
            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.optionButton,
                  isSelected && isAnswered && styles.optionButtonAnswered,
                  !isSelected && isAnswered && styles.optionButtonDisabled,
                  isSelected && !isAnswered && styles.optionButtonSelected,
                ]}
                onPress={() => handleAnswer(option)}
                disabled={isDisabled}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.optionText,
                  isSelected && isAnswered && styles.optionTextAnswered,
                  !isSelected && isAnswered && styles.optionTextDisabled,
                  isSelected && !isAnswered && styles.optionTextSelected,
                ]}>
                  {isSelected && isAnswered && '✓ '}
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  errorText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.md,
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
    lineHeight: theme.fontSize.xl * 1.3,
  },
  metadataRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  metaBadge: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metaBadgeLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginBottom: 2,
  },
  metaBadgeValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: '600',
  },
  infoCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  infoLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: '600',
  },
  infoValueLink: {
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  instructionsCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  instructionsText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: theme.fontSize.sm * 1.5,
    fontFamily: 'monospace',
  },
  optionsCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionButton: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.primary + '40',
  },
  optionText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
  },
  optionButtonSelected: {
    backgroundColor: theme.colors.primary + '20',
    borderColor: theme.colors.primary,
  },
  optionTextSelected: {
    color: theme.colors.primary,
  },
  answeredText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.success || theme.colors.primary,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  optionButtonAnswered: {
    backgroundColor: theme.colors.primary + '30',
    borderColor: theme.colors.primary,
  },
  optionTextAnswered: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  optionButtonDisabled: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    opacity: 0.4,
  },
  optionTextDisabled: {
    color: theme.colors.textMuted,
  },
  showMoreButton: {
    marginTop: theme.spacing.md,
    alignSelf: 'flex-start',
  },
  showMoreText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '600',
  },
});
