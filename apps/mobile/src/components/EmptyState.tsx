import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export default function EmptyState({ icon, title, description, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {ctaLabel && onCta && (
        <TouchableOpacity style={styles.cta} onPress={onCta}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingVertical: 60,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderWidth: 1, borderColor: 'rgba(107, 114, 128, 0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  icon: { fontSize: 28 },
  title: { fontSize: 18, fontWeight: '600', color: '#f0f0f5', textAlign: 'center', marginBottom: 8 },
  description: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  cta: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)', borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 20,
    borderWidth: 1, borderColor: 'rgba(0, 212, 255, 0.3)',
  },
  ctaText: { fontSize: 14, fontWeight: '600', color: '#00d4ff' },
});
