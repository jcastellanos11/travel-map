// E4.1 domain foundation only. No media HTTP routes, storage or processor imports.
export const MAX_BATCH_FILES = 10;
export const MAX_INPUT_FILE_BYTES = 20_000_000;
export const USER_MEDIA_QUOTA_BYTES = 500_000_000;
export const TRASH_RETENTION_SECONDS = 2_592_000;
export const MEDIA_POLICY_VERSION = 'sanitized-v1';
export const MEDIA_VARIANTS = ['archival', 'display', 'thumbnail'] as const;
export const MEDIA_REPRESENTATIONS = {
  archival: { opaqueType: 'image/jpeg', opaqueQuality: 95, transparentType: 'image/png' },
  display: { contentType: 'image/webp', maxEdge: 2560, quality: 82 },
  thumbnail: { contentType: 'image/webp', maxEdge: 480, quality: 72 },
  preserveAspectRatio: true, applyOrientation: true, upscale: false, crop: false,
  retainIdentifyingMetadata: false,
} as const;
export type MediaVariant = typeof MEDIA_VARIANTS[number];
export type PhotoStatus = 'pending_upload' | 'processing' | 'active' | 'failed' | 'cleanup_pending'
  | 'trashed' | 'restoring' | 'purge_pending' | 'purged';
export type ReservationStatus = 'active' | 'cleanup_pending' | 'finalized' | 'released';
export type AttemptStatus = 'queued' | 'claimed' | 'ready' | 'fenced' | 'finalized' | 'cleaned';
export type TaskKind = 'process' | 'cleanup' | 'restore' | 'purge';
export type SafeInputType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface UploadFileIntent {
  clientFileId: string;
  declaredBytes: number;
  declaredMime?: SafeInputType;
}
export interface UploadIntent { visitId: string; idempotencyKey: string; files: UploadFileIntent[] }
export interface PhotoSummary {
  id: string; visitId: string; createdByUserId: string; description: string | null;
  status: PhotoStatus; createdAt: string; updatedAt: string;
}
// Technical evidence is NOT a public DTO or user-selected manifest. No object keys.
// A future processor must independently verify bytes/pixels/privacy before attesting.
export interface TrustedAssetEvidence {
  assetId: string; contentType: SafeInputType; byteLength: number;
  width: number; height: number; sha256: string;
}
export interface MediaQuota { usedBytes: number; reservedBytes: number; quotaBytes: typeof USER_MEDIA_QUOTA_BYTES }
