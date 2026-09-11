export type Connection = {
  connection_id: string;
  first_name: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  intents: string[];
  connected_at: string;
};
export function parseConnections(data: unknown): Connection[] {
  if (!Array.isArray(data)) throw new Error('Connections unavailable');
  return data.map((row) => {
    if (!row || typeof row.connection_id !== 'string' || typeof row.first_name !== 'string' ||
      !(row.age === null || Number.isInteger(row.age)) ||
      !(row.gender === null || typeof row.gender === 'string') ||
      !(row.bio === null || typeof row.bio === 'string') ||
      !Array.isArray(row.intents) || !row.intents.every((value: unknown) => typeof value === 'string') ||
      typeof row.connected_at !== 'string' || !Number.isFinite(Date.parse(row.connected_at))) {
      throw new Error('Connections unavailable');
    }
    return { connection_id: row.connection_id, first_name: row.first_name, age: row.age,
      gender: row.gender, bio: row.bio, intents: [...row.intents], connected_at: row.connected_at };
  });
}
export async function loadConnections(signal: AbortSignal): Promise<Connection[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('list_connections').abortSignal(signal);
  if (error) throw new Error('Connections unavailable');
  return parseConnections(data);
}
