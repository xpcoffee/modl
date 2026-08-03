import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLoadable, validateDocument, type IssueCode } from './validate.js';

const CHECKOUT = join(import.meta.dirname, '..', '..', 'fixtures', 'checkout.dmap.json');

const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';

/** A fresh mutable copy of the fixture for each test. */
function fixture(): Record<string, any> {
  return JSON.parse(readFileSync(CHECKOUT, 'utf8'));
}

function codes(issues: { code: IssueCode }[]): IssueCode[] {
  return issues.map((issue) => issue.code);
}

describe('a valid document', () => {
  it('reports no errors and no warnings', () => {
    const result = validateDocument(fixture());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(isLoadable(result)).toBe(true);
  });
});

describe('errors', () => {
  it('version-unsupported: formatVersion is from the future', () => {
    const document = fixture();
    document['formatVersion'] = 99;
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('version-unsupported');
    expect(result.errors[0]?.message).toContain('expected 1');
  });

  it('schema-invalid: a required field is missing', () => {
    const document = fixture();
    delete document['model']['elements'][UI]['title'];
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('schema-invalid');
  });

  it('schema-invalid: an unknown kind', () => {
    const document = fixture();
    document['model']['elements'][UI]['kind'] = 'sprocket';
    expect(codes(validateDocument(document).errors)).toContain('schema-invalid');
  });

  it('schema-invalid: an id that is not a UUID', () => {
    const document = fixture();
    document['model']['elements']['nope'] = { ...document['model']['elements'][UI], id: 'nope' };
    expect(codes(validateDocument(document).errors)).toContain('schema-invalid');
  });

  it('id-key-mismatch: the map key differs from the element id', () => {
    const document = fixture();
    const moved = document['model']['elements'][LEDGER];
    delete document['model']['elements'][LEDGER];
    document['model']['elements']['66666666-6666-4666-8666-666666666666'] = moved;
    // The connection to LEDGER now dangles too, so filter to the code under test.
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('id-key-mismatch');
  });

  it('unknown-reference: a connection endpoint names no element', () => {
    const document = fixture();
    document['model']['elements'][AUTHORISE]['to'] = ['99999999-9999-4999-8999-999999999999'];
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('unknown-reference');
    expect(result.errors[0]?.elementId).toBe(AUTHORISE);
  });

  it('groups-unsupported: groupId is set before groups exist', () => {
    const document = fixture();
    document['model']['elements'][UI]['groupId'] = GATEWAY;
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('groups-unsupported');
    expect(isLoadable(result)).toBe(false);
  });

  it('stops at the version check so later errors stay quiet', () => {
    const document = fixture();
    document['formatVersion'] = 99;
    document['model']['elements'][AUTHORISE]['to'] = ['99999999-9999-4999-8999-999999999999'];
    expect(codes(validateDocument(document).errors)).toEqual(['version-unsupported']);
  });
});

describe('warnings', () => {
  it('empty-endpoints: a connection with no target', () => {
    const document = fixture();
    document['model']['elements'][AUTHORISE]['to'] = [];
    const result = validateDocument(document);
    expect(codes(result.warnings)).toContain('empty-endpoints');
    expect(isLoadable(result)).toBe(true);
  });

  it('orphan-entity: an entity with no connections', () => {
    const document = fixture();
    document['model']['elements']['66666666-6666-4666-8666-666666666666'] = {
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'entity',
      type: 'component',
      title: 'Lonely service',
      description: '',
      tags: {},
      groupId: null,
    };
    const result = validateDocument(document);
    expect(codes(result.warnings)).toContain('orphan-entity');
    expect(isLoadable(result)).toBe(true);
  });

  it('duplicate-title: two elements share a title', () => {
    const document = fixture();
    document['model']['elements'][LEDGER]['title'] = 'Checkout UI';
    const result = validateDocument(document);
    expect(codes(result.warnings)).toContain('duplicate-title');
  });

  it('duplicate-title: ignores elements with empty titles', () => {
    const document = fixture();
    document['model']['elements'][UI]['title'] = '';
    document['model']['elements'][LEDGER]['title'] = '';
    expect(codes(validateDocument(document).warnings)).not.toContain('duplicate-title');
  });

  it('paradigm-mismatch: a transition pointing at a component', () => {
    const document = fixture();
    document['model']['elements'][AUTHORISE]['type'] = 'transition';
    const result = validateDocument(document);
    expect(codes(result.warnings)).toContain('paradigm-mismatch');
    expect(result.warnings[0]?.message).toContain('interaction');
    expect(isLoadable(result)).toBe(true);
  });

  it('paradigm-mismatch: stays quiet when the type matches the target', () => {
    const document = fixture();
    document['model']['elements'][LEDGER]['type'] = 'state';
    document['model']['elements']['55555555-5555-4555-8555-555555555555']['type'] = 'transition';
    expect(codes(validateDocument(document).warnings)).not.toContain('paradigm-mismatch');
  });
});
