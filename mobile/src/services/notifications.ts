import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { NotificationTier, NotificationPreferences, RelayMessageType } from '../types';

// Configure notification handler (how notifications appear when app is in foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});

// Request notification permissions
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // Android 13+ needs runtime permission
    await Notifications.setNotificationChannelAsync('critical', {
      name: 'Critical Alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('operational', {
      name: 'Operational Updates',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('informational', {
      name: 'Informational',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return finalStatus === 'granted';
}

// Get current permission status
export async function getNotificationPermissionStatus(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// Schedule a local notification
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  tier: NotificationTier = 'operational'
): Promise<string | undefined> {
  try {
    const channelId = Platform.OS === 'android' ? tier : undefined;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: tier === 'critical' ? 'default' : undefined,
        ...(channelId ? { channelId } : {}),
      },
      trigger: null, // Fire immediately
    });

    return id;
  } catch (error) {
    console.warn('Failed to schedule notification:', error);
    return undefined;
  }
}

// Classify an item into a notification tier
// Per council synthesis:
// Critical: Questions, high-priority tasks, error alerts
// Operational: Task completions, sprint milestones, DIRECTIVE/RESULT messages
// Informational: Status updates, heartbeats, info alerts
// Suppressed: PING, PONG, HANDSHAKE, ACK
export function classifyNotificationTier(item: {
  type?: string;
  priority?: string;
  message_type?: string;
  status?: string;
}): NotificationTier {
  // Questions are always critical
  if (item.type === 'question') return 'critical';

  // High priority items are critical
  if (item.priority === 'high') return 'critical';

  // Suppressed message types
  const suppressedTypes: string[] = ['PING', 'PONG', 'HANDSHAKE', 'ACK'];
  if (item.message_type && suppressedTypes.includes(item.message_type)) {
    return 'suppressed';
  }

  // Operational message types
  const operationalTypes: string[] = ['DIRECTIVE', 'RESULT'];
  if (item.message_type && operationalTypes.includes(item.message_type)) {
    return 'operational';
  }

  // Informational message types
  if (item.message_type === 'STATUS' || item.message_type === 'QUERY') {
    return 'informational';
  }

  // Tasks default to operational
  if (item.type === 'task') return 'operational';

  return 'informational';
}

// Check if current time is within quiet hours
export function isQuietHours(preferences: NotificationPreferences): boolean {
  if (!preferences.quietHoursEnabled) return false;

  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  const [startH, startM] = preferences.quietHoursStart.split(':').map(Number);
  const [endH, endM] = preferences.quietHoursEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Handle overnight quiet hours (e.g., 23:00 - 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

// Determine if a notification should be shown based on preferences and tier
export function shouldNotify(
  tier: NotificationTier,
  preferences: NotificationPreferences
): boolean {
  // Suppressed tier never notifies
  if (tier === 'suppressed') return false;

  // Critical always notifies (bypasses quiet hours)
  if (tier === 'critical') return true;

  // Check if tier is enabled
  if (tier === 'operational' && !preferences.operational) return false;
  if (tier === 'informational' && !preferences.informational) return false;

  // Check quiet hours for non-critical
  if (isQuietHours(preferences)) return false;

  return true;
}

// Get badge count (number of unhandled notifications)
export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

// Set badge count
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

// Dismiss all notifications
export async function dismissAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
  await setBadgeCount(0);
}
