import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';

// GET a URL and expose { data, loading, error, reload }. Re-fetches when url changes.
export function useApi(url) {
  const [state, setState] = useState({ data: null, loading: !!url, error: null });

  const load = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.get(url);
      setState({ data: res.data, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: errorMessage(err) });
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
