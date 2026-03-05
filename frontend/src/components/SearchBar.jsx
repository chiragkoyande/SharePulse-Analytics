import React from 'react';

/**
 * SearchBar — Text input with clear button.
 */
export default function SearchBar({ searchQuery, onSearchChange }) {
    return (
        <div className="search-bar">
            <div className="search-bar__input-wrap">
                <svg className="search-bar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                    type="text"
                    className="search-bar__input"
                    placeholder="Search by URL, title, or domain..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                {searchQuery && (
                    <button
                        className="search-bar__clear"
                        onClick={() => onSearchChange('')}
                        title="Clear search"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
}
