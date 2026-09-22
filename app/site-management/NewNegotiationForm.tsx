'use client';
import { DynamicForm } from '@/components/DynamicForm';
import { newNegotiation } from '@/lib/actions';
export function NewNegotiationForm() {
  return <DynamicForm submitLabel="Submit negotiation" onSubmit={newNegotiation} fields={[
    { name: 'sale_id', label: 'Related sale ID (optional)', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true, placeholder: 'e.g. Site survey logistics' },
    { name: 'vendor', label: 'Vendor', type: 'text', required: true },
    { name: 'negotiated_amount', label: 'Negotiated amount (₦)', type: 'number', required: true, min: 1 },
    { name: 'negotiation_notes', label: 'Negotiation details', type: 'textarea', required: true },
    { name: 'negotiation_url', label: 'Supporting document link', type: 'url' },
  ]} />;
}
