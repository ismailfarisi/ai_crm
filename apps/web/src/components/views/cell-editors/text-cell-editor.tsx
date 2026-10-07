'use client';

import React, { useState, useEffect, useRef } from 'react';

interface TextCellEditorProps {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

export function TextCellEditor({ value, onCommit, onCancel }: TextCellEditorProps) {
  const [val, setVal] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onCommit(val.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(val.trim())}
      onKeyDown={handleKeyDown}
      className="w-full px-1.5 py-0.5 text-xs bg-surface border border-brand rounded-sm outline-none shadow-xs"
    />
  );
}
