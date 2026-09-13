export type ProfileStatus = 'loading' | 'required' | 'complete' | 'error';
export function hasRequiredProfile(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const row = data as Record<string, unknown>;
  if (typeof row.first_name !== 'string' || !row.first_name.trim() || [...row.first_name.trim()].length > 60) return false;
  if (typeof row.date_of_birth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date_of_birth)) return false;
  if (Number(row.date_of_birth.slice(0, 4)) < 1) return false;
  const date = new Date(row.date_of_birth + 'T00:00:00Z');
  const now = new Date();
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === row.date_of_birth
    && date.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
