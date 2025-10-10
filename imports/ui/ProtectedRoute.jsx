import React from 'react';
import { USER_ROLES } from '/imports/api/users';

const ProtectedRoute = ({ children, requiredRole, user, fallback = null }) => {
  if (!user) {
    return fallback || <div>Please log in to access this content.</div>;
  }

  if (requiredRole) {
    const hasRequiredRole = (() => {
      switch (requiredRole) {
        case USER_ROLES.SUPERADMIN:
          return user.role === USER_ROLES.SUPERADMIN;
        case USER_ROLES.ADMIN:
          return user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN;
        case USER_ROLES.CLIENT:
          return user.role === USER_ROLES.CLIENT || user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN;
        default:
          return false;
      }
    })();

    if (!hasRequiredRole) {
      return fallback || (
        <div style={{ 
          padding: '20px', 
          backgroundColor: '#f8d7da', 
          border: '1px solid #f5c6cb',
          borderRadius: '5px',
          color: '#721c24'
        }}>
          Access denied. You need {requiredRole} role to view this content.
        </div>
      );
    }
  }

  return children;
};

export default ProtectedRoute;