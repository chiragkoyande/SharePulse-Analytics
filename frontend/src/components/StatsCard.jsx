import React from 'react';

/**
 * StatsCard — Displays a single metric with icon, value, label.
 */
export default function StatsCard({ icon, value, label, color = '#6366f1' }) {
    return (
        <div className="stats-card" style={{ '--accent': color }}>
            <div className="stats-card__icon">{icon}</div>
            <div className="stats-card__body">
                <span className="stats-card__value">{value}</span>
                <span className="stats-card__label">{label}</span>
            </div>
        </div>
    );
}
