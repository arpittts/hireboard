import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, MapPin, Calendar, ExternalLink, Star } from 'lucide-react';
import api from '../services/api';
import ApplicationModal from '../components/ApplicationModal';

const COLUMNS = [
  { id: 'applied', title: 'Applied', color: '#0984e3', emoji: '📤' },
  { id: 'interview', title: 'Interview', color: '#fdcb6e', emoji: '🎤' },
  { id: 'offer', title: 'Offer', color: '#00b894', emoji: '🎉' },
  { id: 'rejected', title: 'Rejected', color: '#e17055', emoji: '❌' },
];

export default function KanbanBoard() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editApp, setEditApp] = useState(null);

  const fetchApps = async () => {
    try {
      const res = await api.get('/applications');
      setApps(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchApps(); }, []);

  const onDragEnd = async (result) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId;
    
    // Optimistic update
    setApps(prev => prev.map(a => a.id === draggableId ? { ...a, status: newStatus } : a));
    
    try {
      await api.patch(`/applications/${draggableId}/status`, { status: newStatus });
    } catch (err) {
      console.error(err);
      fetchApps(); // Revert on error
    }
  };

  const handleSave = async (formData) => {
    if (editApp) {
      await api.put(`/applications/${editApp.id}`, formData);
    } else {
      await api.post('/applications', formData);
    }
    fetchApps();
  };

  const getColumnApps = (status) => apps.filter(a => a.status === status);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Kanban Board</h1>
          <p className="page-subtitle">Drag and drop to update application status</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditApp(null); setModalOpen(true); }}>
          <Plus size={16} /> Add Application
        </button>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="kanban-board">
          {COLUMNS.map(col => (
            <div className="kanban-column" key={col.id}>
              <div className="kanban-column-header">
                <div className="kanban-column-title" style={{ color: col.color }}>
                  <span>{col.emoji}</span> {col.title}
                </div>
                <span className="kanban-column-count">{getColumnApps(col.id).length}</span>
              </div>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`kanban-cards ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                  >
                    {getColumnApps(col.id).map((app, index) => (
                      <Draggable key={app.id} draggableId={app.id} index={index}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className="kanban-card"
                            style={{ ...prov.draggableProps.style, opacity: snap.isDragging ? 0.8 : 1 }}
                            onClick={() => { setEditApp(app); setModalOpen(true); }}
                          >
                            <div className="kanban-card-company">{app.company_name}</div>
                            <div className="kanban-card-role">{app.role}</div>
                            <div className="kanban-card-meta">
                              <span className={`badge badge-${app.type === 'internship' ? 'interview' : 'applied'}`} style={{ fontSize: 10 }}>
                                {app.type}
                              </span>
                              {app.priority === 'high' && <Star size={12} className="priority-high" fill="currentColor" />}
                              {app.location && <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={10} />{app.location}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                <Calendar size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                {formatDate(app.application_date)}
                              </span>
                              {app.url && <a href={app.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}><ExternalLink size={12} /></a>}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {getColumnApps(col.id).length === 0 && (
                      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                        Drop here
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      <ApplicationModal isOpen={modalOpen} onClose={() => { setModalOpen(false); setEditApp(null); }} onSave={handleSave} application={editApp} />
    </div>
  );
}
