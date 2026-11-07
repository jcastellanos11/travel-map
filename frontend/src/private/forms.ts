import { schemas } from '../api/generated.ts';
import type { ProjectCreate, TripCreate } from '../api/generated.ts';
export type FormErrors = { name?: string; description?: string; tripCreationPolicy?: string };
const scalar = (value: string) => [...value].every(c => { const n = c.codePointAt(0)!; return n !== 0 && (n < 0xd800 || n > 0xdfff); });
const control = (value: string) => [...value].some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127);
function nameError(name: string): string | undefined {
  if (!name.trim() || [...name.trim()].length > schemas.ProjectCreate.properties.name.maxLength || control(name) || !scalar(name)) return 'Enter a name of 1–200 characters without control characters.';
}
export function projectForm(name: string, policy: string): { value?: ProjectCreate; errors: FormErrors } {
  const errors: FormErrors = { name: nameError(name) };
  if (!schemas.ProjectCreate.properties.tripCreationPolicy.enum.includes(policy as NonNullable<ProjectCreate['tripCreationPolicy']>)) errors.tripCreationPolicy = 'Choose a supported Trip creation policy.';
  return { errors, ...(!Object.values(errors).some(Boolean) ? { value: { name: name.trim(), tripCreationPolicy: policy as ProjectCreate['tripCreationPolicy'] } } : {}) };
}
export function tripForm(name: string, description: string): { value?: TripCreate; errors: FormErrors } {
  const errors: FormErrors = { name: nameError(name) };
  // TripCreate description is string-or-null; retain calendar-independent plain text.
  if ([...description].length > 2000 || !scalar(description)) errors.description = 'Use up to 2000 valid characters without null characters.';
  return { errors, ...(!Object.values(errors).some(Boolean) ? { value: { name: name.trim(), description: description || null } } : {}) };
}
