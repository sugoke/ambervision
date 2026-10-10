// Access policy — the single place where "who may see what" decisions live.
//
// Every publication and method derives its role groups from here. Flipping a
// business decision is a one-line change in this file, nowhere else.
//
// Decisions (confirmed 2026-10-10):
//   - compliance has admin-equivalent READ access everywhere
//   - RM / assistant see their own clients only — except the order book, which
//     stays firm-wide for the desk workflow
//   - clients see product-level data (reports, charts, schedules) only for
//     products they hold
//   - staff / introducer / life_insurance / prospect fail closed: no client data
//     unless a specific feature grants it explicitly
import { USER_ROLES } from '/imports/api/users';

export const ACCESS_POLICY = Object.freeze({
  complianceSeesAll: true,
  rmPerimeterIncludesBackupAccounts: true,
  rmSeesAllOrders: true,
  clientProductFeedsHeldOnly: true,
  staffProductMasterDataOpen: true,
  otherRolesFailClosed: true
});

/** Read-everything roles. */
export const SEE_ALL_ROLES = Object.freeze(
  ACCESS_POLICY.complianceSeesAll
    ? [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE]
    : [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]
);

/** Admin write roles (configuration, user management, product authoring). */
export const ADMIN_ROLES = Object.freeze([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]);

/** Perimeter-scoped staff: an RM and the assistants working for them. */
export const RM_LIKE_ROLES = Object.freeze([USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT]);

/** Every staff role that may see client data (scoped or not). */
export const STAFF_ROLES = Object.freeze([...SEE_ALL_ROLES, ...RM_LIKE_ROLES]);

/** Roles that see the firm-wide order book. */
export const ORDER_BOOK_ROLES = Object.freeze(
  ACCESS_POLICY.rmSeesAllOrders ? [...STAFF_ROLES] : [...SEE_ALL_ROLES]
);

/** Roles that may place orders (mirrors OrderHelpers.canPlaceOrders). */
export const ORDER_PLACER_ROLES = Object.freeze([
  USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN
]);

/** Roles that may read any product's master data (catalogue, reports, charts). */
export const PRODUCT_CATALOGUE_ROLES = Object.freeze(
  ACCESS_POLICY.staffProductMasterDataOpen ? [...STAFF_ROLES] : [...SEE_ALL_ROLES]
);

export const isSeeAll = (user) => !!user && SEE_ALL_ROLES.includes(user.role);
export const isAdminRole = (user) => !!user && ADMIN_ROLES.includes(user.role);
export const isRmLike = (user) => !!user && RM_LIKE_ROLES.includes(user.role);
export const isStaff = (user) => !!user && STAFF_ROLES.includes(user.role);
export const isClientRole = (user) => !!user && user.role === USER_ROLES.CLIENT;
