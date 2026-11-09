export const permissions = [
  ['products.read', 'Read administrative catalog data'],
  ['products.create', 'Create products and variants'],
  ['products.update', 'Update and publish products'],
  ['products.delete', 'Archive products'],
  ['inventory.read', 'Read stock balances and movements'],
  ['inventory.adjust', 'Adjust stock quantities'],
  ['orders.read', 'Read administrative order data'],
  ['orders.update', 'Update order fulfillment'],
  ['orders.refund', 'Initiate order refunds'],
  ['payments.record', 'Record cash received for delivered orders'],
  ['shipping.manage', 'Manage delivery methods and tax rates'],
  ['customers.read', 'Read administrative customer data'],
  ['customers.update', 'Update customer accounts'],
  ['promotions.manage', 'Manage promotions and coupons'],
  ['cms.manage', 'Manage published content'],
  ['analytics.read', 'Read store analytics'],
  ['users.manage', 'Manage staff accounts and assignments'],
  ['roles.manage', 'Manage role permission assignments'],
];

const codes = permissions.map(([code]) => code);

export const rolePermissions = {
  SUPER_ADMIN: codes,
  ADMIN: codes.filter((code) => !['users.manage', 'roles.manage'].includes(code)),
  STAFF: ['products.read', 'inventory.read', 'orders.read', 'orders.update', 'customers.read'],
  // Customer operations require authentication and ownership, not admin permissions.
  CUSTOMER: [],
};
