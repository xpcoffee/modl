import { describe, expect, it } from 'vitest';
import { fileStem, suggestedFileName } from './file-name.js';

describe('suggestedFileName', () => {
  it('appends the extension to the title', () => {
    expect(suggestedFileName('Checkout domain')).toBe('Checkout domain.modl.json');
  });

  it('replaces characters no filesystem accepts', () => {
    expect(suggestedFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j.modl.json');
  });

  it('drops trailing dots and spaces', () => {
    expect(suggestedFileName('payments. ')).toBe('payments.modl.json');
  });

  it('falls back to domain when nothing survives', () => {
    expect(suggestedFileName('   ')).toBe('domain.modl.json');
    expect(suggestedFileName('...')).toBe('domain.modl.json');
  });
});

describe('fileStem', () => {
  it('strips the document extension whole', () => {
    expect(fileStem('payments.modl.json')).toBe('payments');
  });

  it('strips a plain extension', () => {
    expect(fileStem('payments.json')).toBe('payments');
  });

  it('keeps a name with no extension', () => {
    expect(fileStem('payments')).toBe('payments');
  });

  it('keeps a leading dot', () => {
    expect(fileStem('.modl')).toBe('.modl');
  });
});
