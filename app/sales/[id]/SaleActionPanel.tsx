'use client';
import { ActionPanel, type UiAction } from '@/components/ActionPanel';
import { actSale } from '@/lib/actions';
export function SaleActionPanel({ saleId, actions }: { saleId: string; actions: UiAction[] }) {
  return <ActionPanel actions={actions} onSubmit={(key, input) => actSale(saleId, key, input)} />;
}
