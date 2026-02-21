import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'providers/auth_provider.dart';
import 'services/fcm_service.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/auth/api_key_screen.dart';
import 'screens/channels/channel_list_screen.dart';
import 'screens/channels/channel_detail_screen.dart';
import 'screens/activity/activity_screen.dart';
import 'screens/questions/question_detail_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'screens/settings/profile_screen.dart';
import 'screens/settings/change_password_screen.dart';
import 'screens/settings/delete_account_screen.dart';
import 'screens/settings/notifications_screen.dart';
import 'screens/sessions/session_detail_screen.dart';
import 'screens/sprints/sprint_dashboard_screen.dart';
import 'screens/sprints/add_to_sprint_screen.dart';
import 'screens/dreams/activate_dream_screen.dart';
import 'screens/dreams/dream_detail_screen.dart';
import 'screens/feedback/feedback_screen.dart';
import 'theme/app_theme.dart';
import 'widgets/main_shell.dart';

// Navigator keys for shell routing
final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/login',
    redirect: (context, state) {
      final isLoggedIn = authState.valueOrNull != null;
      final isAuthRoute = state.matchedLocation == '/login' ||
          state.matchedLocation == '/register';

      if (!isLoggedIn && !isAuthRoute) {
        return '/login';
      }
      if (isLoggedIn && isAuthRoute) {
        return '/channels';
      }
      return null;
    },
    routes: [
      // Auth routes (no bottom nav)
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/api-key',
        builder: (context, state) => const ApiKeyScreen(),
      ),

      // Main shell with bottom nav - ALL authenticated routes go here
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) {
          return MainShellWrapper(child: child);
        },
        routes: [
          // Channels - main tab
          GoRoute(
            path: '/channels',
            builder: (context, state) => const ChannelListScreen(),
          ),
          GoRoute(
            path: '/channels/:programId',
            builder: (context, state) {
              final programId = state.pathParameters['programId']!;
              return ChannelDetailScreen(programId: programId);
            },
          ),
          
          // Activity - second tab
          GoRoute(
            path: '/activity',
            builder: (context, state) => const ActivityScreen(),
          ),
          
          // Redirects from old routes
          GoRoute(
            path: '/home',
            redirect: (context, state) => '/channels',
          ),
          GoRoute(
            path: '/messages',
            redirect: (context, state) => '/channels',
          ),
          
          // Deep link routes that are still needed
          GoRoute(
            path: '/questions/:id',
            builder: (context, state) {
              final questionId = state.pathParameters['id']!;
              return QuestionDetailScreen(questionId: questionId);
            },
          ),
          GoRoute(
            path: '/sessions/:id',
            builder: (context, state) {
              final sessionId = state.pathParameters['id']!;
              return SessionDetailScreen(sessionId: sessionId);
            },
          ),
          
          // Sprints
          GoRoute(
            path: '/sprints/:id',
            builder: (context, state) {
              final sprintId = state.pathParameters['id']!;
              return SprintDashboardScreen(sprintId: sprintId);
            },
          ),
          GoRoute(
            path: '/sprints/:id/add-story',
            builder: (context, state) {
              final sprintId = state.pathParameters['id']!;
              return AddToSprintScreen(sprintId: sprintId);
            },
          ),
          
          // Settings - third tab
          GoRoute(
            path: '/settings',
            builder: (context, state) => const SettingsScreen(),
          ),
          GoRoute(
            path: '/settings/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/settings/change-password',
            builder: (context, state) => const ChangePasswordScreen(),
          ),
          GoRoute(
            path: '/settings/delete-account',
            builder: (context, state) => const DeleteAccountScreen(),
          ),
          GoRoute(
            path: '/settings/notifications',
            builder: (context, state) => const NotificationsScreen(),
          ),
          
          // Dreams
          GoRoute(
            path: '/dreams/new',
            builder: (context, state) => const ActivateDreamScreen(),
          ),
          GoRoute(
            path: '/dreams/:id',
            builder: (context, state) {
              final dreamId = state.pathParameters['id']!;
              return DreamDetailScreen(dreamId: dreamId);
            },
          ),
          
          // Feedback
          GoRoute(
            path: '/feedback',
            builder: (context, state) => const FeedbackScreen(),
          ),
        ],
      ),
    ],
  );
});

class CacheBashApp extends ConsumerStatefulWidget {
  const CacheBashApp({super.key});

  @override
  ConsumerState<CacheBashApp> createState() => _CacheBashAppState();
}

class _CacheBashAppState extends ConsumerState<CacheBashApp> {
  bool _fcmInitialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();

    // Initialize FCM with router after the first build
    if (!_fcmInitialized) {
      _fcmInitialized = true;
      final router = ref.read(routerProvider);
      FcmService.instance.initialize(router: router);
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'CacheBash',
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.dark,
      routerConfig: router,
    );
  }
}
