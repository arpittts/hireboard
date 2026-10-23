import { useState, useEffect } from 'react';
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
    localStorage.setItem('hireboard_token', data.token);
    localStorage.setItem('hireboard_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const login = async (email, password) => saveSession((await api.post('/auth/login', { email, password })).data);

  const register = async (name, email, password) =>
    saveSession((await api.post('/auth/register', { name, email, password })).data);

  const logout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
