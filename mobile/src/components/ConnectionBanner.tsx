import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useConnectivity } from '../contexts/ConnectivityContext';
import { theme } from '../theme';

export default function ConnectionBanner() {
  const { isConnected, isInternetReachable } = useConnectivity();
  const slideAnim = useRef(new Animated.Value(-50)).current;

  const isOffline = !isConnected || isInternetReachable === false;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOffline ? 0 : -50,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline, slideAnim]);

  if (!isOffline) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { transform: [{ translateY: slideAnim }] },
      ]}
      accessibilityRole="alert"
      accessibilityLabel="No internet connection. Data may be outdated."
    >
      <Text style={styles.bannerText}>No Connection</Text>
      <Text style={styles.bannerSubtext}>Data may be outdated</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.warning + 'CC',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    color: '#000',
  },
  bannerSubtext: {
    fontSize: theme.fontSize.xs,
    color: '#000',
    opacity: 0.7,
  },
});
