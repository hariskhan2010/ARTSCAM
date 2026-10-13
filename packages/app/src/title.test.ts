import { describe, expect, it } from 'vitest';
import { appTitle } from './title';

describe('appTitle', () => {
  it('includes the core format version', () => {
    expect(appTitle()).toBe('Naqsh (format v0.1)');
  });
});
