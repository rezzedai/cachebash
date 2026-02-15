import 'package:flutter_riverpod/flutter_riverpod.dart';

/// State for multi-select mode
class SelectionState {
  final bool isSelecting;
  final Set<String> selectedIds;

  const SelectionState({
    this.isSelecting = false,
    this.selectedIds = const {},
  });

  SelectionState copyWith({
    bool? isSelecting,
    Set<String>? selectedIds,
  }) {
    return SelectionState(
      isSelecting: isSelecting ?? this.isSelecting,
      selectedIds: selectedIds ?? this.selectedIds,
    );
  }

  int get selectedCount => selectedIds.length;
  bool get hasSelection => selectedIds.isNotEmpty;

  bool isSelected(String id) => selectedIds.contains(id);
}

/// Notifier for managing selection state
class SelectionNotifier extends StateNotifier<SelectionState> {
  SelectionNotifier() : super(const SelectionState());

  void enterSelectionMode() {
    state = state.copyWith(isSelecting: true);
  }

  void exitSelectionMode() {
    state = const SelectionState();
  }

  void toggleSelection(String id) {
    final newSelection = Set<String>.from(state.selectedIds);
    if (newSelection.contains(id)) {
      newSelection.remove(id);
    } else {
      newSelection.add(id);
    }
    state = state.copyWith(selectedIds: newSelection);
  }

  void selectAll(List<String> ids) {
    state = state.copyWith(selectedIds: ids.toSet());
  }

  void clearSelection() {
    state = state.copyWith(selectedIds: {});
  }
}

/// Provider for questions selection
final questionsSelectionProvider =
    StateNotifierProvider<SelectionNotifier, SelectionState>((ref) {
  return SelectionNotifier();
});

/// Provider for sessions selection
final sessionsSelectionProvider =
    StateNotifierProvider<SelectionNotifier, SelectionState>((ref) {
  return SelectionNotifier();
});

/// Provider for tasks selection
final tasksSelectionProvider =
    StateNotifierProvider<SelectionNotifier, SelectionState>((ref) {
  return SelectionNotifier();
});

/// Provider for messages selection (unified inbox)
final messagesSelectionProvider =
    StateNotifierProvider<SelectionNotifier, SelectionState>((ref) {
  return SelectionNotifier();
});
