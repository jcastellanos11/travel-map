export type TripStatus = 'active' | 'archived' | 'deletion_requested' | 'deleted';

export interface Trip {
  readonly id: string;
  readonly projectId: string;
  readonly createdByUserId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: TripStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
