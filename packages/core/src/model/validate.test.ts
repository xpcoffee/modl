import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLoadable, validateDocument, type IssueCode } from './validate.js';

const CHECKOUT = join(import.meta.dirname, '..', '..', 'fixtures', 'checkout.modl.json');

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
  it('version-unsupported: formatVersion is newer than this build reads', () => {
    const document = fixture();
    document['formatVersion'] = 99;
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('version-unsupported');
    expect(result.errors[0]?.message).toContain('newer than this build');
  });

  it('reads a version 1 document by migrating it', () => {
    const document = fixture();
    document['formatVersion'] = 1;
    // Version 1 held one value per tag and had no sources.
    for (const element of Object.values(document['model']['elements']) as Record<string, any>[]) {
      element['tags'] = Object.fromEntries(
        Object.entries(element['tags']).map(([key, values]) => [key, (values as string[])[0]]),
      );
      delete element['sources'];
    }
    expect(validateDocument(document).errors).toEqual([]);
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

  it('accepts a readable id, so a document can be written by hand', () => {
    const document = fixture();
    document['model']['elements']['checkout-ui'] = {
      ...document['model']['elements'][UI],
      id: 'checkout-ui',
    };
    expect(codes(validateDocument(document).errors)).not.toContain('schema-invalid');
  });

  it('schema-invalid: an id with a space in it', () => {
    const document = fixture();
    document['model']['elements']['not valid'] = {
      ...document['model']['elements'][UI],
      id: 'not valid',
    };
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

  it('accepts an element inside a group', () => {
    const document = fixture();
    document['model']['elements'][UI]['groupId'] = GATEWAY;
    const result = validateDocument(document);
    expect(result.errors).toEqual([]);
    expect(isLoadable(result)).toBe(true);
  });

  it('unknown-reference: groupId names no element', () => {
    const document = fixture();
    document['model']['elements'][UI]['groupId'] = '99999999-9999-4999-8999-999999999999';
    expect(codes(validateDocument(document).errors)).toContain('unknown-reference');
  });

  it('not-a-group: groupId names a connection', () => {
    const document = fixture();
    document['model']['elements'][UI]['groupId'] = AUTHORISE;
    expect(codes(validateDocument(document).errors)).toContain('not-a-group');
  });

  it('group-cycle: two elements name each other', () => {
    const document = fixture();
    document['model']['elements'][UI]['groupId'] = GATEWAY;
    document['model']['elements'][GATEWAY]['groupId'] = UI;
    const result = validateDocument(document);
    expect(codes(result.errors)).toContain('group-cycle');
    expect(isLoadable(result)).toBe(false);
  });

  it('group-cycle: an element names itself', () => {
    const document = fixture();
    document['model']['elements'][UI]['groupId'] = UI;
    expect(codes(validateDocument(document).errors)).toContain('group-cycle');
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

  /** The fixture grown to `count` elements, every tag stripped. */
  function untagged(count: number): Record<string, any> {
    const document = fixture();
    const elements = document['model']['elements'];
    for (const element of Object.values(elements) as Record<string, any>[]) {
      element['tags'] = {};
    }
    for (let i = Object.keys(elements).length; i < count; i += 1) {
      const id = `service-${i}`;
      elements[id] = { ...elements[UI], id, title: `Service ${i}` };
    }
    return document;
  }

  it('document-untagged: a document at the threshold with no tags', () => {
    const result = validateDocument(untagged(30));
    expect(codes(result.warnings)).toContain('document-untagged');
    expect(isLoadable(result)).toBe(true);
  });

  it('document-untagged: stays quiet below the threshold', () => {
    expect(codes(validateDocument(untagged(29)).warnings)).not.toContain('document-untagged');
  });

  it('document-untagged: one tagged element silences it', () => {
    const document = untagged(30);
    document['model']['elements'][UI]['tags'] = { flow: ['checkout'] };
    expect(codes(validateDocument(document).warnings)).not.toContain('document-untagged');
  });

  it('document-untagged: a tag key with no values does not count', () => {
    const document = untagged(30);
    document['model']['elements'][UI]['tags'] = { flow: [] };
    expect(codes(validateDocument(document).warnings)).toContain('document-untagged');
  });
});

describe('decision labels', () => {
  const DECISION = '77777777-7777-4777-8777-777777777777';

  /** The fixture with the gateway's two lines running through a decision. */
  function branching(labels: Record<string, string>): Record<string, any> {
    const document = fixture();
    document['model']['elements'][DECISION] = {
      id: DECISION,
      kind: 'connection-node',
      shape: 'diamond',
      labels,
      title: 'authorised?',
      description: '',
      tags: {},
      sources: [],
      groupId: null,
    };
    document['model']['elements'][AUTHORISE]['to'] = [DECISION];
    document['model']['elements']['55555555-5555-4555-8555-555555555555']['from'] = [DECISION];
    return document;
  }

  it('accepts a label against a connection touching the node', () => {
    const result = validateDocument(branching({ [AUTHORISE]: 'card accepted' }));
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).not.toContain('label-unattached');
  });

  it('label-unattached: a label naming a connection that misses the node', () => {
    const result = validateDocument(branching({ '55555555-5555-4555-8555-555555555556': 'no' }));
    expect(codes(result.warnings)).toContain('label-unattached');
    expect(isLoadable(result)).toBe(true);
  });

  it('label-unattached: a label naming an entity rather than a connection', () => {
    expect(codes(validateDocument(branching({ [UI]: 'no' })).warnings)).toContain(
      'label-unattached',
    );
  });

  it('reads a node written without labels at all', () => {
    const document = branching({});
    delete document['model']['elements'][DECISION]['labels'];
    const result = validateDocument(document);
    expect(result.errors).toEqual([]);
  });
});

describe('styles', () => {
  it('schema-invalid: a colour that is not lowercase #rrggbb', () => {
    const document = fixture();
    document['model']['elements'][UI]['style'] = { fill: 'RED' };
    expect(codes(validateDocument(document).errors)).toContain('schema-invalid');
  });

  it('schema-invalid: a fill on a connection', () => {
    const document = fixture();
    document['model']['elements'][AUTHORISE]['style'] = { fill: '#5b8def' };
    expect(codes(validateDocument(document).errors)).toContain('schema-invalid');
  });

  it('schema-invalid: an arrowhead on an entity', () => {
    const document = fixture();
    document['model']['elements'][UI]['style'] = { arrowhead: 'open' };
    expect(codes(validateDocument(document).errors)).toContain('schema-invalid');
  });

  it('accepts a styled entity and connection', () => {
    const document = fixture();
    document['model']['elements'][UI]['style'] = {
      fill: '#5b8def',
      stroke: '#46a758',
      strokeStyle: 'dotted',
    };
    document['model']['elements'][AUTHORISE]['style'] = { arrowhead: 'diamond' };
    expect(validateDocument(document).errors).toEqual([]);
  });
});
