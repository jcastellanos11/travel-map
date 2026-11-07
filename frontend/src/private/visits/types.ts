import type { Place, Visit } from '../../api/contracts.ts';
import type { ListState } from '../controller.ts';
export type VisitSelection = { status: 'none' | 'loading' } | { status: 'error'; message: string } | { status: 'ready'; visit: Visit };
export type CatalogState = { status: 'idle' } | { status: 'loading' | 'error'; message?: string }
  | { status: 'ready'; countryCode: string; query: string; results: ListState<Place> & { status: 'ready' } };
export interface VisitWorkspace {
  visits: ListState<Visit>;
  selection: VisitSelection;
  catalog: CatalogState;
  editor: 'closed' | 'create' | 'edit';
  saved?: string;
}
