/**
 * Tenant Resolver — Ensures all auth paths converge to a canonical UID.
 *
 * Firebase Auth creates separate UIDs per sign-in method. This module
 * resolves any known alternate UID to the canonical one, so all downstream
 * Firestore reads/writes use a single tenant path.
 *
 * Stateless: queries Firestore on every call. No in-memory cache.
 * Firestore collection: canonical_accounts/{email_hash}
 */

import * as crypto from "crypto";
import type { Firestore } from "firebase-admin/firestore";

export interface TenantResolution {
  tenantId: string;
  canonical: boolean;
  mergedFrom?: string;
}

function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

/**
 * Resolve a UID to the canonical tenant ID.
 *
 * Queries Firestore directly — no in-memory cache.
 * Uses array-contains query on alternateUids for efficient lookup.
 * Unknown UIDs pass through as-is (don't break new signups).
 */
export async function resolveTenant(
  uid: string,
  db: Firestore,
): Promise<TenantResolution> {
  try {
    // Check if this UID is an alternate for a canonical account
    const snapshot = await db
      .collection("canonical_accounts")
      .where("alternateUids", "array-contains", uid)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const canonicalUid = snapshot.docs[0].data().canonicalUid as string;
      return { tenantId: canonicalUid, canonical: false, mergedFrom: uid };
    }
  } catch (err) {
    console.error("[TenantResolver] Failed to resolve tenant:", err);
  }

  // Not an alternate UID (or query failed) — pass through as-is
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
 * Adds the alternate UID to the alternateUids array in Firestore.
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

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
