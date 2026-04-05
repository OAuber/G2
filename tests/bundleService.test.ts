import { describe, it, expect } from 'vitest';
import { createG2Bundle, parseG2Bundle } from '../services/bundleService';

describe('bundleService', () => {
  it('createG2Bundle + parseG2Bundle font un aller-retour JSON', async () => {
    const gedcom = '0 HEAD\n0 TRLR\n';
    const blob = await createG2Bundle(gedcom, {
      version: '1.0',
      databaseName: 'Test DB',
    });
    const file = new File([blob], 't.json', { type: 'application/json' });
    const parsed = await parseG2Bundle(file);
    expect(parsed.gedcomContent).toContain('HEAD');
    expect(parsed.metadata.databaseName).toBe('Test DB');
  });
});
