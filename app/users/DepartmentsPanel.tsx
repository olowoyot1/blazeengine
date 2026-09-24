'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDepartment, setDepartmentActive } from '@/lib/actions';
import { Badge } from '@/components/Badge';

export function DepartmentsPanel({ departments }: { departments: any[] }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function add(e: React.FormEvent) {
    e.preventDefault(); setError('');
    start(async () => {
      const res = await createDepartment(name);
      if ('error' in res) setError(res.error);
      else { setName(''); router.refresh(); }
    });
  }
  function toggle(id: string, active: boolean) {
    start(async () => { await setDepartmentActive(id, active); router.refresh(); });
  }

  return (
    <div>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="input" style={{ margin: 0, flex: 1 }} placeholder="New department name" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn primary" disabled={pending}>Add</button>
      </form>
      {error && <div className="alert">{error}</div>}
      <div className="table-wrap"><table className="table"><thead><tr><th>Department</th><th>Staff</th><th>Status</th><th></th></tr></thead>
        <tbody>{departments.map((d: any) => (
          <tr key={d.id}>
            <td>{d.name}</td><td>{d.staff_count}</td>
            <td>{d.active ? <Badge status="APPROVED" label="Active" /> : <Badge status="REJECTED" label="Retired" />}</td>
            <td>
              {d.active
                ? <button className="btn light" disabled={pending} onClick={() => toggle(d.id, false)}>Retire</button>
                : <button className="btn light" disabled={pending} onClick={() => toggle(d.id, true)}>Reactivate</button>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
