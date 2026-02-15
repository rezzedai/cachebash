/// Environment configuration for the CacheBash app.
///
/// Values can be overridden at build time using --dart-define:
/// flutter build --dart-define=MCP_BASE_URL=https://custom-url.com
class Environment {
  // Private constructor to prevent instantiation
  Environment._();

  /// Base URL for the CacheBash MCP server.
  /// Can be overridden with --dart-define=MCP_BASE_URL=...
  static const String mcpBaseUrl = String.fromEnvironment(
    'MCP_BASE_URL',
    defaultValue: 'https://cachebash-mcp-922749444863.us-central1.run.app',
  );

  /// Whether the app is running in debug mode.
  static const bool isDebug = bool.fromEnvironment('DEBUG', defaultValue: false);

  /// App version string (can be set at build time).
  static const String appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: '1.0.0',
  );
}
