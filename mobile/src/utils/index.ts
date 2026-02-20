/**
 * Convert ISO 8601 timestamp to relative time string
 */
export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Get color for relay message type
 */
export function getMessageTypeColor(messageType: string): string {
  // Import theme colors inline to avoid circular deps
  const colors: Record<string, string> = {
    DIRECTIVE: '#7c3aed',
    RESULT: '#22c55e',
    STATUS: '#4b5563',
    QUERY: '#00d4ff',
    ACK: '#22c55e',
    HANDSHAKE: '#f59e0b',
    PING: '#00d4ff',
    PONG: '#00d4ff',
  };
  return colors[messageType] || '#4b5563';
}

/**
 * Get color for task status
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    created: '#f59e0b',
    active: '#00d4ff',
    done: '#22c55e',
    failed: '#ef4444',
    expired: '#4b5563',
  };
  return colors[status] || '#4b5563';
}

/**
 * Get color for program/session state
 */
export function getStateColor(state: string): string {
  const colors: Record<string, string> = {
    working: '#22c55e',
    blocked: '#ef4444',
    complete: '#00d4ff',
    pinned: '#f59e0b',
    offline: '#2a2a3a',
  };
  return colors[state] || '#4b5563';
}
