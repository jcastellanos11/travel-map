export type UserStatus = 'active' | 'deletion_requested' | 'deleted';

export interface UserIdentity {
  readonly id: string;
  readonly supabaseAuthUserId: string;
  readonly status: UserStatus;
}

// Digests and operational timestamps stay server-side; no raw token storage.
export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly idleExpiresAt: string;
  readonly revokedAt: string | null;
}
