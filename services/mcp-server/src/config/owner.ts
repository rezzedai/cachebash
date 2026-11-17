/**
 * Owner identity — the program ID used for the grid owner's portal principal,
 * owner-attributed relay messages and constitutional-proposal reviews.
 * Deployments set OWNER_PROGRAM_ID so existing Firestore records keep matching.
 */
export const OWNER_PROGRAM_ID: string = process.env.OWNER_PROGRAM_ID || "owner";

/**
 * Program ID stamped on keys minted by POST /enroll. Deployments set
 * ENROLLMENT_PROGRAM_ID to the tenant's registered program ID.
 */
export const ENROLLMENT_PROGRAM_ID: string = process.env.ENROLLMENT_PROGRAM_ID || "tenant";
