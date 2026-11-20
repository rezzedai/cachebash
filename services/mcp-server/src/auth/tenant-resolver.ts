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

/** Thrown when the canonical_accounts lookup fails. Callers deny the request; none may fall back to the raw uid. */
export class TenantResolutionError extends Error {
  readonly retryable = true;
  constructor(uid: string, cause: unknown) {
    super(`tenant resolution failed for uid ${uid}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TenantResolutionError";
  }
}

/**
 * Resolve a UID to the canonical tenant ID.
 *
 * Queries Firestore directly, no in-memory cache. Uses array-contains on alternateUids.
 * An unknown uid (no canonical_accounts row lists it) resolves to itself, so new signups work.
 * A failed lookup throws TenantResolutionError: returning the raw uid on error would silently
 * move a caller into a different, empty tenant (RD-5 amendment 4, ruling 2).
 */
export async function resolveTenant(
  uid: string,
  db: Firestore,
): Promise<TenantResolution> {
  try {
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
    throw new TenantResolutionError(uid, err);
  }

  return { tenantId: uid, canonical: true };
}

/**
 * Every uid that resolves to `tenantId`: the canonical uid plus its alternates.
 * Throws TenantResolutionError on a failed lookup.
 */
export async function tenantUids(tenantId: string, db: Firestore): Promise<string[]> {
  const uids = new Set<string>([tenantId]);
  try {
    const snapshot = await db.collection("canonical_accounts").where("canonicalUid", "==", tenantId).get();
    for (const doc of snapshot.docs) {
      const alternates = doc.data().alternateUids;
      if (Array.isArray(alternates)) for (const a of alternates) if (typeof a === "string" && a) uids.add(a);
    }
  } catch (err) {
    throw new TenantResolutionError(tenantId, err);
  }
  return [...uids];
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
 * Seed the authorizedEmails collection for Grid Portal auto-linking.
 * This enables the Grid Portal (Google auth) to automatically link to the CacheBash data UID.
 * Idempotent — safe to call on every server boot.
 */
export async function seedAuthorizedEmails(db: Firestore): Promise<void> {
  const email = "christian@rezzed.ai";
  const dataUid = "7viFKVtl5lgzguhFoZlnYYrqeDG2"; // Canonical UID
  const ref = db.doc(`authorizedEmails/${email}`);

  try {
    const doc = await ref.get();
    if (!doc.exists) {
      const { FieldValue } = await import("firebase-admin/firestore");
      await ref.set({
        dataUid,
        createdAt: FieldValue.serverTimestamp(),
      });
      console.log("[TenantResolver] Seeded authorizedEmails for", email);
    }
  } catch (err) {
    console.error("[TenantResolver] Failed to seed authorizedEmails:", err);
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
