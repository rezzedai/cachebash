import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:app_settings/app_settings.dart';

import '../../providers/auth_provider.dart';
import '../../providers/notification_preferences_provider.dart';
import '../../services/haptic_service.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferencesAsync = ref.watch(notificationPreferencesProvider);
    final user = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/settings'),
        ),
      ),
      body: ListView(
        children: [
          // Info card
          Padding(
            padding: const EdgeInsets.all(16),
            child: Card(
              color: Theme.of(context).colorScheme.primaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Push notifications let you respond to agent questions from anywhere.',
                        style: TextStyle(
                          color:
                              Theme.of(context).colorScheme.onPrimaryContainer,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          const Divider(),

          // System settings
          ListTile(
            leading: const Icon(Icons.settings),
            title: const Text('System Notification Settings'),
            subtitle: const Text('Manage permissions in iOS Settings'),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => AppSettings.openAppSettings(
              type: AppSettingsType.notification,
            ),
          ),

          const Divider(),

          // Notification types section
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              'Notification Types',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
            ),
          ),

          preferencesAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, stack) => Padding(
              padding: const EdgeInsets.all(16),
              child: Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Icon(
                        Icons.error_outline,
                        color: Theme.of(context).colorScheme.onErrorContainer,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Failed to load preferences: $error',
                          style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.onErrorContainer,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            data: (preferences) => Column(
              children: [
                SwitchListTile(
                  secondary: const Icon(Icons.help_outline),
                  title: const Text('New Questions'),
                  subtitle: const Text('When the agent asks you a question'),
                  value: preferences.newQuestions,
                  onChanged: user == null
                      ? null
                      : (value) async {
                          HapticService.selection();
                          await ref
                              .read(notificationPreferencesServiceProvider)
                              .updatePreferences(
                                user.uid,
                                newQuestions: value,
                              );
                        },
                ),

                SwitchListTile(
                  secondary: const Icon(Icons.update),
                  title: const Text('Session Updates'),
                  subtitle: const Text('Progress updates from agent'),
                  value: preferences.sessionUpdates,
                  onChanged: user == null
                      ? null
                      : (value) async {
                          HapticService.selection();
                          await ref
                              .read(notificationPreferencesServiceProvider)
                              .updatePreferences(
                                user.uid,
                                sessionUpdates: value,
                              );
                        },
                ),

                SwitchListTile(
                  secondary: const Icon(Icons.priority_high),
                  title: const Text('High Priority Only'),
                  subtitle: const Text('Only notify for urgent questions'),
                  value: preferences.highPriorityOnly,
                  onChanged: user == null
                      ? null
                      : (value) async {
                          HapticService.selection();
                          await ref
                              .read(notificationPreferencesServiceProvider)
                              .updatePreferences(
                                user.uid,
                                highPriorityOnly: value,
                              );
                        },
                ),
              ],
            ),
          ),

          const Divider(),

          // Sound & Vibration (controlled by iOS/Android system settings)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              'Sound & Vibration',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
            ),
          ),

          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Sound and vibration settings are managed in your device\'s system settings.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ),

          ListTile(
            leading: const Icon(Icons.volume_up),
            title: const Text('Configure Sound & Vibration'),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => AppSettings.openAppSettings(
              type: AppSettingsType.notification,
            ),
          ),

          const SizedBox(height: 32),
        ],
      ),
    );
  }
}
