// ============================================
// Admin Panel — User & Request Management
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AdminPanel({ onClose }) {
    const { token } = useAuth();
    const [requests, setRequests] = useState([]);
    const [users, setUsers] = useState([]);
    const [tab, setTab] = useState('requests');
    const [loading, setLoading] = useState(true);
    const [actionMsg, setActionMsg] = useState(null);

    const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };

    // ── Fetch Data ───────────────────────────
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [reqRes, usrRes] = await Promise.all([
                fetch(`${API_BASE}/admin/requests`, { headers: authHeaders }),
                fetch(`${API_BASE}/admin/users`, { headers: authHeaders }),
            ]);
            const reqJson = await reqRes.json();
            const usrJson = await usrRes.json();
            setRequests(reqJson.data || []);
            setUsers(usrJson.data || []);
        } catch (err) {
            console.error('Admin load error:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { loadData(); }, [loadData]);

    // ── Actions ──────────────────────────────
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
            setActionMsg({ type: 'error', text: err.message });
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
                    <button
                        className={`admin-tab ${tab === 'requests' ? 'admin-tab--active' : ''}`}
                        onClick={() => setTab('requests')}
                    >
                        Requests {requests.length > 0 && <span className="admin-badge">{requests.length}</span>}
                    </button>
                    <button
                        className={`admin-tab ${tab === 'users' ? 'admin-tab--active' : ''}`}
                        onClick={() => setTab('users')}
                    >
                        Users
                    </button>
                </div>

                {actionMsg && (
                    <div className={`login-alert ${actionMsg.type === 'error' ? 'login-alert--error' : 'login-alert--success'}`}>
                        {actionMsg.text}
                    </div>
                )}

                {loading ? (
                    <div className="admin-loading">
                        <div className="spinner" />
                        <p>Loading...</p>
                    </div>
                ) : tab === 'requests' ? (
                    <div className="admin-list">
                        {requests.length === 0 ? (
                            <p className="admin-empty">No pending requests</p>
                        ) : (
                            requests.map((r) => (
                                <div key={r.id} className="admin-item">
                                    <div className="admin-item__info">
                                        <span className="admin-item__email">{r.email}</span>
                                        <span className="admin-item__date">{formatDate(r.created_at)}</span>
                                    </div>
                                    <div className="admin-item__actions">
                                        <button
                                            className="admin-btn admin-btn--approve"
                                            onClick={() => doAction('approve', { email: r.email }, `${r.email} approved`)}
                                        >
                                            Approve
                                        </button>
                                        <button
                                            className="admin-btn admin-btn--reject"
                                            onClick={() => doAction('reject', { email: r.email }, `${r.email} rejected`)}
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                ) : (
                    <div className="admin-list">
                        {users.length === 0 ? (
                            <p className="admin-empty">No users yet</p>
                        ) : (
                            users.map((u) => (
                                <div key={u.id} className="admin-item">
                                    <div className="admin-item__info">
                                        <span className="admin-item__email">{u.email}</span>
                                        <div className="admin-item__badges">
                                            <span className={`admin-role-badge admin-role-badge--${u.role}`}>
                                                {u.role === 'admin' ? 'Admin' : 'User'}
                                            </span>
                                            <span className={`admin-status-badge admin-status-badge--${u.status}`}>
                                                {u.status === 'active' ? 'Active' : 'Revoked'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="admin-item__actions">
                                        {u.role !== 'admin' && u.status === 'active' && (
                                            <button
                                                className="admin-btn admin-btn--promote"
                                                onClick={() => doAction('promote', { email: u.email })}
                                            >
                                                Promote
                                            </button>
                                        )}
                                        {u.status === 'active' && (
                                            <button
                                                className="admin-btn admin-btn--revoke"
                                                onClick={() => doAction('revoke', { email: u.email })}
                                            >
                                                Revoke
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
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
