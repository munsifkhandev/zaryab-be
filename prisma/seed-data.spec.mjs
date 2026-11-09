import { describe, expect, it } from 'vitest';
import { permissions, rolePermissions } from './seed-data.mjs';

describe('initial authorization policy', () => {
  const codes = permissions.map(([code]) => code);

  it('defines unique, described permission codes and all four roles', () => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const [code, description] of permissions) {
      expect(code).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(rolePermissions).sort()).toEqual(['ADMIN', 'CUSTOMER', 'STAFF', 'SUPER_ADMIN']);
  });

  it('only grants defined permissions, without duplicates', () => {
    for (const granted of Object.values(rolePermissions)) {
      expect(new Set(granted).size).toBe(granted.length);
      for (const code of granted) expect(codes).toContain(code);
    }
    expect(rolePermissions.SUPER_ADMIN).toEqual(codes);
  });

  it('does not give customers admin privileges or allow admins to elevate staff', () => {
    expect(rolePermissions.CUSTOMER).toEqual([]);
    for (const role of ['ADMIN', 'STAFF']) {
      expect(rolePermissions[role]).not.toContain('users.manage');
      expect(rolePermissions[role]).not.toContain('roles.manage');
    }
    expect(rolePermissions.STAFF).not.toContain('orders.refund');
    expect(rolePermissions.STAFF).not.toContain('inventory.adjust');
    expect(rolePermissions.STAFF).not.toContain('payments.record');
  });
});
