'use client';
import { DynamicForm } from '@/components/DynamicForm';
import { newLead } from '@/lib/actions';
import { useRouter } from 'next/navigation';

export function NewLeadForm() {
  const router = useRouter();
  return <DynamicForm submitLabel="Create lead" onSubmit={async (input) => {
    const result = await newLead(input);
    if ('error' in result) return result;
    router.push('/leads');
    return result;
  }} fields={[
    { name: 'name', label: 'Prospect name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'email', label: 'Email', type: 'text' },
    { name: 'source', label: 'Source / campaign', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]} />;
}
