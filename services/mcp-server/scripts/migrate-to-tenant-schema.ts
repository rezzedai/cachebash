/**
 * One-time migration: users/{userId}/ → tenants/{userId}/
 * 
 * Run with: npx tsx mcp-server/scripts/migrate-to-tenant-schema.ts
 * 
 * SAFETY: This script COPIES data — it does NOT delete old paths.
 * Old paths can be cleaned up after verifying the migration.
 * 
 * Prerequisites:
 * - GOOGLE_APPLICATION_CREDENTIALS set to service account key
 * - Or running in a GCP environment with appropriate permissions
 */

import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

const SUBCOLLECTIONS = [
  'tasks', 'relay', 'events', 'analytics_events', 'analytics_aggregates',
  'ledger', 'sessions', 'mcp_sessions', 'idempotency_keys', 'health_checks',
  'devices', 'sync_queue', 'dead_letters', 'rateLimits', 'sprints'
];

const BATCH_SIZE = 500; // Firestore batch limit

async function migrateCollection(
  sourcePath: string,
  targetPath: string,
  label: string
): Promise<number> {
  const sourceRef = db.collection(sourcePath);
  const snapshot = await sourceRef.get();
  
  if (snapshot.empty) {
    console.log(`  [skip] ${label}: no documents`);
    return 0;
  }

  let count = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const targetRef = db.collection(targetPath).doc(doc.id);
    batch.set(targetRef, doc.data());
    count++;
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`  [done] ${label}: ${count} documents migrated`);
  return count;
}

async function migrateUser(userId: string): Promise<number> {
  console.log(`\nMigrating user: ${userId}`);
  let total = 0;

  // Copy user root document
  const userDoc = await db.doc(`users/${userId}`).get();
  if (userDoc.exists) {
    await db.doc(`tenants/${userId}`).set(userDoc.data()!);
    total++;
    console.log(`  [done] root document copied`);
  }

  // Copy each subcollection
  for (const sub of SUBCOLLECTIONS) {
    const count = await migrateCollection(
      `users/${userId}/${sub}`,
      `tenants/${userId}/${sub}`,
      sub
    );
    total += count;

    // Handle nested subcollections under sessions (e.g., sessions/_meta/program_state)
    if (sub === 'sessions') {
      const sessionsSnap = await db.collection(`users/${userId}/sessions`).get();
      for (const sessionDoc of sessionsSnap.docs) {
        // Check for _meta subcollection
        const metaSnap = await db.collection(`users/${userId}/sessions/${sessionDoc.id}/_meta`).get();
        if (!metaSnap.empty) {
          for (const metaDoc of metaSnap.docs) {
            await db.doc(`tenants/${userId}/sessions/${sessionDoc.id}/_meta/${metaDoc.id}`).set(metaDoc.data());
            total++;
          }
          // Also check program_state under _meta
          const stateSnap = await db.collection(`users/${userId}/sessions/_meta/program_state`).get();
          if (!stateSnap.empty) {
            for (const stateDoc of stateSnap.docs) {
              await db.doc(`tenants/${userId}/sessions/_meta/program_state/${stateDoc.id}`).set(stateDoc.data());
              total++;
            }
          }
        }
      }
    }
  }

  return total;
}

async function migrateApiKeys(): Promise<number> {
  console.log('\nMigrating apiKeys → keyIndex...');
  return migrateCollection('apiKeys', 'keyIndex', 'apiKeys');
}

async function main() {
  console.log('=== CacheBash Multi-Tenant Schema Migration ===\n');
  console.log('Source: users/{userId}/ → Target: tenants/{userId}/');
  console.log('Source: apiKeys/{hash} → Target: keyIndex/{hash}\n');

  // Get all user IDs
  const usersSnap = await db.collection('users').get();
  const userIds = usersSnap.docs.map(d => d.id);
  console.log(`Found ${userIds.length} users to migrate\n`);

  let grandTotal = 0;

  // Migrate each user
  for (const userId of userIds) {
    const count = await migrateUser(userId);
    grandTotal += count;
  }

  // Migrate API keys
  const keyCount = await migrateApiKeys();
  grandTotal += keyCount;

  console.log(`\n=== Migration Complete ===`);
  console.log(`Total documents copied: ${grandTotal}`);
  console.log(`Users migrated: ${userIds.length}`);
  console.log(`\nOld paths (users/, apiKeys/) are preserved.`);
  console.log(`Run cleanup script after verifying migration.`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
