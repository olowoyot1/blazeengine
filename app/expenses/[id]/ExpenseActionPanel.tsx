'use client';
import { ActionPanel, type UiAction } from '@/components/ActionPanel';
import { actExpense } from '@/lib/actions';
export function ExpenseActionPanel({ expenseId, actions }: { expenseId: string; actions: UiAction[] }) {
  return <ActionPanel actions={actions} onSubmit={(key, input) => actExpense(expenseId, key, input)} />;
}
