/// Utility class for input validation across the app.
class Validators {
  // Private constructor to prevent instantiation
  Validators._();

  /// RFC 5322 compliant email regex pattern.
  /// Covers most valid email formats while avoiding false positives.
  static final _emailRegex = RegExp(
    r'^[a-zA-Z0-9.!#$%&*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$',
  );

  /// Validates an email address.
  /// Returns null if valid, error message if invalid.
  static String? validateEmail(String? value) {
    if (value == null || value.isEmpty) {
      return 'Email is required';
    }

    final trimmed = value.trim();

    if (trimmed.length > 254) {
      return 'Email is too long (max 254 characters)';
    }

    if (!_emailRegex.hasMatch(trimmed)) {
      return 'Enter a valid email address';
    }

    // Check local part length (before @)
    final localPart = trimmed.split('@').first;
    if (localPart.length > 64) {
      return 'Email local part is too long (max 64 characters)';
    }

    return null; // Valid
  }

  /// Validates a password.
  /// Returns null if valid, error message if invalid.
  static String? validatePassword(String? value) {
    if (value == null || value.isEmpty) {
      return 'Password is required';
    }

    if (value.length < 8) {
      return 'Password must be at least 8 characters';
    }

    if (value.length > 128) {
      return 'Password is too long (max 128 characters)';
    }

    return null; // Valid
  }

  /// Validates that a field is not empty.
  /// Returns null if valid, error message if invalid.
  static String? validateRequired(String? value, [String fieldName = 'This field']) {
    if (value == null || value.trim().isEmpty) {
      return '$fieldName is required';
    }
    return null;
  }

  /// Validates a string has minimum length.
  /// Returns null if valid, error message if invalid.
  static String? validateMinLength(String? value, int minLength, [String fieldName = 'This field']) {
    if (value == null || value.length < minLength) {
      return '$fieldName must be at least $minLength characters';
    }
    return null;
  }

  /// Validates a string has maximum length.
  /// Returns null if valid, error message if invalid.
  static String? validateMaxLength(String? value, int maxLength, [String fieldName = 'This field']) {
    if (value != null && value.length > maxLength) {
      return '$fieldName cannot exceed $maxLength characters';
    }
    return null;
  }
}
