import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { listUsers } from '@/lib/queries';
import { ROLE_META } from '@/lib/constants';
import { NewUserForm } from './NewUserForm';
import { UserRow } from './UserRow';

export default async function Users() {
  const s = await requireCap('users.manage');
  const rows = await listUsers();
  return (
    <Shell s={s} title="Users & Roles" kicker="Access control · separation of duties">
      <div className="card">
        <h3>Add a user</h3>
        <p className="muted small">New users must change their password on first sign-in.</p>
        <NewUserForm />
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((r: any) => <UserRow key={r.id} r={r} isSelf={r.id === s.id} />)}</tbody>
        </table></div>
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <h3>Roles &amp; departments</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Role</th><th>Department</th></tr></thead>
          <tbody>{Object.entries(ROLE_META).map(([role, m]) => <tr key={role}><td>{role}</td><td>{m.department}</td></tr>)}</tbody>
        </table></div>
      </div>
    </Shell>
  );
}
