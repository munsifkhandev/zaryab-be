import { describe, expect, it } from 'vitest';
import { assertAccountChange } from './admin.service.js';
describe('account administration invariants',()=>{
  it('forbids changing own access even when other roots exist',()=>{expect(()=>assertAccountChange('a','a',true,2,true)).toThrow();});
  it('refuses removing the last active root but permits another root to change non-root access',()=>{
    expect(()=>assertAccountChange('a','b',true,1,true)).toThrow();
    expect(()=>assertAccountChange('a','b',true,2,true)).not.toThrow();
    expect(()=>assertAccountChange('a','b',false,1,true)).not.toThrow();
    expect(()=>assertAccountChange('a','b',true,1,false)).not.toThrow();
  });
});
