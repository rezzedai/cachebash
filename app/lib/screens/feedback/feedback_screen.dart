import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/feedback_service.dart';
import '../../services/haptic_service.dart';

void _log(String message) {
  debugPrint('[FeedbackScreen] $message');
}

class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _formKey = GlobalKey<FormState>();
  final _messageController = TextEditingController();
  final _feedbackService = FeedbackService();
  final _imagePicker = ImagePicker();
  final _maxLength = 2000;

  String _feedbackType = 'general';
  bool _isSubmitting = false;
  String? _screenshotPath;
  bool _isSuccess = false;
  String? _githubIssueUrl;
  int? _githubIssueNumber;

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  void _dismissKeyboard() {
    FocusScope.of(context).unfocus();
  }

  Future<void> _pickScreenshot() async {
    HapticService.light();
    _dismissKeyboard();

    try {
      // Show a bottom sheet to choose camera or gallery
      final source = await showModalBottomSheet<ImageSource>(
        context: context,
        builder: (context) => SafeArea(
          child: Wrap(
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera),
                title: const Text('Take Photo'),
                onTap: () => Navigator.pop(context, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library),
                title: const Text('Choose from Gallery'),
                onTap: () => Navigator.pop(context, ImageSource.gallery),
              ),
            ],
          ),
        ),
      );

      if (source == null) return;

      final image = await _imagePicker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );

      if (image != null && mounted) {
        setState(() {
          _screenshotPath = image.path;
        });
        HapticService.success();
      }
    } catch (e) {
      _log('Error picking image: $e');
      if (mounted) {
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to pick image: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  void _removeScreenshot() {
    HapticService.light();
    setState(() {
      _screenshotPath = null;
    });
  }

  Future<void> _submitFeedback() async {
    if (!_formKey.currentState!.validate()) {
      HapticService.error();
      return;
    }

    setState(() => _isSubmitting = true);
    HapticService.medium();
    _dismissKeyboard();

    try {
      _log('Submitting feedback: type=$_feedbackType, hasScreenshot=${_screenshotPath != null}');

      final result = await _feedbackService.submitFeedback(
        type: _feedbackType,
        message: _messageController.text.trim(),
        screenshotPath: _screenshotPath,
      );

      _log('Feedback submission result: $result');

      if (mounted) {
        final success = result['success'] == true;
        if (success) {
          HapticService.success();
          setState(() {
            _isSuccess = true;
            _githubIssueUrl = result['issueUrl'];
            _githubIssueNumber = result['issueNumber'];
          });
        } else {
          throw Exception(result['error'] ?? 'Unknown error');
        }
      }
    } catch (e) {
      _log('Error submitting feedback: $e');
      if (mounted) {
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to submit: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
            action: SnackBarAction(
              label: 'Retry',
              onPressed: _submitFeedback,
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _openGitHubIssue() async {
    if (_githubIssueUrl == null) return;

    HapticService.light();
    try {
      final uri = Uri.parse(_githubIssueUrl!);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      _log('Error opening GitHub issue: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
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
        body: _isSuccess ? _buildSuccessView() : _buildFormView(),
      ),
    );
  }

  Widget _buildSuccessView() {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.check_circle,
              size: 64,
              color: Colors.green,
            ),
            const SizedBox(height: 24),
            Text(
              'Thanks!',
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Your feedback helps us improve CacheBash.',
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
            if (_githubIssueUrl != null) ...[
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: _openGitHubIssue,
                icon: const Icon(Icons.open_in_new),
                label: Text('View Issue #${_githubIssueNumber ?? ''}'),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () {
                HapticService.light();
                Navigator.of(context).pop();
              },
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 12, horizontal: 24),
                child: Text('Done'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFormView() {
    final remaining = _maxLength - _messageController.text.length;

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Header
          Icon(
            Icons.feedback_outlined,
            size: 48,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 16),
          Text(
            'We\'d love to hear from you!',
            style: Theme.of(context).textTheme.headlineSmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            'Your feedback helps us improve CacheBash.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),

          // Feedback type
          Text(
            'Type of feedback',
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(
                value: 'bug',
                label: Text('Bug Report'),
              ),
              ButtonSegment(
                value: 'feature_request',
                label: Text('Feature'),
              ),
              ButtonSegment(
                value: 'general',
                label: Text('General'),
              ),
            ],
            selected: {_feedbackType},
            onSelectionChanged: (selection) {
              HapticService.selection();
              setState(() => _feedbackType = selection.first);
            },
          ),
          const SizedBox(height: 24),

          // Message
          Text(
            'Your message',
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _messageController,
            maxLength: _maxLength,
            maxLines: 6,
            enabled: !_isSubmitting,
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

          // Screenshot attachment
          if (_screenshotPath == null) ...[
            OutlinedButton.icon(
              onPressed: _isSubmitting ? null : _pickScreenshot,
              icon: const Icon(Icons.attach_file),
              label: const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('Attach Screenshot'),
              ),
            ),
          ] else ...[
            Text(
              'Screenshot',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 8),
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.file(
                    File(_screenshotPath!),
                    height: 150,
                    width: double.infinity,
                    fit: BoxFit.cover,
                  ),
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: CircleAvatar(
                    backgroundColor: Colors.black54,
                    child: IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: _isSubmitting ? null : _removeScreenshot,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 24),

          // Submit button
          FilledButton.icon(
            onPressed: _isSubmitting ? null : _submitFeedback,
            icon: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.send),
            label: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(_isSubmitting ? 'Sending...' : 'Send Feedback'),
            ),
          ),
          const SizedBox(height: 16),

          // Privacy note
          Text(
            'Your feedback is reviewed by the CacheBash team and may result in a GitHub issue being created.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
