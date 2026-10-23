import { useState, useEffect } from 'react';
import { useAuth } from '../context/auth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Send, ThumbsDown, Briefcase, Calendar, Clock } from 'lucide-react';
import api from '../services/api';

const STATUS_COLORS = { applied: '#0984e3', interview: '#fdcb6e', offer: '#00b894', rejected: '#e17055', wishlist: '#94a3b8', accepted: '#00b894', withdrawn: '#64748b' };

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/stats')
      .then(res => setStats(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const pieData = stats?.statusBreakdown?.map(s => ({ name: s.status.charAt(0).toUpperCase() + s.status.slice(1), value: s.count, color: STATUS_COLORS[s.status] || '#6C5CE7' })) || [];

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting()}, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="page-subtitle">Here's your application overview</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(108,92,231,0.15)' }}><Briefcase size={20} color="#6C5CE7" /></div>
          <div className="stat-value">{stats?.total || 0}</div>
          <div className="stat-label">Total Applications</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--green-bg)' }}><TrendingUp size={20} color="#00b894" /></div>
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #00b894, #00cec9)', WebkitBackgroundClip: 'text' }}>{stats?.responseRate || 0}%</div>
          <div className="stat-label">Response Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--red-bg)' }}><ThumbsDown size={20} color="#e17055" /></div>
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #e17055, #e84393)', WebkitBackgroundClip: 'text' }}>{stats?.rejectionRate || 0}%</div>
          <div className="stat-label">Rejection Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--blue-bg)' }}><Send size={20} color="#0984e3" /></div>
          <div className="stat-value" style={{ background: 'linear-gradient(135deg, #0984e3, #00cec9)', WebkitBackgroundClip: 'text' }}>
            {stats?.statusBreakdown?.find(s => s.status === 'interview')?.count || 0}
          </div>
          <div className="stat-label">In Interview</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-title">📊 Monthly Applications</div>
          {stats?.monthlyApplications?.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={stats.monthlyApplications}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(108,92,231,0.1)" />
                <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip contentStyle={{ background: '#1a1a3e', border: '1px solid rgba(108,92,231,0.3)', borderRadius: 8, color: '#e2e8f0' }} />
                <Bar dataKey="count" fill="#6C5CE7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state" style={{ padding: 40 }}><p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet. Start applying!</p></div>}
        </div>

        <div className="chart-card">
          <div className="chart-title">🎯 Status Breakdown</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a1a3e', border: '1px solid rgba(108,92,231,0.3)', borderRadius: 8, color: '#e2e8f0' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="empty-state" style={{ padding: 40 }}><p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet</p></div>}
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-title">📅 Upcoming Follow-ups</div>
          {stats?.upcomingFollowUps?.length > 0 ? (
            stats.upcomingFollowUps.map(f => (
              <div key={f.id} className="followup-item">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{f.company_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{f.role}</div>
                </div>
                <div className="followup-date">
                  <Calendar size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {formatDate(f.follow_up_date)}
                </div>
              </div>
            ))
          ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No upcoming follow-ups</div>}
        </div>

        <div className="chart-card">
          <div className="chart-title">⚡ Recent Activity</div>
          {stats?.recentActivity?.length > 0 ? (
            stats.recentActivity.slice(0, 6).map(a => (
              <div key={a.id} className="activity-item">
                <div className="activity-dot" style={{ background: STATUS_COLORS[a.to_status] || '#6C5CE7' }} />
                <div>
                  <div className="activity-text">
                    <strong>{a.company_name}</strong> → <span className={`badge badge-${a.to_status}`} style={{ fontSize: 10, padding: '2px 8px' }}>{a.to_status}</span>
                  </div>
                  <div className="activity-time">
                    <Clock size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {new Date(a.changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))
          ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No activity yet</div>}
        </div>
      </div>
    </div>
  );
}
