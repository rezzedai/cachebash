/**
 * Tenant Resolver — Ensures all auth paths converge to a canonical UID.
 *
 * Firebase Auth creates separate UIDs per sign-in method. This module
 * resolves any known alternate UID to the canonical one, so all downstream
 * Firestore reads/writes use a single tenant path.
 *
 * Firestore collection: canonical_accounts/{email_hash}
 */

import * as crypto from "crypto";
import type { Firestore } from "firebase-admin/firestore";

export interface TenantResolution {
  tenantId: string;
  canonical: boolean;
  mergedFrom?: string;
}

// In-memory cache to avoid repeated Firestore lookups.
// Maps alternateUid -> canonicalUid.
const uidCache = new Map<string, string>();

// Cache of UIDs known to be canonical (no lookup needed).
const canonicalCache = new Set<string>();

// Cache TTL: 5 minutes (rebuild on deploy).
const CACHE_TTL_MS = 5 * 60 * 1000;
let cacheBuiltAt = 0;

function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

/**
 * Build the UID resolution cache from canonical_accounts collection.
 * Called lazily on first resolution, then refreshed after TTL expires.
 */
async function buildCache(db: Firestore): Promise<void> {
  try {
    const snapshot = await db.collection("canonical_accounts").get();
    uidCache.clear();
    canonicalCache.clear();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const canonicalUid = data.canonicalUid as string;
      const alternateUids = (data.alternateUids as string[]) || [];

      canonicalCache.add(canonicalUid);
      for (const alt of alternateUids) {
        uidCache.set(alt, canonicalUid);
      }
    }
    cacheBuiltAt = Date.now();
  } catch (err) {
    console.error("[TenantResolver] Failed to build cache:", err);
  }
}

/**
 * Resolve a UID to the canonical tenant ID.
 *
 * Resolution order:
 * 1. Check in-memory cache (fast path)
 * 2. If cache stale, rebuild from Firestore
 * 3. Unknown UIDs pass through as-is (don't break new signups)
 */
export async function resolveTenant(
  uid: string,
  db: Firestore,
): Promise<TenantResolution> {
  // Rebuild cache if stale or empty
  if (Date.now() - cacheBuiltAt > CACHE_TTL_MS) {
    await buildCache(db);
  }

  // Fast path: already canonical
  if (canonicalCache.has(uid)) {
    return { tenantId: uid, canonical: true };
  }

  // Check if this is a known alternate UID
  const canonical = uidCache.get(uid);
  if (canonical) {
    return { tenantId: canonical, canonical: false, mergedFrom: uid };
  }

  // Unknown UID — pass through as-is (new signup or unlinked account)
  return { tenantId: uid, canonical: true };
}

/**
 * Seed the canonical account for christian@rezzed.ai.
 * Idempotent — safe to call on every server boot.
 */
export async function seedCanonicalAccounts(db: Firestore): Promise<void> {
  const email = "christian@rezzed.ai";
  const docId = hashEmail(email);
  const ref = db.doc(`canonical_accounts/${docId}`);

  try {
    const doc = await ref.get();
    if (!doc.exists) {
      const { FieldValue } = await import("firebase-admin/firestore");
      await ref.set({
        email,
        canonicalUid: "7viFKVtl5lgzguhFoZlnYYrqeDG2",
        alternateUids: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log("[TenantResolver] Seeded canonical account for", email);
    }
  } catch (err) {
    console.error("[TenantResolver] Failed to seed canonical account:", err);
  }
}

/**
 * Merge an alternate UID into a canonical account.
 * Adds the alternate UID to the alternateUids array and invalidates cache.
 */
export async function mergeAccounts(
  db: Firestore,
  email: string,
  canonicalUid: string,
  alternateUid: string,
): Promise<{ success: boolean; error?: string }> {
  if (canonicalUid === alternateUid) {
    return { success: false, error: "Cannot merge a UID into itself" };
  }

  const docId = hashEmail(email);
  const ref = db.doc(`canonical_accounts/${docId}`);

  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    const doc = await ref.get();

    if (doc.exists) {
      const data = doc.data()!;
      if (data.canonicalUid !== canonicalUid) {
        return { success: false, error: `Canonical UID mismatch: expected ${data.canonicalUid}, got ${canonicalUid}` };
      }
      const existing = (data.alternateUids as string[]) || [];
      if (existing.includes(alternateUid)) {
        return { success: true }; // Already merged, idempotent
      }
      await ref.update({
        alternateUids: FieldValue.arrayUnion(alternateUid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await ref.set({
        email,
        canonicalUid,
        alternateUids: [alternateUid],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Invalidate cache
    uidCache.set(alternateUid, canonicalUid);
    canonicalCache.add(canonicalUid);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Exported for testing — force cache rebuild. */
export function invalidateCache(): void {
  cacheBuiltAt = 0;
}
