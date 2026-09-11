'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CatalogItemDto,
  PriceBreaksPayload,
  ProductTemplateDto,
  ResolveLinesPayload,
  ResolvedLinesDto,
  TemplatePriceBreaksDto,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';

/** Debounces a value so typing in the picker does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export interface CatalogSearchResult {
  items: CatalogItemDto[];
  templates: ProductTemplateDto[];
  isLoading: boolean;
}

/**
 * Backs the item picker. Templates are fetched once and filtered client-side —
 * a shop has a handful of them, and a round trip per keystroke to match five
 * names is not worth it. Catalog items can run to thousands, so those are
 * searched on the server.
 */
export function useCatalogSearch(query: string, enabled = true): CatalogSearchResult {
  const debounced = useDebounced(query.trim());

  const itemsQuery = useQuery({
    queryKey: queryKeys.catalogItems(debounced),
    queryFn: () => api.catalog.searchItems(debounced || undefined, 25),
    enabled,
    staleTime: 30_000,
  });

  const templatesQuery = useQuery({
    queryKey: queryKeys.catalogTemplates,
    queryFn: api.catalog.listTemplates,
    enabled,
    staleTime: 60_000,
  });

  const templates = useMemo(() => {
    const all = templatesQuery.data ?? [];
    if (!debounced) return all;
    const term = debounced.toLowerCase();
    return all.filter(
      (template) =>
        template.name.toLowerCase().includes(term) ||
        template.templateKey.toLowerCase().includes(term) ||
        (template.description ?? '').toLowerCase().includes(term),
    );
  }, [templatesQuery.data, debounced]);

  return {
    items: itemsQuery.data ?? [],
    templates,
    isLoading: itemsQuery.isLoading || templatesQuery.isLoading,
  };
}

export function useCostingPolicy() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.costingPolicy,
    queryFn: api.catalog.getPolicy,
    staleTime: 5 * 60_000,
  });

  return { policy: data, isLoading };
}

/**
 * Asks the server to price a set of catalog references.
 *
 * Every price and cost on the returned lines comes from the API — this hook
 * deliberately computes nothing, so the editor and the saved quote can never
 * disagree about what something costs.
 */
export function useLineResolver() {
  const [isResolving, setIsResolving] = useState(false);

  const resolve = useCallback(
    async (payload: ResolveLinesPayload): Promise<ResolvedLinesDto | null> => {
      setIsResolving(true);
      try {
        return await api.catalog.resolveLines(payload);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not price those lines');
        return null;
      } finally {
        setIsResolving(false);
      }
    },
    [],
  );

  return { resolve, isResolving };
}

export interface PriceBreakState {
  data: TemplatePriceBreaksDto | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Live price breaks for the configurator.
 *
 * A costing failure here is expected traffic, not an exception — a custom
 * shape too big for any sheet in stock comes back as a 400 with a sentence
 * explaining exactly that. It belongs inline next to the dimensions, so it is
 * returned as `error` rather than thrown or toasted.
 */
export function usePriceBreaks(
  templateId: string | null,
  payload: PriceBreaksPayload,
  enabled: boolean,
): PriceBreakState {
  const [state, setState] = useState<PriceBreakState>({
    data: null,
    isLoading: false,
    error: null,
  });

  const serialised = JSON.stringify(payload);

  useEffect(() => {
    if (!templateId || !enabled) {
      setState({ data: null, isLoading: false, error: null });
      return;
    }

    let ignore = false;
    setState((prev) => ({ ...prev, isLoading: true }));

    const timer = setTimeout(() => {
      api.catalog
        .priceBreaks(templateId, JSON.parse(serialised) as PriceBreaksPayload)
        .then((data) => {
          if (!ignore) setState({ data, isLoading: false, error: null });
        })
        .catch((error: unknown) => {
          if (ignore) return;
          setState({
            data: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Could not price this configuration',
          });
        });
    }, 250);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [templateId, serialised, enabled]);

  return state;
}
