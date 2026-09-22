'use client';
import { DynamicForm } from '@/components/DynamicForm';
import { newLead } from '@/lib/actions';
export function NewLeadForm() {
  return <DynamicForm submitLabel="Create lead" onSubmit={newLead} fields={[
    { name: 'name', label: 'Prospect name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'email', label: 'Email', type: 'text' },
    { name: 'source', label: 'Source / campaign', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]} />;
}
