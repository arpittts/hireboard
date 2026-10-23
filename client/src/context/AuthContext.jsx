import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { AuthContext } from './auth';

function readSavedUser() {
  const token = localStorage.getItem('hireboard_token');
  const savedUser = localStorage.getItem('hireboard_user');
  if (!token || !savedUser) return null;
  try {
    return JSON.parse(savedUser);
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('hireboard_token');
  localStorage.removeItem('hireboard_user');
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  // Show the saved user straight away; the effect below checks the token is still valid.
  const [user, setUser] = useState(readSavedUser);
  const [loading, setLoading] = useState(() => readSavedUser() !== null);

  useEffect(() => {
    if (!readSavedUser()) return;
    api.get('/auth/me')
      .then(res => {
        setUser(res.data);
        localStorage.setItem('hireboard_user', JSON.stringify(res.data));
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const saveSession = (data) => {
    // Never show one account's cached data to the next.
    queryClient.clear();
    localStorage.setItem('hireboard_token', data.token);
    localStorage.setItem('hireboard_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const login = async (email, password) => saveSession((await api.post('/auth/login', { email, password })).data);

  const register = async (name, email, password) =>
    saveSession((await api.post('/auth/register', { name, email, password })).data);

  // "Try the demo": a fresh account with sample data, no sign-up.
  const startDemo = async () => saveSession((await api.post('/auth/demo')).data);

  const logout = () => {
    clearSession();
    queryClient.clear();
    setUser(null);
  };

  // Real accounts confirm with their password; demo accounts don't need one.
  const deleteAccount = async (password) => {
    await api.delete('/auth/account', { data: { password } });
    logout();
  };

  return (
    <AuthContext.Provider value={{ user, login, register, startDemo, logout, deleteAccount, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
