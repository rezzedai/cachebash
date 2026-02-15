import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;

import '../../config/environment.dart';
import '../../providers/auth_provider.dart';
import '../../services/secure_storage_service.dart';

class ApiKeyScreen extends ConsumerStatefulWidget {
  const ApiKeyScreen({super.key});

  @override
  ConsumerState<ApiKeyScreen> createState() => _ApiKeyScreenState();
}

class _ApiKeyScreenState extends ConsumerState<ApiKeyScreen> {
  String? _apiKey;
  bool _isLoading = true;
  bool _showKey = false;
  bool _copied = false;
  bool _configCopied = false;
  bool _isTesting = false;
  String? _testResult;
  bool? _testSuccess;
  bool _isRestoring = false;

  /// Validates API key format before sending to server.
  /// API keys are base64url encoded 256-bit (32 byte) values = 43 chars (no padding) or 44 chars (with =).
  String? _validateApiKeyFormat(String key) {
    if (key.isEmpty) {
      return 'API key cannot be empty';
    }
    // Check length (43-44 chars for base64url encoded 32 bytes)
    if (key.length < 40 || key.length > 50) {
      return 'Invalid API key length (expected ~43 characters)';
    }
    // Check base64url character set (A-Za-z0-9_-=)
    final base64urlRegex = RegExp(r'^[A-Za-z0-9_\-+=]+$');
    if (!base64urlRegex.hasMatch(key)) {
      return 'Invalid API key format (contains invalid characters)';
    }
    return null; // Valid
  }

  @override
  void initState() {
    super.initState();
    _loadApiKey();
  }

  Future<void> _loadApiKey() async {
    final key = await ref.read(authNotifierProvider.notifier).getStoredApiKey();
    if (mounted) {
      setState(() {
        _apiKey = key;
        _isLoading = false;
      });
    }
  }

