'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/primitives';

interface BadgeSelectCellEditorProps {
  value: string;
  label: string;
  tone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  options: { value: string; label: string; tone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' }[];
  onCommit: (next: string) => void;
}

export function BadgeSelectCellEditor({
  value,
  label,
  tone,
  options,
  onCommit,
}: BadgeSelectCellEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="cursor-pointer hover:opacity-85 transition-opacity"
      >
        <Badge tone={tone}>{label}</Badge>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-36 bg-surface border border-border/60 rounded-md shadow-lg p-1 flex flex-col gap-0.5">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onCommit(opt.value);
                setIsOpen(false);
              }}
              className={`text-left text-xs px-2 py-1 rounded-sm hover:bg-surface-muted transition-colors flex items-center justify-between ${
                opt.value === value ? 'font-semibold text-brand' : 'text-ink'
              }`}
            >
              <span>{opt.label}</span>
              <Badge tone={opt.tone} className="scale-75 origin-right">
                {opt.label}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
