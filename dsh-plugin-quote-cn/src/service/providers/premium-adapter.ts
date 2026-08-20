import type { Quote, QuoteProvider } from '../types';

export type PremiumName = 'longbridge' | 'futu' | 'tonglian';

export function fetchPremium(provider: PremiumName, token: string): QuoteProvider {
  switch (provider) {
    case 'longbridge':
      return (codes) => fetchLongbridge(codes, token);
    case 'futu':
      return (codes) => fetchFutu(codes, token);
    case 'tonglian':
      return (codes) => fetchTonglian(codes, token);
    default: {
      const _exhaustive: never = provider;
      void _exhaustive;
      return () => Promise.resolve([]);
    }
  }
}

async function fetchLongbridge(_codes: string[], _token: string): Promise<Quote[]> {
  throw new Error('longbridge provider is not implemented; falling back is handled by the service');
}

async function fetchFutu(_codes: string[], _token: string): Promise<Quote[]> {
  throw new Error('futu provider is not implemented');
}

async function fetchTonglian(_codes: string[], _token: string): Promise<Quote[]> {
  throw new Error('tonglian provider is not implemented');
}
