import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { theme } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { haptic } from '../utils/haptics';

type Priority = 'low' | 'normal' | 'high';
type Action = 'queue' | 'interrupt' | 'backlog';

interface Program {
  id: string;
  name: string;
  color: string;
}

const PROGRAMS: Program[] = [
  { id: 'iso', name: 'iso', color: '#6FC3DF' },
  { id: 'basher', name: 'basher', color: '#E87040' },
  { id: 'alan', name: 'alan', color: '#4A8ED4' },
  { id: 'quorra', name: 'quorra', color: '#9B6FC0' },
  { id: 'sark', name: 'sark', color: '#C44040' },
  { id: 'able', name: 'able', color: '#4DB870' },
  { id: 'beck', name: 'beck', color: '#40A8A0' },
  { id: 'radia', name: 'radia', color: '#E8E0D0' },
];

const CreateTaskScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const initialTarget = route.params?.initialTarget || null;
  const { api } = useAuth();
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<string | null>(initialTarget);
  const [priority, setPriority] = useState<Priority>('normal');
  const [action, setAction] = useState<Action>('queue');
  const [instructions, setInstructions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const canSubmit = title.trim().length > 0 && target !== null && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await api.createTask({
        title: title.trim(),
        target: target!,
        instructions: instructions.trim() || undefined,
        priority,
        action,
        source: 'flynn',
      });

      haptic.success();
      navigation.goBack();
    } catch (error) {
      haptic.error();
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to create task'
      );
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Create Task</Text>
          <Text style={styles.headerSubtitle}>
            Dispatch work to a Grid program
          </Text>
        </View>

        {/* Title Input */}
        <View style={styles.section}>
          <Text style={styles.label}>
            Title <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title..."
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Target Program Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>
            Target Program <Text style={styles.required}>*</Text>
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {PROGRAMS.map((program) => {
              const isSelected = target === program.id;
              return (
                <TouchableOpacity
                  key={program.id}
                  style={[
                    styles.chip,
                    isSelected && {
                      borderColor: program.color,
                      backgroundColor: `${program.color}15`,
                    },
                  ]}
                  onPress={() => {
                    haptic.selection();
                    setTarget(program.id);
                  }}
                  accessibilityLabel={`Select ${program.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && { color: program.color },
                    ]}
                  >
                    {program.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Priority Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.chipRow}>
            {(['low', 'normal', 'high'] as Priority[]).map((p) => {
              const isSelected = priority === p;
              const color =
                p === 'low'
                  ? theme.colors.textSecondary
                  : p === 'normal'
                  ? theme.colors.primary
                  : theme.colors.error;

              return (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.chip,
                    isSelected && {
                      borderColor: color,
                      backgroundColor: `${color}15`,
                    },
                  ]}
                  onPress={() => {
                    haptic.selection();
                    setPriority(p);
                  }}
                  accessibilityLabel={`Priority: ${p}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[styles.chipText, isSelected && { color }]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Action Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Action</Text>
          <View style={styles.chipRow}>
            {(['queue', 'interrupt', 'backlog'] as Action[]).map((a) => {
              const isSelected = action === a;
              return (
                <TouchableOpacity
                  key={a}
                  style={[
                    styles.chip,
                    isSelected && {
                      borderColor: theme.colors.primary,
                      backgroundColor: `${theme.colors.primary}15`,
                    },
                  ]}
                  onPress={() => {
                    haptic.selection();
                    setAction(a);
                  }}
                  accessibilityLabel={`Action: ${a}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && { color: theme.colors.primary },
                    ]}
                  >
                    {a}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Instructions Input */}
        <View style={styles.section}>
          <Text style={styles.label}>Instructions</Text>
          <TextInput
            style={[styles.input, styles.instructionsInput]}
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Instructions for the program..."
            placeholderTextColor={theme.colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
          />
        </View>
      </ScrollView>

      {/* Submit Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            !canSubmit && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityLabel="Create task"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text
            style={[
              styles.submitButtonText,
              !canSubmit && styles.submitButtonTextDisabled,
            ]}
          >
            {isSubmitting ? 'Creating...' : 'Create Task'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  headerSubtitle: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  required: {
    color: theme.colors.error,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
  },
  instructionsInput: {
    height: 100,
    paddingTop: theme.spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  footer: {
    padding: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  submitButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: theme.colors.surface,
  },
  submitButtonText: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.background,
  },
  submitButtonTextDisabled: {
    color: theme.colors.textMuted,
  },
});

export default CreateTaskScreen;
