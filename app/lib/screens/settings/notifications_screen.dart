import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:app_settings/app_settings.dart';

import '../../providers/auth_provider.dart';
import '../../providers/notification_preferences_provider.dart';
import '../../services/haptic_service.dart';

String _formatHour(int hour) {
  final h = hour % 12 == 0 ? 12 : hour % 12;
  final amPm = hour < 12 ? 'AM' : 'PM';
  return '$h:00 $amPm';
}

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
                        'Push notifications let you respond to Claude\'s questions from anywhere.',
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
                  subtitle: const Text('When Claude asks you a question'),
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
                  subtitle: const Text('Progress updates from Claude'),
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

                const Divider(),

                // Dream notifications section
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Dream Mode',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),

                SwitchListTile(
                  secondary: const Icon(Icons.nightlight_round),
                  title: const Text('Dream Completions'),
                  subtitle: const Text('Morning reports when dreams finish'),
                  value: preferences.dreamCompletions,
                  onChanged: user == null ? null : (value) async {
                    HapticService.selection();
                    await ref.read(notificationPreferencesServiceProvider)
                        .updatePreferences(user.uid, dreamCompletions: value);
                  },
                ),

                SwitchListTile(
                  secondary: const Icon(Icons.account_balance_wallet),
                  title: const Text('Budget Warnings'),
                  subtitle: const Text('When dream budget hits 50%, 80%, 95%'),
                  value: preferences.dreamBudgetWarnings,
                  onChanged: user == null ? null : (value) async {
                    HapticService.selection();
                    await ref.read(notificationPreferencesServiceProvider)
                        .updatePreferences(user.uid, dreamBudgetWarnings: value);
                  },
                ),

                const Divider(),

                // Sprint notifications section
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Sprints',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),

                SwitchListTile(
                  secondary: const Icon(Icons.rocket_launch),
                  title: const Text('Sprint Updates'),
                  subtitle: const Text('Wave completions, sprint blocked, sprint done'),
                  value: preferences.sprintUpdates,
                  onChanged: user == null ? null : (value) async {
                    HapticService.selection();
                    await ref.read(notificationPreferencesServiceProvider)
                        .updatePreferences(user.uid, sprintUpdates: value);
                  },
                ),

                const Divider(),

                // Quiet Hours section
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Quiet Hours',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),

                SwitchListTile(
                  secondary: const Icon(Icons.do_not_disturb_on),
                  title: const Text('Enable Quiet Hours'),
                  subtitle: Text(
                    preferences.quietHoursEnabled
                        ? '${_formatHour(preferences.quietHoursStart)} – ${_formatHour(preferences.quietHoursEnd)}'
                        : 'Only high-priority notifications during quiet hours',
                  ),
                  value: preferences.quietHoursEnabled,
                  onChanged: user == null ? null : (value) async {
                    HapticService.selection();
                    await ref.read(notificationPreferencesServiceProvider)
                        .updatePreferences(user.uid, quietHoursEnabled: value);
                  },
                ),

                if (preferences.quietHoursEnabled) ...[
                  ListTile(
                    leading: const Icon(Icons.bedtime),
                    title: const Text('Start Time'),
                    trailing: Text(_formatHour(preferences.quietHoursStart)),
                    onTap: user == null ? null : () async {
                      final time = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay(hour: preferences.quietHoursStart, minute: 0),
                      );
                      if (time != null) {
                        await ref.read(notificationPreferencesServiceProvider)
                            .updatePreferences(user.uid, quietHoursStart: time.hour);
                      }
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.wb_sunny),
                    title: const Text('End Time'),
                    trailing: Text(_formatHour(preferences.quietHoursEnd)),
                    onTap: user == null ? null : () async {
                      final time = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay(hour: preferences.quietHoursEnd, minute: 0),
                      );
                      if (time != null) {
                        await ref.read(notificationPreferencesServiceProvider)
                            .updatePreferences(user.uid, quietHoursEnd: time.hour);
                      }
                    },
                  ),
                ],
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
