'use client';

import { useState } from 'react';
import { User, Plus, Trash2, Sparkles } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/field';
import type { CreateQuotePayload, QuoteItem } from '@/hooks/use-quotes';

interface CreateQuoteModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateQuotePayload) => Promise<void>;
}

type TabType = 'ai' | 'manual';

interface LocalItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export function CreateQuoteModal({ open, onClose, onSubmit }: CreateQuoteModalProps) {
  const [tab, setTab] = useState<TabType>('ai');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Common title
  const [title, setTitle] = useState('');

  // AI draft prompt
  const [prompt, setPrompt] = useState('');

  // Manual items
  const [items, setItems] = useState<LocalItem[]>([
    { id: '1', description: '', quantity: 1, unitPrice: 0 },
  ]);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), description: '', quantity: 1, unitPrice: 0 },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleItemChange = (
    id: string,
    field: keyof LocalItem,
    value: string | number
  ) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const calculatedTotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0
  );

  const resetForm = () => {
    setTitle('');
    setPrompt('');
    setItems([{ id: '1', description: '', quantity: 1, unitPrice: 0 }]);
    setError(null);
    setLoading(false);
    setTab('ai');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    try {
      setLoading(true);
      if (tab === 'ai') {
        if (!prompt.trim()) {
          setError('Please provide a prompt for the AI agent');
          setLoading(false);
          return;
        }
        await onSubmit({
          createdBy: 'AI',
          title: title.trim(),
          prompt: prompt.trim(),
        });
      } else {
        const formattedItems: QuoteItem[] = items.map((item) => ({
          id: item.id,
          type: 'product',
          description: item.description.trim() || 'Item',
          quantity: Number(item.quantity) || 1,
          unitPrice: Number(item.unitPrice) || 0,
          discount: 0,
          taxRate: 0,
          subtotal: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
        }));

        await onSubmit({
          createdBy: 'HUMAN',
          title: title.trim(),
          items: formattedItems,
          totalAmount: calculatedTotal,
        });
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quote');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create New Quote"
      description="Generate an AI-assisted quote draft or enter items manually."
      size="lg"
    >
      <div className="space-y-5">
        {/* Tab Selection */}
        <div className="flex border-b border-border/80">
          <button
            type="button"
            onClick={() => setTab('ai')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
              tab === 'ai'
                ? 'border-brand text-brand-hover font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <Sparkles className="size-4 text-brand-hover" />
            AI Agent Draft
          </button>
          <button
            type="button"
            onClick={() => setTab('manual')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
              tab === 'manual'
                ? 'border-brand text-brand-hover font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <User className="size-4" />
            Manual Entry
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
            {error}
          </div>
        )}

        <form id="create-quote-form" onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Quote Title"
            placeholder="e.g., Acme Corp - Enterprise Software License Quote"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          {tab === 'ai' ? (
            <div className="space-y-4">
              <Textarea
                label="AI Agent Prompt"
                placeholder="Draft quote for ACME Corp: 50 Pro licenses with 10% discount and annual support."
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                hint="Describe what items, quantities, or discounts the AI agent should calculate and include in the draft."
                required
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-ink">Line Items</label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
                  <Plus className="size-3.5" />
                  Add Item
                </Button>
              </div>

              <div className="space-y-3">
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex-1">
                      <Input
                        placeholder={`Item ${index + 1} description`}
                        value={item.description}
                        onChange={(e) =>
                          handleItemChange(item.id, 'description', e.target.value)
                        }
                      />
                    </div>
                    <div className="w-full sm:w-24">
                      <Input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) =>
                          handleItemChange(item.id, 'quantity', parseInt(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="w-full sm:w-32">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Unit Price"
                        value={item.unitPrice}
                        onChange={(e) =>
                          handleItemChange(item.id, 'unitPrice', parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="w-full text-right text-sm font-medium text-ink sm:w-28">
                      ${((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toFixed(2)}
                    </div>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1.5 text-ink-subtle transition-colors hover:text-danger"
                        title="Remove Item"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end border-t border-border pt-3">
                <div className="text-right">
                  <span className="text-sm text-ink-muted">Total Amount: </span>
                  <span className="text-lg font-semibold text-ink">
                    ${calculatedTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {tab === 'ai' ? 'Generate AI Draft' : 'Create Quote'}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
