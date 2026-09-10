export type IncomingRequest = {
  request_id: string;
  first_name: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  intents: string[];
};
export type RequestResponse = 'accepted' | 'declined';

export async function loadIncomingRequests(signal?: AbortSignal): Promise<IncomingRequest[]> {
  const { supabase } = await import('./supabase');
  let query = supabase.rpc('list_incoming_connection_requests');
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error('Requests unavailable');
  return data.map((row) => {
    if (!row || typeof row.request_id !== 'string' || typeof row.first_name !== 'string' ||
      !(row.age === null || Number.isInteger(row.age)) ||
      !(row.gender === null || typeof row.gender === 'string') ||
      !(row.bio === null || typeof row.bio === 'string') ||
      !Array.isArray(row.intents) || !row.intents.every((value: unknown) => typeof value === 'string')) {
      throw new Error('Requests unavailable');
    }
    return { request_id: row.request_id, first_name: row.first_name, age: row.age,
      gender: row.gender, bio: row.bio, intents: [...row.intents] };
  });
}

export async function respondToRequest(requestId: string, response: RequestResponse): Promise<void> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('respond_to_connection_request', { request_id: requestId, response });
  if (error || data !== response) throw new Error('Request update unavailable');
}
