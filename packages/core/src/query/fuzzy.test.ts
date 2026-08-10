import { describe, expect, it } from 'vitest';
import { fuzzyMatches, fuzzyScore } from './fuzzy.js';

describe('fuzzyScore', () => {
  it('matches an exact substring', () => {
    expect(fuzzyScore('check', 'Checkout UI')).not.toBeNull();
  });

  it('matches characters spread through the candidate', () => {
    expect(fuzzyScore('chkui', 'Checkout UI')).not.toBeNull();
  });

  it('ignores case', () => {
    expect(fuzzyScore('CHECKOUT', 'checkout ui')).not.toBeNull();
  });

  it('does not match characters out of order', () => {
    expect(fuzzyScore('uicheck', 'Checkout UI')).toBeNull();
  });

  it('does not match a character the candidate lacks', () => {
    expect(fuzzyScore('checkz', 'Checkout UI')).toBeNull();
  });

  it('skips spaces in the query', () => {
    expect(fuzzyScore('payment gate', 'PaymentGateway')).not.toBeNull();
  });

  it('scores an empty query as a match worth nothing', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('ranks a contiguous match above a scattered one', () => {
    const contiguous = fuzzyScore('ledger', 'Ledger') ?? 0;
    const scattered = fuzzyScore('ledger', 'Loud edgy generator') ?? 0;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it('ranks a word start above a mid-word landing', () => {
    const start = fuzzyScore('g', 'Payment gateway') ?? 0;
    const middle = fuzzyScore('g', 'Ledger') ?? 0;
    expect(start).toBeGreaterThan(middle);
  });

  it('ranks a short candidate above a long one carrying the same match', () => {
    const short = fuzzyScore('ui', 'UI') ?? 0;
    const long = fuzzyScore('ui', 'UI for the checkout flow and everything else') ?? 0;
    expect(short).toBeGreaterThan(long);
  });
});

describe('fuzzyMatches', () => {
  it('reports a match without its score', () => {
    expect(fuzzyMatches('gw', 'Payment gateway')).toBe(true);
    expect(fuzzyMatches('zz', 'Payment gateway')).toBe(false);
  });
});
