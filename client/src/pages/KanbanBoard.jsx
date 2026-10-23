import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, MapPin, Calendar, ExternalLink, Star } from 'lucide-react';
import ApplicationModal from '../components/ApplicationModal';
import StatusMenu from '../components/StatusMenu';
import { useApplications, useMoveApplication, useSaveApplication } from '../services/queries';

const COLUMNS = [
  { id: 'applied', title: 'Applied', color: '#0984e3', emoji: '📤' },
  { id: 'interview', title: 'Interview', color: '#fdcb6e', emoji: '🎤' },
  { id: 'offer', title: 'Offer', color: '#00b894', emoji: '🎉' },
  { id: 'rejected', title: 'Rejected', color: '#e17055', emoji: '❌' },
];

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

export default function KanbanBoard() {
  const navigate = useNavigate();
  const { data: apps = [], isPending } = useApplications();
  const move = useMoveApplication();
  const save = useSaveApplication();
  const [adding, setAdding] = useState(false);

  const onDragEnd = ({ draggableId, destination, source }) => {
    if (!destination || destination.droppableId === source.droppableId) return;
    move.mutate({ id: draggableId, status: destination.droppableId });
  };

  const columnApps = (status) => apps.filter(a => a.status === status);
  const otherCount = apps.filter(a => !COLUMNS.some(c => c.id === a.status)).length;

  if (isPending) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Kanban Board</h1>
          <p className="page-subtitle">
            Drag cards between columns, or use the status menu on each card.
            {otherCount > 0 && ` ${otherCount} wishlist, accepted or withdrawn application${otherCount === 1 ? '' : 's'} are in Applications.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
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
                <span className="kanban-column-count">{columnApps(col.id).length}</span>
              </div>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className={`kanban-cards ${snapshot.isDraggingOver ? 'drag-over' : ''}`}>
                    {columnApps(col.id).map((app, index) => (
                      <Draggable key={app.id} draggableId={app.id} index={index}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className="kanban-card"
                            aria-label={`${app.company_name}, ${app.role}`}
                            style={{ ...prov.draggableProps.style, opacity: snap.isDragging ? 0.8 : 1 }}
                            onClick={() => navigate(`/applications/${app.id}`)}
                          >
                            <div className="kanban-card-company">{app.company_name}</div>
                            <div className="kanban-card-role">{app.role}</div>
                            <div className="kanban-card-meta">
                              <span className={`badge badge-${app.type === 'internship' ? 'interview' : 'applied'}`} style={{ fontSize: 10 }}>{app.type}</span>
                              {app.priority === 'high' && <Star size={12} className="priority-high" fill="currentColor" aria-label="High priority" />}
                              {app.location && <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={10} />{app.location}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                <Calendar size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                {formatDate(app.application_date)}
                              </span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {app.url && <a href={app.url} target="_blank" rel="noopener noreferrer" aria-label="Open job posting" onClick={e => e.stopPropagation()}><ExternalLink size={12} /></a>}
                                <StatusMenu application={app} compact />
                              </span>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {columnApps(col.id).length === 0 && (
                      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Drop here</div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {adding && (
        <ApplicationModal onClose={() => setAdding(false)} onSave={(form) => save.mutateAsync({ data: form })} application={null} />
      )}
    </div>
  );
}
