'use client';
import { DynamicForm } from '@/components/DynamicForm';
import { newDirectExpense } from '@/lib/actions';
export function NewDirectExpenseForm() {
  return <DynamicForm submitLabel="Submit expense" onSubmit={newDirectExpense} fields={[
    { name: 'sale_id', label: 'Related sale ID (optional)', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'vendor', label: 'Vendor', type: 'text', required: true },
    { name: 'amount', label: 'Amount (₦)', type: 'number', required: true, min: 1 },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
  ]} />;
}
