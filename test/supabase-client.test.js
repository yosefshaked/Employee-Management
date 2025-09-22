import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSupabase,
  getCachedSupabase,
  resetSupabase,
} from '../src/lib/supabase-manager.js';

describe('shared Supabase client module', () => {
  it('exposes the expected helpers', () => {
    assert.equal(typeof getSupabase, 'function');
    assert.equal(typeof getCachedSupabase, 'function');
    assert.equal(typeof resetSupabase, 'function');
  });
});
