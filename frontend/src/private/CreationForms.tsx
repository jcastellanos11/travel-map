import { useRef, useState } from 'react';
import type { ProjectCreate, TripCreate } from '../api/generated.ts';
import { projectForm, tripForm } from './forms.ts';
import type { FormErrors } from './forms.ts';
export default function CreationForms(props: { kind: 'project' | 'trip'; pending: boolean; onProject(input: ProjectCreate): Promise<void>; onTrip(input: TripCreate): Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [policy, setPolicy] = useState('admins_only');
  const [errors, setErrors] = useState<FormErrors>({});
  const form = useRef<HTMLFormElement>(null);
  const prefix = `create-${props.kind}`;
  return <details className="creation"><summary>New {props.kind === 'project' ? 'Project' : 'Trip'}</summary>
    <form ref={form} noValidate aria-label={`Create ${props.kind}`} onSubmit={event => {
      event.preventDefault();
      if (props.pending) return;
      const result = props.kind === 'project' ? projectForm(name, policy) : tripForm(name, description);
      setErrors(result.errors);
      if (!result.value) { requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
      if (props.kind === 'project') void props.onProject(projectForm(name, policy).value!);
      else void props.onTrip(tripForm(name, description).value!);
    }}>
      <label htmlFor={`${prefix}-name`}>Name</label>
      <input id={`${prefix}-name`} name="name" value={name} onChange={e => setName(e.target.value)} required autoComplete="off" aria-invalid={Boolean(errors.name)} aria-describedby={`${prefix}-name-help`} disabled={props.pending} />
      <small id={`${prefix}-name-help`} role={errors.name ? 'alert' : undefined}>{errors.name ?? '1–200 characters.'}</small>
      {props.kind === 'project' ? <><label htmlFor={`${prefix}-policy`}>Who may create Trips?</label>
        <select id={`${prefix}-policy`} value={policy} onChange={e => setPolicy(e.target.value)} disabled={props.pending} aria-invalid={Boolean(errors.tripCreationPolicy)} aria-describedby={`${prefix}-policy-help`}>
          <option value="admins_only">Owner and Admins</option><option value="all_project_members">All Project members</option>
        </select><small id={`${prefix}-policy-help`} role={errors.tripCreationPolicy ? 'alert' : undefined}>{errors.tripCreationPolicy ?? 'Trip-only Guests cannot create Trips.'}</small></>
        : <><label htmlFor={`${prefix}-description`}>Description (optional)</label><textarea id={`${prefix}-description`} value={description} onChange={e => setDescription(e.target.value)} disabled={props.pending} aria-invalid={Boolean(errors.description)} aria-describedby={`${prefix}-description-help`} /><small id={`${prefix}-description-help`} role={errors.description ? 'alert' : undefined}>{errors.description ?? 'Up to 2000 characters.'}</small></>}
      <button type="submit" disabled={props.pending}>{props.pending ? 'Saving…' : `Create ${props.kind === 'project' ? 'Project' : 'Trip'}`}</button>
    </form>
  </details>;
}
