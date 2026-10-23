import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { errorMessage } from '../services/api';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, startDemo } = useAuth();
  const [demoLoading, setDemoLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const tryDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      await startDemo();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err, 'Could not start the demo.'));
      setDemoLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 50%, rgba(108,92,231,0.08), transparent 50%), radial-gradient(circle at 70% 50%, rgba(168,85,247,0.06), transparent 50%)' }} />
      <div className="auth-card" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div className="logo">
            <div className="logo-icon">📋</div>
            <span>HireBoard</span>
          </div>
        </div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to track your applications</p>
        {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
            {loading ? <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <>Sign In <ArrowRight size={16} /></>}
          </button>
        </form>
        <button type="button" className="btn btn-secondary btn-demo" onClick={tryDemo} disabled={demoLoading || loading}>
          {demoLoading ? <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <><Sparkles size={16} /> Try the demo, no sign-up</>}
        </button>
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text-secondary)' }}>
          Don't have an account? <Link to="/register" style={{ fontWeight: 600 }}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}
