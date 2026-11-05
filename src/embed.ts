import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type EmbedFit = 'contain' | 'cover';

export interface EmbedOptions {
  embed: boolean;
  theme: ThemeChoice;
  fit: EmbedFit;
  refreshMs: number;
  parentOrigin: string | null;
}

const DEFAULT_REFRESH_SECONDS = 60;
const MIN_REFRESH_SECONDS = 15;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isTruthy(value: string | null): boolean {
  return value !== null && ['1', 'true', 'yes', ''].includes(value.toLowerCase());
}

export function readEmbedOptions(search: string = window.location.search): EmbedOptions {
  const params = new URLSearchParams(search);
  const theme = params.get('theme');
  const refreshSeconds = Number(params.get('refresh') ?? DEFAULT_REFRESH_SECONDS);
  return {
    embed: isTruthy(params.get('embed')),
    theme: isThemeChoice(theme) ? theme : 'system',
    fit: params.get('fit') === 'cover' ? 'cover' : 'contain',
    refreshMs: Math.max(
      MIN_REFRESH_SECONDS,
      Number.isFinite(refreshSeconds) ? refreshSeconds : DEFAULT_REFRESH_SECONDS,
    ) * 1000,
    parentOrigin: params.get('parent_origin'),
  };
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Resolves the active theme. The initial choice comes from `?theme=`; a parent
 * frame can change it with `postMessage({ type: 'circtime-theme', theme })`.
 * Messages are accepted only from the parent window on the same origin, or
 * on the origin given in `?parent_origin=`.
 */
export function useEmbedTheme(options: EmbedOptions): ResolvedTheme {
  const [choice, setChoice] = useState<ThemeChoice>(options.theme);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!query) return undefined;
    const onChange = () => setSystem(query.matches ? 'light' : 'dark');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent || window.parent === window) return;
      const allowed = event.origin === window.location.origin
        || (options.parentOrigin !== null && event.origin === options.parentOrigin);
      if (!allowed) return;
      const data = event.data as { type?: unknown; theme?: unknown } | null;
      if (data?.type === 'circtime-theme' && isThemeChoice(data.theme)) setChoice(data.theme);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [options.parentOrigin]);

  return choice === 'system' ? system : choice;
}
