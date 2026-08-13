import '@testing-library/react';

// matchMedia is referenced by the prefers-reduced-motion branch in the D3
// transition path. jsdom doesn't implement it, so stub it for unit tests.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
