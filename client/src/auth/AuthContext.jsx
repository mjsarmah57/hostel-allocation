import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // On first load, try to resume the session from the httpOnly refresh cookie.
  useEffect(() => {
    refreshAccessToken()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
    setSessionExpiredHandler(() => setUser(null));
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  // UI decisions are driven by PERMISSIONS (same codes the server checks), not role names.
  const can = useCallback((perm) => !!user?.permissions?.includes(perm), [user]);

  const value = useMemo(() => ({ user, booting, login, logout, can }), [user, booting, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
