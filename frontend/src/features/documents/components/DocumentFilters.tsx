import React, { useEffect, useState } from 'react';
import { Search, X, Archive } from 'lucide-react';
import { DocumentCategory, DocumentStatus } from '../types/document.types';
import { STATUS_CONFIG } from './DocumentStatusBadge';

interface DocumentFiltersProps {
  search: string;
  onSearchChange: (val: string) => void;
  categoryId: string;
  onCategoryChange: (val: string) => void;
  status: DocumentStatus | '';
  onStatusChange: (val: DocumentStatus | '') => void;
  includeArchived: boolean;
  onIncludeArchivedChange: (val: boolean) => void;
  categories: DocumentCategory[];
  isAdmin: boolean;
  totalCount: number;
}

export const DocumentFilters: React.FC<DocumentFiltersProps> = ({
  search,
  onSearchChange,
  categoryId,
  onCategoryChange,
  status,
  onStatusChange,
  includeArchived,
  onIncludeArchivedChange,
  categories,
  isAdmin,
  totalCount,
}) => {
  const [searchInput, setSearchInput] = useState(search);

  // Debounce search input by 350ms
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      onSearchChange(searchInput);
    }, 350);

    return () => clearTimeout(timer);
  }, [searchInput, search, onSearchChange]);

  const hasActiveFilters = !!search || !!categoryId || !!status || (isAdmin && includeArchived);

  const handleClearFilters = () => {
    setSearchInput('');
    onSearchChange('');
    onCategoryChange('');
    onStatusChange('');
    onIncludeArchivedChange(false);
  };

  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card space-y-3">
      <div className="flex flex-col md:flex-row items-center gap-3">
        {/* Search Bar */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por título, órgão emissor, responsável..."
            className="w-full pl-10 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                onSearchChange('');
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Select */}
        <div className="w-full md:w-56">
          <select
            value={categoryId}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition text-slate-700"
          >
            <option value="">Todas as Categorias</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name} {cat.documentCount !== undefined ? `(${cat.documentCount})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Status Select */}
        <div className="w-full md:w-52">
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value as DocumentStatus | '')}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 transition text-slate-700"
          >
            <option value="">Todos os Status</option>
            {Object.entries(STATUS_CONFIG).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Secondary Bar: Admin Archived Toggle & Results count & Clear */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs text-slate-500">
        <div className="flex items-center space-x-4">
          <span>
            Exibindo <strong>{totalCount}</strong> documento(s)
          </span>

          {/* Admin Exclusive: Include Archived Toggle */}
          {isAdmin && (
            <label className="inline-flex items-center space-x-2 cursor-pointer font-medium text-slate-700 select-none hover:text-navy-900 transition">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => onIncludeArchivedChange(e.target.checked)}
                className="w-4 h-4 text-navy-600 rounded border-slate-300 focus:ring-navy-500 focus:ring-2"
              />
              <span className="flex items-center space-x-1">
                <Archive className="w-3.5 h-3.5 text-slate-400" />
                <span>Exibir Arquivados</span>
              </span>
            </label>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="inline-flex items-center text-xs font-semibold text-navy-700 hover:text-navy-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Limpar Filtros
          </button>
        )}
      </div>
    </div>
  );
};

export default DocumentFilters;
