import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import {
  requestNotificationPermissions,
  getNotificationPermissionStatus,
  scheduleLocalNotification,
  classifyNotificationTier,
  shouldNotify,
  setBadgeCount,
  dismissAllNotifications,
  getDevicePushToken,
} from '../services/notifications';
import { navigate } from '../utils/navigationRef';
import { NotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES, NotificationTier } from '../types';

const PREFS_STORAGE_KEY = 'notification_preferences';

interface NotificationContextType {
  permissionStatus: string;
  preferences: NotificationPreferences;
  updatePreferences: (updates: Partial<NotificationPreferences>) => Promise<void>;
  requestPermissions: () => Promise<boolean>;
  notifyNewTask: (task: { id: string; title: string; type?: string; priority?: string; source?: string }) => Promise<void>;
  notifyNewMessage: (message: { id: string; source: string; message: string; message_type?: string; priority?: string }) => Promise<void>;
  isAppActive: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

interface NotificationProviderProps {
  children: ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const [permissionStatus, setPermissionStatus] = useState<string>('undetermined');
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isAppActive, setIsAppActive] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  // Load preferences from storage
  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const stored = await AsyncStorage.getItem(PREFS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...parsed, critical: true });
        }
      } catch (e) {
        console.warn('Failed to load notification preferences:', e);
      }
    };

    const loadPermission = async () => {
      const status = await getNotificationPermissionStatus();
      setPermissionStatus(status);
    };

    loadPrefs();
    loadPermission();
  }, []);

  // Track app state for notification decisions
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      setIsAppActive(nextState === 'active');

      // Clear badge when app comes to foreground
      if (nextState === 'active') {
        dismissAllNotifications();
      }
    });

    return () => subscription.remove();
  }, []);

  // Handle notification tap — navigate to relevant screen
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;

      if (data.type === 'task' && data.taskId) {
        // Navigate to task detail — need to go to Tasks tab first
        navigate('Tasks', { screen: 'TaskDetail', params: { task: data.task } });
      } else if (data.type === 'message' && data.programId) {
        // Navigate to channel detail
        navigate('Messages', { screen: 'ChannelDetail', params: { programId: data.programId } });
      }
    });

    return () => subscription.remove();
  }, []);

  // Register device push token for FCM push notifications
  useEffect(() => {
    if (permissionStatus !== 'granted') return;

    let tokenSubscription: Notifications.Subscription | null = null;

    const registerToken = async (tokenData: string) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      try {
        // Use a stable device ID based on platform
        const deviceId = `${Platform.OS}-${tokenData.slice(-12)}`;
        await setDoc(doc(db, `tenants/${uid}/devices/${deviceId}`), {
          fcmToken: tokenData,
          platform: Platform.OS,
          lastUpdated: serverTimestamp(),
        });
        console.log('Push token registered successfully');
      } catch (error) {
        console.warn('Failed to register push token:', error);
      }
    };

    const setupPushToken = async () => {
      // Get initial token
      const token = await getDevicePushToken();
      if (token) {
        await registerToken(token);
      }

      // Listen for token refreshes
      tokenSubscription = Notifications.addPushTokenListener((event) => {
        if (event.data) {
          registerToken(event.data as string);
        }
      });
    };

    setupPushToken();

    return () => {
      tokenSubscription?.remove();
    };
  }, [permissionStatus]);

  // Handle incoming push notifications when app is in foreground
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      // Push notifications from FCM have a remote trigger
      const trigger = notification.request.trigger;
      const isPush = trigger && 'type' in trigger && trigger.type === 'push';

      if (isPush) {
        const data = notification.request.content.data || {};
        const tier = classifyNotificationTier({
          type: data.type as string,
          priority: data.priority as string,
          message_type: data.message_type as string,
        });

        // Show foreground notification for all allowed tiers (not just critical)
        if (shouldNotify(tier, preferences)) {
          scheduleLocalNotification(
            notification.request.content.title || 'CacheBash',
            notification.request.content.body || '',
            data as Record<string, unknown>,
            tier
          );
        }
      }
    });

    return () => subscription.remove();
  }, [preferences]);

  const updatePreferences = useCallback(async (updates: Partial<NotificationPreferences>) => {
    const newPrefs = { ...preferences, ...updates, critical: true }; // Critical always true
    setPreferences(newPrefs);
    try {
      await AsyncStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(newPrefs));
    } catch (e) {
      console.warn('Failed to save notification preferences:', e);
    }
  }, [preferences]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const granted = await requestNotificationPermissions();
    const status = await getNotificationPermissionStatus();
    setPermissionStatus(status);
    return granted;
  }, []);

  // Notify about a new task (called from useTasks hook)
  const notifyNewTask = useCallback(async (task: {
    id: string;
    title: string;
    type?: string;
    priority?: string;
    source?: string;
  }) => {
    // Skip if already notified
    if (notifiedIdsRef.current.has(task.id)) return;
    notifiedIdsRef.current.add(task.id);

    // Cap the set size to prevent memory leak
    if (notifiedIdsRef.current.size > 500) {
      const arr = Array.from(notifiedIdsRef.current);
      notifiedIdsRef.current = new Set(arr.slice(-250));
    }

    // Only notify when app is in background
    if (appStateRef.current === 'active') return;

    // Check permission
    if (permissionStatus !== 'granted') return;

    const tier = classifyNotificationTier({ type: task.type, priority: task.priority });
    if (!shouldNotify(tier, preferences)) return;

    const title = task.type === 'question' ? 'New Question' : 'New Task';
    const body = task.title;

    await scheduleLocalNotification(title, body, {
      type: 'task',
      taskId: task.id,
      task,
    }, tier);

    await setBadgeCount(1);
  }, [permissionStatus, preferences]);

  // Notify about a new message (called from useMessages hook)
  const notifyNewMessage = useCallback(async (message: {
    id: string;
    source: string;
    message: string;
    message_type?: string;
    priority?: string;
  }) => {
    // Skip if already notified
    if (notifiedIdsRef.current.has(message.id)) return;
    notifiedIdsRef.current.add(message.id);

    // Cap set size
    if (notifiedIdsRef.current.size > 500) {
      const arr = Array.from(notifiedIdsRef.current);
      notifiedIdsRef.current = new Set(arr.slice(-250));
    }

    // Only notify when app is in background
    if (appStateRef.current === 'active') return;

    // Check permission
    if (permissionStatus !== 'granted') return;

    const tier = classifyNotificationTier({ message_type: message.message_type, priority: message.priority });
    if (!shouldNotify(tier, preferences)) return;

    const title = `${(message.source || 'Unknown').toUpperCase()}`;
    const body = message.message.length > 100
      ? message.message.slice(0, 100) + '...'
      : message.message;

    // Determine the conversation partner for navigation
    const programId = message.source === 'orchestrator' || message.source === 'admin'
      ? 'orchestrator'
      : message.source;

    await scheduleLocalNotification(title, body, {
      type: 'message',
      messageId: message.id,
      programId,
    }, tier);

    await setBadgeCount(1);
  }, [permissionStatus, preferences]);

  const value: NotificationContextType = {
    permissionStatus,
    preferences,
    updatePreferences,
    requestPermissions,
    notifyNewTask,
    notifyNewMessage,
    isAppActive,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextType {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
