import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../services/haptic_service.dart';

class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _formKey = GlobalKey<FormState>();
  final _feedbackController = TextEditingController();
  final _maxLength = 500;
  bool _isSubmitting = false;
  String _feedbackType = 'suggestion';

  @override
  void dispose() {
    _feedbackController.dispose();
    super.dispose();
  }

  void _dismissKeyboard() {
    FocusScope.of(context).unfocus();
  }

  Future<void> _submitFeedback() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSubmitting = true);
    HapticService.light();

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        throw Exception('Not authenticated');
      }

      await FirebaseFirestore.instance.collection('feedback').add({
        'userId': user.uid,
        'userEmail': user.email,
        'type': _feedbackType,
        'message': _feedbackController.text.trim(),
        'status': 'pending',
        'createdAt': FieldValue.serverTimestamp(),
        'platform': Theme.of(context).platform.name,
      });

      if (mounted) {
        HapticService.success();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Thank you for your feedback!'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to submit: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final remaining = _maxLength - _feedbackController.text.length;

    return GestureDetector(
      onTap: _dismissKeyboard,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Send Feedback'),
          leading: IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
        body: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Header
              Icon(
                Icons.feedback_outlined,
                size: 48,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(
                'We\'d love to hear from you!',
                style: theme.textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Your feedback helps us improve CacheBash.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),

              // Feedback type
              Text(
                'Type of feedback',
                style: theme.textTheme.labelLarge,
              ),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(
                    value: 'suggestion',
                    label: Text('Idea'),
                  ),
                  ButtonSegment(
                    value: 'bug',
                    label: Text('Bug'),
                  ),
                  ButtonSegment(
                    value: 'other',
                    label: Text('Other'),
                  ),
                ],
                selected: {_feedbackType},
                onSelectionChanged: (selection) {
                  setState(() => _feedbackType = selection.first);
                },
              ),
              const SizedBox(height: 24),

              // Feedback text
              Text(
                'Your feedback',
                style: theme.textTheme.labelLarge,
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _feedbackController,
                maxLength: _maxLength,
                maxLines: 6,
                decoration: InputDecoration(
                  hintText: 'Tell us what you think...',
                  border: const OutlineInputBorder(),
                  counterText: '$remaining characters remaining',
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Please enter your feedback';
                  }
                  if (value.trim().length < 10) {
                    return 'Please provide more detail (at least 10 characters)';
                  }
                  return null;
                },
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 24),

              // Submit button
              FilledButton.icon(
                onPressed: _isSubmitting ? null : _submitFeedback,
                icon: _isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send),
                label: Text(_isSubmitting ? 'Sending...' : 'Send Feedback'),
              ),
              const SizedBox(height: 16),

              // Privacy note
              Text(
                'Your feedback is reviewed by the CacheBash team to improve the app.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
