import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';

export default function WorkspaceSwitcher() {
    const { workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace, isSuperAdmin } = useAuth();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (!workspaces || workspaces.length === 0) return null;

    const displayName = activeWorkspace?.name || 'Select Workspace';
    const displayColor = activeWorkspace?.color || '#0ea5e9';

    return (
        <div className="ws-switcher" ref={ref}>
            <button
                type="button"
                className="ws-switcher__trigger"
                onClick={() => setOpen(!open)}
                title="Switch workspace"
            >
                <span className="ws-switcher__dot" style={{ backgroundColor: displayColor }} />
                <span className="ws-switcher__name">{displayName}</span>
                <span className={`ws-switcher__arrow ${open ? 'ws-switcher__arrow--open' : ''}`}>▾</span>
            </button>

            {open && (
                <div className="ws-switcher__dropdown">
                    <div className="ws-switcher__header">Workspaces</div>
                    {isSuperAdmin && (
                        <button
                            type="button"
                            className={`ws-switcher__item ${!activeWorkspaceId ? 'ws-switcher__item--active' : ''}`}
                            onClick={() => { setActiveWorkspaceId(null); setOpen(false); }}
                        >
                            <span className="ws-switcher__dot" style={{ background: 'linear-gradient(135deg, #0ea5e9, #a855f7)' }} />
                            <span>All Workspaces</span>
                        </button>
                    )}
                    {workspaces.map((ws) => (
                        <button
                            key={ws.id}
                            type="button"
                            className={`ws-switcher__item ${activeWorkspaceId === ws.id ? 'ws-switcher__item--active' : ''}`}
                            onClick={() => { setActiveWorkspaceId(ws.id); setOpen(false); }}
                        >
                            <span className="ws-switcher__dot" style={{ backgroundColor: ws.color || '#0ea5e9' }} />
                            <span>{ws.name}</span>
                            {ws.description && <span className="ws-switcher__desc">{ws.description}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
