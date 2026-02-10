'use client';

import { hasPermission, Resource, Action, canChangeOrderStatus, canEditOrder } from '@/lib/permissions';
import { OrderStatus, User, Order } from '@/lib/definitions';

export function usePermissions(userProfile: User | null | undefined) {
  
  const can = (action: Action, resource: Resource) => {
    return hasPermission(userProfile, resource, action);
  };

  const canTransitionOrder = (currentStatus: OrderStatus, newStatus: OrderStatus) => {
    if (!userProfile) return false;
    return canChangeOrderStatus(userProfile, currentStatus, newStatus);
  };

  const canEdit = (order: Order) => {
    if (!userProfile) return false;
    return canEditOrder(userProfile, order);
  };

  return { can, canTransitionOrder, canEdit, role: userProfile?.role };
}
