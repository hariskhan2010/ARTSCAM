import { describe, expect, it } from 'vitest';
import { INTERNAL_UNIT, PROJECT_FORMAT, PROJECT_VERSION } from './index';

describe('@naqsh/core', () => {
  it('exposes the project format identity', () => {
    expect(PROJECT_FORMAT).toBe('naqsh-project');
    expect(PROJECT_VERSION).toBe('0.1');
  });

  it('uses millimetres internally', () => {
    expect(INTERNAL_UNIT).toBe('mm');
  });
});
