import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const WS_COLORS = [
    '#0ea5e9', '#a855f7', '#f97316', '#10b981',
    '#ef4444', '#ec4899', '#6366f1', '#14b8a6',
];

export default function AdminPanel({ onClose }) {
    const {
        token,
        isSuperAdmin,
        activeWorkspaceId,
        setActiveWorkspaceId,
        refreshWorkspaces,
        logout,
    } = useAuth();

    const [requests, setRequests] = useState([]);
    const [users, setUsers] = useState([]);
    const [workspaces, setWorkspaces] = useState([]);
    const [members, setMembers] = useState([]);
    const [waGroups, setWaGroups] = useState([]);

    const [tab, setTab] = useState('workspace_setup');
    const [loading, setLoading] = useState(true);
    const [actionMsg, setActionMsg] = useState(null);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId || null);
    const [requestWorkspaceById, setRequestWorkspaceById] = useState({});

    const [wsForm, setWsForm] = useState({
        name: '',
        slug: '',
        description: '',
        color: '#0ea5e9',
        owner_email: '',
    });
    const [editWsId, setEditWsId] = useState(null);

    const [memberEmail, setMemberEmail] = useState('');
    const [memberRole, setMemberRole] = useState('member');

    const [waForm, setWaForm] = useState({ whatsapp_group_id: '', name: '' });

    useEffect(() => {
        setSelectedWorkspaceId(activeWorkspaceId || null);
    }, [activeWorkspaceId]);

    const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };

    const toFriendlyError = useCallback((err) => {
        const msg = String(err?.message || 'Request failed');
        if (
            msg.includes('Invalid or expired token') ||
            msg.includes('Missing auth token') ||
            msg.includes('Authentication failed')
        ) {
            logout();
            return 'Session expired. Please sign in again.';
        }
        return msg;
    }, [logout]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const fetches = [
                fetch(`${API_BASE}/admin/requests`, { headers: authHeaders }),
                fetch(`${API_BASE}/admin/users${selectedWorkspaceId ? `?workspace_id=${encodeURIComponent(selectedWorkspaceId)}` : ''}`, { headers: authHeaders }),
                fetch(`${API_BASE}/workspaces`, { headers: authHeaders }),
            ];

            if (selectedWorkspaceId) {
                fetches.push(
                    fetch(`${API_BASE}/workspaces/${selectedWorkspaceId}/members`, { headers: authHeaders }),
                    fetch(`${API_BASE}/workspaces/${selectedWorkspaceId}/groups`, { headers: authHeaders }),
                );
            }

            const results = await Promise.all(fetches);
            const [reqRes, usrRes, wsRes] = results;

            const reqJson = await reqRes.json();
            const usrJson = await usrRes.json();
            const wsJson = await wsRes.json();

            setRequests(reqJson.data || []);
            setUsers(usrJson.data || []);
            setWorkspaces(wsJson.data || []);
            setRequestWorkspaceById((prev) => {
                const next = { ...prev };
                (reqJson.data || []).forEach((r) => {
                    if (!next[r.id]) {
                        next[r.id] = r.workspace_id || selectedWorkspaceId || '';
                    }
                });
                return next;
            });

            if (selectedWorkspaceId && results[3] && results[4]) {
                const memJson = await results[3].json();
                const grpJson = await results[4].json();
                setMembers(memJson.data || []);
                setWaGroups(grpJson.data || []);
            } else {
                setMembers([]);
                setWaGroups([]);
            }
        } catch (err) {
            const friendly = toFriendlyError(err);
            setActionMsg({ type: 'error', text: friendly });
            console.error('Admin load error:', err);
        } finally {
            setLoading(false);
        }
    }, [selectedWorkspaceId, token, toFriendlyError]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const doAction = async (endpoint, body, successMsg) => {
        setActionMsg(null);
        try {
            const res = await fetch(`${API_BASE}/admin/${endpoint}`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setActionMsg({ type: 'success', text: successMsg || json.message });
            await loadData();
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    const handleSelectWorkspace = (id) => {
        setSelectedWorkspaceId(id || null);
        setActiveWorkspaceId(id || null);
    };

    const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) || null;
    const resolveRequestWorkspaceId = (request) =>
        requestWorkspaceById[request.id] || request.workspace_id || selectedWorkspaceId || '';

    // ── Workspace CRUD ──────────────────────
    const handleWsSubmit = async (e) => {
        e.preventDefault();
        setActionMsg(null);
        try {
            const url = editWsId ? `${API_BASE}/workspaces/${editWsId}` : `${API_BASE}/workspaces`;
            const method = editWsId ? 'PUT' : 'POST';
            const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(wsForm) });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const newWorkspaceId = json?.data?.id || editWsId || null;
            setActionMsg({ type: 'success', text: editWsId ? 'Workspace updated' : 'Workspace created' });
            setWsForm({ name: '', slug: '', description: '', color: '#0ea5e9', owner_email: '' });
            setEditWsId(null);
            await loadData();
            refreshWorkspaces();
            if (newWorkspaceId) handleSelectWorkspace(newWorkspaceId);
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    const handleWsDelete = async (id) => {
        if (!confirm('Delete this workspace? Resources will be unlinked.')) return;
        try {
            const res = await fetch(`${API_BASE}/workspaces/${id}`, { method: 'DELETE', headers: authHeaders });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setActionMsg({ type: 'success', text: 'Workspace deleted' });
            if (selectedWorkspaceId === id) handleSelectWorkspace(null);
            await loadData();
            refreshWorkspaces();
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    // ── Members ─────────────────────────────
    const handleAddMember = async (e) => {
        e.preventDefault();
        if (!selectedWorkspaceId) {
            setActionMsg({ type: 'error', text: 'Select a workspace first' });
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/workspaces/${selectedWorkspaceId}/members`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ email: memberEmail, role: memberRole }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setActionMsg({ type: 'success', text: `${memberEmail} added` });
            setMemberEmail('');
            await loadData();
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    const handleRemoveMember = async (email) => {
        if (!selectedWorkspaceId) return;
        if (!confirm(`Remove ${email}?`)) return;
        try {
            const res = await fetch(`${API_BASE}/workspaces/${selectedWorkspaceId}/members/${encodeURIComponent(email)}`, {
                method: 'DELETE',
                headers: authHeaders,
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setActionMsg({ type: 'success', text: `${email} removed` });
            await loadData();
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    // ── WA Groups ───────────────────────────
    const handleAddWaGroup = async (e) => {
        e.preventDefault();
        if (!selectedWorkspaceId) {
            setActionMsg({ type: 'error', text: 'Select a workspace first' });
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/workspaces/${selectedWorkspaceId}/groups`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(waForm),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setActionMsg({ type: 'success', text: 'WhatsApp group connected and scan queued' });
            setWaForm({ whatsapp_group_id: '', name: '' });
            await loadData();
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    const handleRemoveWaGroup = async (gid) => {
        if (!selectedWorkspaceId) return;
        if (!confirm('Disconnect this WhatsApp group?')) return;
        try {
            const res = await fetch(`${API_BASE}/workspaces/${selectedWorkspaceId}/groups/${gid}`, {
                method: 'DELETE',
                headers: authHeaders,
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            setActionMsg({ type: 'success', text: 'Group disconnected' });
            await loadData();
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    const handleRescanWorkspaceGroups = async () => {
        if (!selectedWorkspaceId) {
            setActionMsg({ type: 'error', text: 'Select a workspace first' });
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/admin/rescan-history`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ workspace_id: selectedWorkspaceId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to queue rescan');
            setActionMsg({ type: 'success', text: `History scan queued for ${json.queued_count || 0} group(s)` });
        } catch (err) {
            setActionMsg({ type: 'error', text: toFriendlyError(err) });
        }
    };

    return (
        <div className="admin-overlay">
            <div className="admin-panel">
                <div className="admin-panel__header">
                    <h2>Admin Panel</h2>
                    <button className="admin-close" onClick={onClose}>✕</button>
                </div>

                <div className="admin-tabs">
                    <button className={`admin-tab ${tab === 'workspace_setup' ? 'admin-tab--active' : ''}`} onClick={() => setTab('workspace_setup')}>
                        Workspace Setup
                    </button>
                    <button className={`admin-tab ${tab === 'requests' ? 'admin-tab--active' : ''}`} onClick={() => setTab('requests')}>
                        Requests {requests.length > 0 && <span className="admin-badge">{requests.length}</span>}
                    </button>
                    <button className={`admin-tab ${tab === 'users' ? 'admin-tab--active' : ''}`} onClick={() => setTab('users')}>
                        Users
                    </button>
                </div>

                {actionMsg && (
                    <div className={`login-alert ${actionMsg.type === 'error' ? 'login-alert--error' : 'login-alert--success'}`}>
                        {actionMsg.text}
                    </div>
                )}

                {loading ? (
                    <div className="admin-loading"><div className="spinner" /><p>Loading...</p></div>
                ) : tab === 'requests' ? (
                    <div className="admin-list">
                        {requests.length === 0 ? <p className="admin-empty">No pending requests</p> : (
                            requests.map((r) => (
                                <div key={r.id} className="admin-item">
                                    <div className="admin-item__info">
                                        <span className="admin-item__email">{r.email}</span>
                                        <span className="admin-item__date">{formatDate(r.created_at)}</span>
                                    </div>
                                    <div className="admin-item__actions">
                                        <select
                                            className="group-form__input"
                                            style={{ maxWidth: 220 }}
                                            value={resolveRequestWorkspaceId(r)}
                                            onChange={(e) => setRequestWorkspaceById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                        >
                                            <option value="">Assign workspace...</option>
                                            {workspaces.map((ws) => (
                                                <option key={ws.id} value={ws.id}>{ws.name}</option>
                                            ))}
                                        </select>
                                        <button
                                            className="admin-btn admin-btn--approve"
                                            onClick={() => doAction('approve', { email: r.email, workspace_id: resolveRequestWorkspaceId(r) }, `${r.email} approved`)}
                                            disabled={!resolveRequestWorkspaceId(r)}
                                        >
                                            Approve
                                        </button>
                                        <button
                                            className="admin-btn admin-btn--reject"
                                            onClick={() => doAction('reject', { email: r.email, workspace_id: resolveRequestWorkspaceId(r) }, `${r.email} rejected`)}
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                ) : tab === 'users' ? (
                    <div className="admin-list">
                        {users.length === 0 ? <p className="admin-empty">No users yet</p> : (
                            users.map((u) => (
                                <div key={u.id} className="admin-item">
                                    <div className="admin-item__info">
                                        <span className="admin-item__email">{u.email}</span>
                                        <div className="admin-item__badges">
                                            <span className={`admin-role-badge admin-role-badge--${u.role}`}>
                                                {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'User'}
                                            </span>
                                            <span className={`admin-status-badge admin-status-badge--${u.status}`}>
                                                {u.status === 'active' ? 'Active' : 'Revoked'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="admin-item__actions">
                                        {u.role !== 'admin' && u.role !== 'owner' && u.role !== 'super_admin' && u.status === 'active' && selectedWorkspaceId && (
                                            <button className="admin-btn admin-btn--promote" onClick={() => doAction('promote', { email: u.email, workspace_id: selectedWorkspaceId })}>Promote</button>
                                        )}
                                        {u.status === 'active' && u.role !== 'super_admin' && selectedWorkspaceId && (
                                            <button className="admin-btn admin-btn--revoke" onClick={() => doAction('revoke', { email: u.email, workspace_id: selectedWorkspaceId })}>Revoke</button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                ) : (
                    <div className="admin-workspace-flow">
                        <section className="admin-step">
                            <h3>Step 1: Select Workspace</h3>
                            <p>Select where links should be stored before adding groups or members.</p>
                            <div className="admin-select-row">
                                <select
                                    className="group-form__input admin-workspace-select"
                                    value={selectedWorkspaceId || ''}
                                    onChange={(e) => handleSelectWorkspace(e.target.value || null)}
                                >
                                    <option value="">Select workspace...</option>
                                    {workspaces.map((ws) => (
                                        <option key={ws.id} value={ws.id}>{ws.name}</option>
                                    ))}
                                </select>
                            </div>
                            {selectedWorkspace ? (
                                <div className="admin-step__active">
                                    Active workspace: <strong>{selectedWorkspace.name}</strong>
                                </div>
                            ) : (
                                <div className="admin-step__hint">No workspace selected yet.</div>
                            )}
                        </section>

                        {isSuperAdmin && (
                            <section className="admin-step">
                                <h3>Step 2: Create or Edit Workspace</h3>
                                <p>Create workspace first, then select it above.</p>
                                <form className="group-form" onSubmit={handleWsSubmit}>
                                    <div className="group-form__row">
                                        <input type="text" placeholder="Workspace Name *" value={wsForm.name}
                                            onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })} required className="group-form__input" />
                                        <input type="text" placeholder="Slug (optional)" value={wsForm.slug}
                                            onChange={(e) => setWsForm({ ...wsForm, slug: e.target.value })} className="group-form__input" />
                                    </div>
                                    <div className="group-form__row">
                                        <input type="text" placeholder="Description" value={wsForm.description}
                                            onChange={(e) => setWsForm({ ...wsForm, description: e.target.value })} className="group-form__input group-form__input--wide" />
                                        {!editWsId && (
                                            <input type="email" placeholder="Owner email (optional)" value={wsForm.owner_email}
                                                onChange={(e) => setWsForm({ ...wsForm, owner_email: e.target.value })} className="group-form__input" />
                                        )}
                                    </div>
                                    <div className="group-form__row">
                                        <div className="group-form__color-picker">
                                            {WS_COLORS.map((c) => (
                                                <button key={c} type="button"
                                                    className={`group-form__color-swatch ${wsForm.color === c ? 'group-form__color-swatch--active' : ''}`}
                                                    style={{ backgroundColor: c }} onClick={() => setWsForm({ ...wsForm, color: c })} />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="group-form__actions">
                                        <button type="submit" className="admin-btn admin-btn--approve">{editWsId ? 'Update Workspace' : 'Create Workspace'}</button>
                                        {editWsId && (
                                            <button type="button" className="admin-btn admin-btn--reject" onClick={() => {
                                                setEditWsId(null);
                                                setWsForm({ name: '', slug: '', description: '', color: '#0ea5e9', owner_email: '' });
                                            }}>Cancel</button>
                                        )}
                                    </div>
                                </form>

                                {workspaces.length === 0 ? <p className="admin-empty">No workspaces</p> : (
                                    workspaces.map((ws) => (
                                        <div key={ws.id} className="admin-item">
                                            <div className="admin-item__info">
                                                <div className="group-item__name-row">
                                                    <span className="group-tab__dot" style={{ backgroundColor: ws.color || '#0ea5e9' }} />
                                                    <span className="admin-item__email">{ws.name}</span>
                                                </div>
                                                <span className="admin-item__date">{ws.slug} {ws.description ? `· ${ws.description}` : ''}</span>
                                            </div>
                                            <div className="admin-item__actions">
                                                <button className="admin-btn" onClick={() => handleSelectWorkspace(ws.id)}>Select</button>
                                                <button className="admin-btn admin-btn--promote" onClick={() => {
                                                    setEditWsId(ws.id);
                                                    setWsForm({
                                                        name: ws.name,
                                                        slug: ws.slug,
                                                        description: ws.description || '',
                                                        color: ws.color || '#0ea5e9',
                                                        owner_email: '',
                                                    });
                                                }}>Edit</button>
                                                <button className="admin-btn admin-btn--revoke" onClick={() => handleWsDelete(ws.id)}>Delete</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </section>
                        )}

                        <section className="admin-step">
                            <h3>Step 3: Connect WhatsApp Group</h3>
                            <p>Group will be attached to selected workspace and history scan will run automatically.</p>
                            <div className="group-form__actions">
                                <button type="button" className="admin-btn admin-btn--promote" onClick={handleRescanWorkspaceGroups} disabled={!selectedWorkspaceId}>
                                    Rescan Connected Groups
                                </button>
                            </div>
                            <form className="group-form" onSubmit={handleAddWaGroup}>
                                <div className="group-form__row">
                                    <input type="text" placeholder="WhatsApp Group ID *" value={waForm.whatsapp_group_id}
                                        onChange={(e) => setWaForm({ ...waForm, whatsapp_group_id: e.target.value })} required className="group-form__input" disabled={!selectedWorkspaceId} />
                                    <input type="text" placeholder="Display Name" value={waForm.name}
                                        onChange={(e) => setWaForm({ ...waForm, name: e.target.value })} className="group-form__input" disabled={!selectedWorkspaceId} />
                                    <button type="submit" className="admin-btn admin-btn--approve" disabled={!selectedWorkspaceId}>Connect</button>
                                </div>
                            </form>

                            {waGroups.length === 0 ? <p className="admin-empty">No WhatsApp groups connected</p> : (
                                waGroups.map((g) => (
                                    <div key={g.id} className="admin-item">
                                        <div className="admin-item__info">
                                            <span className="admin-item__email">{g.name}</span>
                                            <span className="admin-item__date">{g.whatsapp_group_id} · {g.status}</span>
                                        </div>
                                        <div className="admin-item__actions">
                                            <button className="admin-btn admin-btn--revoke" onClick={() => handleRemoveWaGroup(g.id)}>Disconnect</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </section>

                        <section className="admin-step">
                            <h3>Step 4: Manage Members</h3>
                            <p>Add members only after workspace and groups are connected.</p>
                            <form className="group-form" onSubmit={handleAddMember}>
                                <div className="group-form__row">
                                    <input type="email" placeholder="Member email *" value={memberEmail}
                                        onChange={(e) => setMemberEmail(e.target.value)} required className="group-form__input" disabled={!selectedWorkspaceId} />
                                    <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)} className="group-form__input" style={{ maxWidth: 150 }} disabled={!selectedWorkspaceId}>
                                        <option value="member">Member</option>
                                        <option value="admin">Admin</option>
                                        <option value="owner">Owner</option>
                                    </select>
                                    <button type="submit" className="admin-btn admin-btn--approve" disabled={!selectedWorkspaceId}>Add</button>
                                </div>
                            </form>

                            {members.length === 0 ? <p className="admin-empty">No members in this workspace</p> : (
                                members.map((m) => (
                                    <div key={m.id} className="admin-item">
                                        <div className="admin-item__info">
                                            <span className="admin-item__email">{m.user_email}</span>
                                            <span className={`admin-role-badge admin-role-badge--${m.role}`}>{m.role}</span>
                                        </div>
                                        <div className="admin-item__actions">
                                            <button className="admin-btn admin-btn--revoke" onClick={() => handleRemoveMember(m.user_email)}>Remove</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatDate(str) {
    if (!str) return '';
    return new Date(str).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}
