import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { theme } from '../theme';
import { haptic } from '../utils/haptics';

type Props = NativeStackScreenProps<any, 'ComposeMessage'>;

interface Program {
  id: string;
  name: string;
  color: string;
}

const PROGRAMS: Program[] = [
  { id: 'iso', name: 'ISO', color: '#6FC3DF' },
  { id: 'builder', name: 'BASHER', color: '#E87040' },
  { id: 'architect', name: 'ALAN', color: '#4A8ED4' },
  { id: 'reviewer', name: 'QUORRA', color: '#9B6FC0' },
  { id: 'auditor', name: 'SARK', color: '#C44040' },
  { id: 'able', name: 'ABLE', color: '#4DB870' },
  { id: 'beck', name: 'BECK', color: '#40A8A0' },
  { id: 'designer', name: 'RADIA', color: '#E8E0D0' },
];

export default function ComposeMessageScreen({ navigation }: Props) {
  const handleSelect = (program: Program) => {
    haptic.light();
    navigation.replace('ChannelDetail', {
      programId: program.id,
      channelName: program.name,
    });
  };

  const renderProgram = ({ item }: { item: Program }) => (
    <TouchableOpacity
      style={styles.programRow}
      onPress={() => handleSelect(item)}
      activeOpacity={0.7}
      accessibilityLabel={`Message ${item.name}`}
      accessibilityRole="button"
    >
      <View style={[styles.avatar, { backgroundColor: item.color + '20' }]}>
        <Text style={[styles.avatarText, { color: item.color }]}>
          {item.name.charAt(0)}
        </Text>
      </View>
      <View style={styles.programInfo}>
        <Text style={styles.programName}>{item.name}</Text>
        <Text style={styles.programId}>{item.id}</Text>
      </View>
      <Text style={styles.chevron}>{'\u203A'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>Select a program to message</Text>
      <FlatList
        data={PROGRAMS}
        renderItem={renderProgram}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  sectionHeader: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  list: {
    paddingBottom: theme.spacing.xl,
  },
  programRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  avatarText: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
  },
  programInfo: {
    flex: 1,
  },
  programName: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 2,
  },
  programId: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  chevron: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing.lg + 40 + theme.spacing.md,
  },
});
