#!/usr/bin/env tsx
/**
 * Seed authorizedEmails collection for Grid Portal auto-linking
 *
 * This enables the Grid Portal (Google auth) to automatically link
 * to the CacheBash data UID for authorized users.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// Initialize Firebase Admin with Application Default Credentials
initializeApp({
  credential: applicationDefault(),
  projectId: 'cachebash-app',
})

const db = getFirestore()

async function seedAuthorizedEmails() {
  const email = 'christian@rezzed.ai'
  const dataUid = '7viFKVtl5lgzguhFoZlnYYrqeDG2' // Canonical UID from tenant-resolver

  const ref = db.doc(`authorizedEmails/${email}`)

  try {
    const doc = await ref.get()
    if (!doc.exists) {
      await ref.set({
        dataUid,
        createdAt: FieldValue.serverTimestamp(),
      })
      console.log(`✓ Seeded authorizedEmails/${email} → ${dataUid}`)
    } else {
      console.log(`✓ authorizedEmails/${email} already exists`)
    }
  } catch (err) {
    console.error('✗ Failed to seed authorizedEmails:', err)
    process.exit(1)
  }
}

seedAuthorizedEmails()
  .then(() => {
    console.log('✓ Done')
    process.exit(0)
  })
  .catch((err) => {
    console.error('✗ Fatal error:', err)
    process.exit(1)
  })
