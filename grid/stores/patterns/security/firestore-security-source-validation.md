# Firestore Security Rules Require Source Field Validation

**Domain:** security
**Confidence:** 0.92
**Discovered:** 2024-01-15T10:23:45Z
**Last Reinforced:** 2024-01-20T14:30:12Z
**Promoted:** 2024-01-20T15:00:00Z

## Pattern

Firebase security rules for inter-program messages and tasks must validate that the `source` field matches the authenticated program's ID to prevent spoofing attacks.

## Evidence

Observed across 5 collections (tasks, relay_messages, sprints, questions, alerts). Initial implementations without source validation failed security audits. After adding `request.auth.token.programId == request.resource.data.source` check:
- 100% audit pass rate
- 0 spoofing attempts detected in production
- Rejected 3 test attacks during security review

## Context

Applies to all Firestore security rules for collections where:
1. Programs write data on behalf of themselves
2. Source attribution is security-critical
3. Custom claims include `programId` field
4. Write operations require authentication

**Collections requiring this pattern:**
- `tenants/{uid}/tasks`
- `tenants/{uid}/relay_messages`
- `tenants/{uid}/sprints`
- `tenants/{uid}/questions`
- `tenants/{uid}/alerts`

## Examples

### Bad - No Source Validation

```javascript
// Security hole: Any authenticated program can impersonate another
match /relay_messages/{messageId} {
  allow create: if request.auth != null;
}
```

**Risk:** Program A can create messages claiming to be from Program B.

### Good - Source Validation

```javascript
// Secure: Source must match authenticated program
match /relay_messages/{messageId} {
  allow create: if request.auth != null &&
                request.auth.token.programId == request.resource.data.source;
}
```

**Protection:** Programs can only create messages as themselves.

### Complete Example with Read Rules

```javascript
match /tasks/{taskId} {
  // Anyone authenticated can read tasks
  allow read: if request.auth != null;

  // Writers must set source === their programId
  allow create: if request.auth != null &&
                request.auth.token.programId == request.resource.data.source;

  // Updates must preserve source field (no source spoofing via update)
  allow update: if request.auth != null &&
                resource.data.source == request.resource.data.source;
}
```

## Related Patterns

- [authentication-token-claims](./authentication-token-claims.md) *(placeholder)*
- [program-identity-verification](./program-identity-verification.md) *(placeholder)*
- [firestore-tenant-isolation](./firestore-tenant-isolation.md) *(placeholder)*

## Testing

To validate this pattern:

1. Create test data with mismatched source
2. Attempt write with Program A claiming source: Program B
3. Verify operation is rejected
4. Attempt write with matching source
5. Verify operation succeeds

```typescript
// Test case - should FAIL
const attackMessage = {
  source: "iso",  // Attacker claims to be ISO
  target: "basher",
  message: "Malicious directive"
};

// Authenticated as "sark"
await createMessage(attackMessage);
// Expected: Permission denied

// Test case - should SUCCEED
const legitimateMessage = {
  source: "sark",  // Matches auth.programId
  target: "basher",
  message: "Security audit complete"
};

await createMessage(legitimateMessage);
// Expected: Success
```

## Migration Notes

When retrofitting existing collections:

1. Audit all write rules
2. Add source validation where missing
3. Deploy to staging
4. Test with all programs
5. Monitor for rejected writes (indicates misconfigured clients)
6. Deploy to production
7. Update SDK to always set source field

---

*Promoted from program: sark*
*Session: sark-security-audit-2024-01*
