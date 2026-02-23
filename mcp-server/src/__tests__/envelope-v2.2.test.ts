/**
 * Envelope v2.2 Schema Version Tests
 * Verify schemaVersion field structure and backward compatibility
 */

import { Envelope } from '../types/envelope';

describe('Envelope v2.2 Schema Versioning', () => {
  describe('Interface Structure', () => {
    it('should allow documents with schemaVersion 2.2', () => {
      const envelope: Envelope = {
        source: 'iso',
        target: 'basher',
        priority: 'normal',
        action: 'queue',
        schemaVersion: '2.2',
      };

      expect(envelope.schemaVersion).toBe('2.2');
    });

    it('should allow documents with schemaVersion 2.1', () => {
      const envelope: Envelope = {
        source: 'iso',
        target: 'basher',
        priority: 'normal',
        action: 'queue',
        schemaVersion: '2.1',
      };

      expect(envelope.schemaVersion).toBe('2.1');
    });

    it('should allow documents without schemaVersion (backward compat)', () => {
      const envelope: Envelope = {
        source: 'iso',
        target: 'basher',
        priority: 'normal',
        action: 'queue',
      };

      // schemaVersion is optional, so undefined is valid
      expect(envelope.schemaVersion).toBeUndefined();
    });

    it('should allow all envelope fields with schemaVersion', () => {
      const fullEnvelope: Envelope = {
        source: 'iso',
        target: 'basher',
        priority: 'high',
        action: 'interrupt',
        schemaVersion: '2.2',
        ttl: 3600,
        replyTo: 'msg-123',
        threadId: 'thread-456',
        provenance: {
          model: 'claude-opus-4',
          cost_tokens: 1000,
          confidence: 0.95,
        },
        fallback: ['quorra', 'alan'],
      };

      expect(fullEnvelope.schemaVersion).toBe('2.2');
      expect(fullEnvelope.ttl).toBe(3600);
      expect(fullEnvelope.provenance?.model).toBe('claude-opus-4');
    });
  });

  describe('Version Semantics', () => {
    it('v2.1 represents pre-Phase 4 documents', () => {
      // Documents created before Phase 4 will have no schemaVersion,
      // which is semantically equivalent to v2.1
      const legacyDoc: Envelope = {
        source: 'iso',
        target: 'basher',
        priority: 'normal',
        action: 'queue',
      };

      // No schemaVersion = v2.1 semantics
      expect(legacyDoc.schemaVersion).toBeUndefined();
    });

    it('v2.2 represents Phase 4+ documents with schema versioning', () => {
      // All new documents created in Phase 4+ should have schemaVersion: '2.2'
      const newDoc: Envelope = {
        source: 'iso',
        target: 'basher',
        priority: 'normal',
        action: 'queue',
        schemaVersion: '2.2',
      };

      expect(newDoc.schemaVersion).toBe('2.2');
    });
  });

  describe('Read Path Compatibility', () => {
    it('should read documents without requiring schemaVersion', () => {
      // Reading code should not break when encountering documents
      // without schemaVersion field
      const documents: Envelope[] = [
        // Legacy document (no version)
        {
          source: 'iso',
          target: 'basher',
          priority: 'normal',
          action: 'queue',
        },
        // v2.1 explicit
        {
          source: 'quorra',
          target: 'alan',
          priority: 'high',
          action: 'sprint',
          schemaVersion: '2.1',
        },
        // v2.2 (current)
        {
          source: 'radia',
          target: 'iso',
          priority: 'low',
          action: 'backlog',
          schemaVersion: '2.2',
        },
      ];

      // All documents should be readable
      documents.forEach(doc => {
        expect(doc.source).toBeDefined();
        expect(doc.target).toBeDefined();
        expect(doc.priority).toBeDefined();
        expect(doc.action).toBeDefined();
      });
    });
  });

  describe('Future Extension', () => {
    it('schemaVersion field enables future migrations', () => {
      // The schemaVersion field is informational for now,
      // but enables future schema migrations and deprecation cycles
      
      // Example: In future, we could add v2.3 with breaking changes
      // and use schemaVersion to route through different handlers
      const futureDoc = {
        source: 'iso',
        target: 'basher',
        priority: 'normal' as const,
        action: 'queue' as const,
        schemaVersion: '2.2' as const,
      };

      // Handler logic could be: if (doc.schemaVersion === '2.1') { ... }
      expect(futureDoc.schemaVersion).toBe('2.2');
    });
  });
});
