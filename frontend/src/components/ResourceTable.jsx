import React, { useState } from 'react';

/**
 * ResourceTable — Desktop table view + mobile card view.
 * Privacy-first: No sender, group, or context data displayed.
 */
export default function ResourceTable({ resources, loading, onVote, onSave }) {
    if (loading) {
        return (
            <div className="resource-table__loading">
                <div className="spinner" />
                <p>Loading resources...</p>
            </div>
        );
    }

    if (resources.length === 0) {
        return (
            <div className="resource-table__empty">
                <h3>No resources found</h3>
                <p>Start the WhatsApp bot to collect resources, or adjust your search.</p>
            </div>
        );
    }

    return (
        <div className="resource-table__wrapper">
            {/* Desktop table */}
            <table className="resource-table">
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>URL</th>
                        <th>Domain</th>
                        <th>Votes</th>
                        <th>Save</th>
                    </tr>
                </thead>
                <tbody>
                    {resources.map((r, i) => (
                        <tr key={r.id} className="resource-table__row" style={{ '--row-index': i }}>
                            <td className="resource-table__title">{r.title || 'New Resource'}</td>
                            <td className="resource-table__url">
                                <a href={r.url} target="_blank" rel="noopener noreferrer">
                                    {displayUrl(r.url, 40)}
                                </a>
                            </td>
                            <td>
                                <span className="resource-table__domain-badge">{r.domain || '—'}</span>
                            </td>
                            <td>
                                <VoteButtons resource={r} onVote={onVote} />
                            </td>
                            <td>
                                <SaveButton resource={r} onSave={onSave} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Mobile cards */}
            <div className="resource-cards">
                {resources.map((r) => (
                    <div key={r.id} className="resource-card">
                        <div className="resource-card__header">
                            <h4>{r.title || 'New Resource'}</h4>
                        </div>
                        <a className="resource-card__url" href={r.url} target="_blank" rel="noopener noreferrer">
                            {displayUrl(r.url, 50)}
                        </a>
                        <div className="resource-card__meta">
                            <span className="resource-table__domain-badge">{r.domain || 'unknown'}</span>
                        </div>
                        <div className="resource-card__actions">
                            <VoteButtons resource={r} onVote={onVote} />
                            <SaveButton resource={r} onSave={onSave} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Like / Dislike inline buttons.
 */
function VoteButtons({ resource, onVote }) {
    const [voting, setVoting] = useState(null);

    const handleVote = async (vote) => {
        if (voting) return;
        setVoting(vote);
        try {
            await onVote(resource.url_hash, vote);
        } finally {
            setVoting(null);
        }
    };

    return (
        <div className="vote-buttons">
            <button
                className={`vote-btn vote-btn--like ${voting === 'like' ? 'vote-btn--loading' : ''}`}
                onClick={() => handleVote('like')}
                disabled={!!voting}
                title="Like"
            >
                Like <span>{resource.like_count || 0}</span>
            </button>
            <button
                className={`vote-btn vote-btn--dislike ${voting === 'dislike' ? 'vote-btn--loading' : ''}`}
                onClick={() => handleVote('dislike')}
                disabled={!!voting}
                title="Dislike"
            >
                Dislike <span>{resource.dislike_count || 0}</span>
            </button>
        </div>
    );
}

function SaveButton({ resource, onSave }) {
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (saving || !onSave) return;
        setSaving(true);
        try {
            await onSave(resource.url_hash, !resource.is_saved);
        } finally {
            setSaving(false);
        }
    };

    return (
        <button
            className={`save-btn ${resource.is_saved ? 'save-btn--active' : ''} ${saving ? 'save-btn--loading' : ''}`}
            onClick={handleSave}
            disabled={saving}
            title={resource.is_saved ? 'Remove from saved' : 'Save this link'}
        >
            {resource.is_saved ? 'Saved' : 'Save'}
        </button>
    );
}

function displayUrl(url, max) {
    if (!url) return '';
    try {
        const u = new URL(url);
        const display = u.hostname + u.pathname;
        return display.length > max ? display.slice(0, max) + '…' : display;
    } catch {
        return url.length > max ? url.slice(0, max) + '…' : url;
    }
}
