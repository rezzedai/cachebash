import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';
import KeyGenerationModal from '../components/KeyGenerationModal';

interface ApiKey {
  keyHash: string;
  label: string;
  createdAt: any;
  lastUsed: any;
  active: boolean;
}

interface KeyManagementScreenProps {
  route?: {
    params?: {
      openGenerateModal?: boolean;
    };
  };
  navigation?: any;
}

const KeyManagementScreen: React.FC<KeyManagementScreenProps> = ({ route, navigation }) => {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingKeyHash, setEditingKeyHash] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  // Check for deep link param to open generate modal
  useEffect(() => {
    if (route?.params?.openGenerateModal) {
      setShowGenerateModal(true);
    }
  }, [route?.params?.openGenerateModal]);

  // Real-time listener for keys
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'keyIndex'),
      where('userId', '==', user.uid),
      where('active', '==', true)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const keyData = snapshot.docs.map((doc) => ({
          keyHash: doc.id,
          ...doc.data(),
        })) as ApiKey[];

        // Sort client-side by createdAt descending
        keyData.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setKeys(keyData);
        setLoading(false);
        setRefreshing(false);
      },
      (error) => {
        console.error('Error fetching keys:', error);
        Alert.alert('Error', 'Failed to load API keys');
        setLoading(false);
        setRefreshing(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // Real-time listener will update automatically
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleLabelEdit = useCallback(
    async (keyHash: string) => {
      if (!editLabel.trim()) {
        Alert.alert('Error', 'Label cannot be empty');
        return;
      }

      try {
        const updateKeyLabel = httpsCallable(getFunctions(), 'updateKeyLabel');
        await updateKeyLabel({ keyHash, label: editLabel.trim() });
        setEditingKeyHash(null);
        setEditLabel('');
      } catch (error: any) {
        console.error('Error updating label:', error);
        Alert.alert('Error', error.message || 'Failed to update label');
      }
    },
    [editLabel]
  );

  const handleRevoke = useCallback((keyHash: string, label: string) => {
    Alert.alert(
      'Revoke Key',
      `This key will stop working immediately. Continue?\n\nKey: ${label}`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              const revokeUserKey = httpsCallable(getFunctions(), 'revokeUserKey');
              await revokeUserKey({ keyHash });
            } catch (error: any) {
              console.error('Error revoking key:', error);
              Alert.alert('Error', error.message || 'Failed to revoke key');
            }
          },
        },
      ]
    );
  }, []);

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return 'Never';
    const date = timestamp.toDate?.() || new Date(timestamp);
    return date.toLocaleString();
  };

  const renderKeyCard = useCallback(
    ({ item }: { item: ApiKey }) => {
      const isEditing = editingKeyHash === item.keyHash;

      return (
        <View style={styles.keyCard}>
          <View style={styles.keyHeader}>
            <View style={styles.keyHashContainer}>
              <Text style={styles.keyHash}>
                {item.keyHash.substring(0, 8)}...
              </Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>Active</Text>
              </View>
            </View>
          </View>

          <View style={styles.keyInfo}>
            <Text style={styles.infoLabel}>Label</Text>
            {isEditing ? (
              <View style={styles.editContainer}>
                <TextInput
                  style={styles.editInput}
                  value={editLabel}
                  onChangeText={setEditLabel}
                  onSubmitEditing={() => handleLabelEdit(item.keyHash)}
                  onBlur={() => handleLabelEdit(item.keyHash)}
                  autoFocus
                  placeholder="Enter label"
                  placeholderTextColor={theme.colors.textMuted}
                />
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setEditingKeyHash(item.keyHash);
                  setEditLabel(item.label);
                }}
              >
                <Text style={styles.infoValue}>{item.label}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.keyInfo}>
            <Text style={styles.infoLabel}>Created</Text>
            <Text style={styles.infoValue}>{formatDate(item.createdAt)}</Text>
          </View>

          <View style={styles.keyInfo}>
            <Text style={styles.infoLabel}>Last Used</Text>
            <Text style={styles.infoValue}>
              {item.lastUsed ? formatDate(item.lastUsed) : 'Never used'}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.revokeButton}
            onPress={() => handleRevoke(item.keyHash, item.label)}
          >
            <Text style={styles.revokeButtonText}>Revoke Key</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [editingKeyHash, editLabel, handleLabelEdit, handleRevoke]
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>No API keys yet.</Text>
      <Text style={styles.emptySubtitle}>
        Generate one to connect your tools.
      </Text>
      <TouchableOpacity
        style={styles.generateButton}
        onPress={() => setShowGenerateModal(true)}
      >
        <Text style={styles.generateButtonText}>Generate Key</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>API Keys</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => setShowGenerateModal(true)}
        >
          <Text style={styles.headerButtonText}>+ New Key</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={keys}
        renderItem={renderKeyCard}
        keyExtractor={(item) => item.keyHash}
        contentContainerStyle={[
          styles.listContent,
          keys.length === 0 && styles.listContentEmpty,
        ]}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      />

      <KeyGenerationModal
        visible={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onKeyCreated={() => {
          // Listener auto-updates
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  headerButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
  },
  headerButtonText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.background,
  },
  listContent: {
    padding: theme.spacing.md,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  keyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  keyHeader: {
    marginBottom: theme.spacing.md,
  },
  keyHashContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  keyHash: {
    fontSize: theme.fontSize.md,
    fontFamily: 'Menlo',
    color: theme.colors.primary,
    fontWeight: '600',
  },
  statusBadge: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.borderRadius.sm,
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.background,
  },
  keyInfo: {
    marginBottom: theme.spacing.sm,
  },
  infoLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xxs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
  },
  editContainer: {
    marginTop: theme.spacing.xxs,
  },
  editInput: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  revokeButton: {
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  revokeButtonText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.error,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptySubtitle: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  generateButton: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
  },
  generateButtonText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.background,
  },
});

export default KeyManagementScreen;