  Future<void> _restoreApiKey() async {
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Restore API Key'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Paste your existing API key to restore it. '
              'This is useful if you reinstalled the app or are setting up a new device.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'API Key',
                hintText: 'Paste your API key here',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Restore'),
          ),
        ],
      ),
    );

    if (confirmed == true && controller.text.isNotEmpty) {
      final apiKey = controller.text.trim();

      // Validate format before making network request
      final validationError = _validateApiKeyFormat(apiKey);
      if (validationError != null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(validationError),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }

      setState(() => _isRestoring = true);

      // Store the API key locally
      final user = ref.read(currentUserProvider);
      if (user != null) {
        try {
          // Validate the key by testing connection
          final testResponse = await http.post(
            Uri.parse('${Environment.mcpBaseUrl}/v1/mcp'),
            headers: {
              'Authorization': 'Bearer $apiKey',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'jsonrpc': '2.0',
              'method': 'tools/list',
              'id': 1,
            }),
          ).timeout(const Duration(seconds: 10));

          if (testResponse.statusCode == 200) {
            // Key is valid, store it
            final secureStorage = SecureStorageService();
            await secureStorage.storeApiKey(apiKey);

            if (mounted) {
              setState(() {
                _apiKey = apiKey;
                _isRestoring = false;
                _showKey = true;
              });
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('API key restored successfully!'),
                  backgroundColor: Colors.green,
                ),
              );
            }
          } else {
            if (mounted) {
              setState(() => _isRestoring = false);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Invalid API key (status ${testResponse.statusCode})'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          }
        } catch (e) {
          if (mounted) {
            setState(() => _isRestoring = false);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Error: ${e.toString().split('\n').first}'),
                backgroundColor: Colors.red,
              ),
            );
          }
        }
      }
    }
  }

  Future<void> _regenerateKey() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Regenerate API Key?'),
        content: const Text(
          'This will invalidate your current API key. '
          'You will need to update your Claude Code MCP configuration.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Regenerate'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      setState(() => _isLoading = true);
      final user = ref.read(currentUserProvider);
      if (user != null) {
        final newKey = await ref
            .read(authNotifierProvider.notifier)
            .regenerateApiKey(user.uid);
        if (mounted && newKey != null) {
          setState(() {
            _apiKey = newKey;
            _isLoading = false;
            _showKey = true;
            _copied = false;
          });
        }
      }
    }
  }

  Future<void> _copyToClipboard() async {
    if (_apiKey == null) return;
    await Clipboard.setData(ClipboardData(text: _apiKey!));
    if (!mounted) return;
    setState(() => _copied = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('API key copied to clipboard'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  String _maskKey(String key) {
    if (key.length <= 8) return '********';
    return '${key.substring(0, 4)}${'*' * (key.length - 8)}${key.substring(key.length - 4)}';
  }

  Future<void> _copyConfig() async {
    if (_apiKey == null) return;
    final config = _getMcpConfigExample(_apiKey!);
    await Clipboard.setData(ClipboardData(text: config));
    if (!mounted) return;
    setState(() => _configCopied = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('MCP configuration copied to clipboard'),
        duration: Duration(seconds: 2),
      ),
    );
    // Reset after delay
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() => _configCopied = false);
      }
    });
  }

  Future<void> _testConnection() async {
    if (_apiKey == null) return;

    setState(() {
      _isTesting = true;
      _testResult = null;
      _testSuccess = null;
    });

    try {
      // Test the health endpoint (no auth required)
      final healthUrl = '${Environment.mcpBaseUrl}/v1/health';

      final healthResponse = await http
          .get(Uri.parse(healthUrl))
          .timeout(const Duration(seconds: 10));

      if (healthResponse.statusCode != 200) {
        setState(() {
          _isTesting = false;
          _testSuccess = false;
          _testResult = 'Server unavailable (status ${healthResponse.statusCode})';
        });
        return;
      }

      // Health check passed - server is reachable
      setState(() {
        _isTesting = false;
        _testSuccess = true;
        _testResult = 'Connection successful!';
      });
    } on TimeoutException {
      setState(() {
        _isTesting = false;
        _testSuccess = false;
        _testResult = 'Connection timed out';
      });
    } catch (e) {
      setState(() {
        _isTesting = false;
        _testSuccess = false;
        _testResult = 'Network error: ${e.toString().split('\n').first}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('API Key'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Info card
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                Icons.info_outline,
                                color: Theme.of(context).colorScheme.primary,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'About Your API Key',
                                style: Theme.of(context)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          const Text(
                            'Your API key connects Claude Code to this app. '
                            'Add it to your MCP configuration to receive notifications '
                            'and respond to questions from Claude.',
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),

                  // API Key display
                  Text(
                    'Your API Key',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Theme.of(context)
                          .colorScheme
                          .surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: Theme.of(context).colorScheme.outline,
                      ),
                    ),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: SelectableText(
                                _apiKey != null
                                    ? (_showKey
                                        ? _apiKey!
                                        : _maskKey(_apiKey!))
                                    : 'No API key found',
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            if (_apiKey != null) ...[
                              IconButton(
                                icon: Icon(
                                  _showKey
                                      ? Icons.visibility_off
                                      : Icons.visibility,
                                ),
                                onPressed: () {
                                  setState(() => _showKey = !_showKey);
                                },
                                tooltip: _showKey ? 'Hide' : 'Show',
                              ),
                              IconButton(
                                icon: Icon(
                                  _copied ? Icons.check : Icons.copy,
                                  color: _copied ? Colors.green : null,
                                ),
                                onPressed: _copyToClipboard,
                                tooltip: 'Copy',
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // MCP Configuration example
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'MCP Configuration',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      TextButton.icon(
                        onPressed: _copyConfig,
                        icon: Icon(
                          _configCopied ? Icons.check : Icons.copy,
                          size: 18,
                          color: _configCopied ? Colors.green : null,
                        ),
                        label: Text(_configCopied ? 'Copied!' : 'Copy'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SelectableText(
                      _getMcpConfigExample(_apiKey ?? 'YOUR_API_KEY'),
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Add this to ~/.config/claude/mcp.json',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                  const SizedBox(height: 24),

                  // Test Connection button
                  FilledButton.tonalIcon(
                    onPressed: _isTesting ? null : _testConnection,
                    icon: _isTesting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            _testSuccess == true
                                ? Icons.check_circle
                                : _testSuccess == false
                                    ? Icons.error
                                    : Icons.wifi_find,
                            color: _testSuccess == true
                                ? Colors.green
                                : _testSuccess == false
                                    ? Colors.red
                                    : null,
                          ),
                    label: Text(_isTesting ? 'Testing...' : 'Test Connection'),
                  ),
                  if (_testResult != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: _testSuccess == true
                            ? Colors.green.withValues(alpha: 0.1)
                            : Colors.red.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            _testSuccess == true
                                ? Icons.check_circle
                                : Icons.error,
                            size: 16,
                            color: _testSuccess == true
                                ? Colors.green
                                : Colors.red,
                          ),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Text(
                              _testResult!,
                              style: TextStyle(
                                color: _testSuccess == true
                                    ? Colors.green.shade700
                                    : Colors.red.shade700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 32),

                  // Restore button (shown prominently when no key exists)
                  if (_apiKey == null) ...[
                    FilledButton.icon(
                      onPressed: _isRestoring ? null : _restoreApiKey,
                      icon: _isRestoring
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.key),
                      label: Text(_isRestoring ? 'Restoring...' : 'Restore Existing API Key'),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Use this if you reinstalled the app or are on a new device',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Regenerate button
                  OutlinedButton.icon(
                    onPressed: _regenerateKey,
                    icon: const Icon(Icons.refresh),
                    label: Text(_apiKey == null ? 'Generate New API Key' : 'Regenerate API Key'),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _apiKey == null
                        ? 'Create a new API key (you\'ll need to update your MCP config)'
                        : 'Regenerating will invalidate your current key',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),

                  // Continue button (for new users)
                  FilledButton(
                    onPressed: () => context.go('/home'),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text('Continue to Dashboard'),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  String _getMcpConfigExample(String apiKey) {
    return """
{
  "mcpServers": {
    "cachebash": {
      "type": "http",
      "url": "${Environment.mcpBaseUrl}/v1/mcp",
      "headers": {
        "Authorization": "Bearer $apiKey"
      }
    }
  }
}""";
  }
}
