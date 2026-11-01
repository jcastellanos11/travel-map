export type ProjectMembershipRole = 'admin' | 'member';
export type TripCreationPolicy = 'admins_only' | 'all_project_members';
export type ProjectStatus = 'active' | 'archived' | 'deletion_requested' | 'deleted';

export interface Project {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly tripCreationPolicy: TripCreationPolicy;
  readonly status: ProjectStatus;
}
