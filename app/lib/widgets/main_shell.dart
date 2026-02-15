import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/messages_provider.dart';
import '../services/haptic_service.dart';

/// Shell wrapper that provides persistent bottom nav for all authenticated routes
class MainShellWrapper extends ConsumerWidget {
  final Widget child;

  const MainShellWrapper({
    super.key,
    required this.child,
  });

  int _getSelectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    if (location.startsWith('/messages') || location.startsWith('/questions')) return 1;
    if (location.startsWith('/sessions')) return 3;
    if (location.startsWith('/search')) return 4;
    return 0; // Home and everything else
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedIndex = _getSelectedIndex(context);
    final pendingMessages = ref.watch(pendingMessagesProvider);
    final pendingCount = pendingMessages.valueOrNull?.length ?? 0;

    return Column(
      children: [
        Expanded(child: child),
        Container(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border(
              top: BorderSide(
                color: Theme.of(context).colorScheme.outlineVariant,
                width: 0.5,
              ),
            ),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _NavItem(
                    icon: Icons.home_outlined,
                    selectedIcon: Icons.home,
                    isSelected: selectedIndex == 0,
                    onTap: () {
                      HapticService.light();
                      context.go('/home');
                    },
                  ),
                  _NavItemWithBadge(
                    icon: Icons.inbox_outlined,
                    selectedIcon: Icons.inbox,
                    isSelected: selectedIndex == 1,
                    badgeCount: pendingCount,
                    onTap: () {
                      HapticService.light();
                      context.go('/messages');
                    },
                  ),
                  _ComposeButton(
                    onTap: () {
                      HapticService.medium();
                      context.push('/messages/new');
                    },
                  ),
                  _NavItem(
                    icon: Icons.terminal_outlined,
                    selectedIcon: Icons.terminal,
                    isSelected: selectedIndex == 3,
                    onTap: () {
                      HapticService.light();
                      context.go('/sessions');
                    },
                  ),
                  _NavItem(
                    icon: Icons.search_outlined,
                    selectedIcon: Icons.search,
                    isSelected: selectedIndex == 4,
                    onTap: () {
                      HapticService.light();
                      context.go('/search');
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData selectedIcon;
  final bool isSelected;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.selectedIcon,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 48,
        height: 48,
        child: Icon(
          isSelected ? selectedIcon : icon,
          size: 26,
          color: isSelected
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

class _ComposeButton extends StatelessWidget {
  final VoidCallback onTap;

  const _ComposeButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.add,
          size: 28,
          color: Theme.of(context).colorScheme.onPrimary,
        ),
      ),
    );
  }
}

class _NavItemWithBadge extends StatelessWidget {
  final IconData icon;
  final IconData selectedIcon;
  final bool isSelected;
  final int badgeCount;
  final VoidCallback onTap;

  const _NavItemWithBadge({
    required this.icon,
    required this.selectedIcon,
    required this.isSelected,
    required this.badgeCount,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 48,
        height: 48,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Center(
              child: Icon(
                isSelected ? selectedIcon : icon,
                size: 26,
                color: isSelected
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            if (badgeCount > 0)
              Positioned(
                right: 4,
                top: 4,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.error,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  constraints: const BoxConstraints(
                    minWidth: 18,
                    minHeight: 18,
                  ),
                  child: Center(
                    child: Text(
                      badgeCount > 99 ? '99+' : '$badgeCount',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onError,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// Keep old class for backwards compatibility during transition
class MainShell extends ConsumerWidget {
  final StatefulNavigationShell navigationShell;

  const MainShell({
    super.key,
    required this.navigationShell,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MainShellWrapper(child: navigationShell);
  }
}
