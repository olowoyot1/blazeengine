import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { can } from '@/lib/rbac';
import { listUsers, listDepartments } from '@/lib/queries';
import { ROLES } from '@/lib/constants';
import { NewUserForm } from './NewUserForm';
import { UserRow } from './UserRow';
import { DepartmentsPanel } from './DepartmentsPanel';

export default async function Users() {
  const s = await requireCap('users.manage');
  const canManageAdmins = can(s.role, 'admins.manage');
  const [rows, departments] = await Promise.all([listUsers(), listDepartments()]);
  const assignableRoles = canManageAdmins ? ROLES : ROLES.filter(r => r !== 'ADMIN' && r !== 'SUPER_ADMIN');

  return (
    <Shell s={s} title="Users & Roles" kicker="Access control · separation of duties">
      {!canManageAdmins && (
        <div className="notice">
          You're signed in as an Administrator. Creating, promoting, deactivating or resetting the password of another
          Administrator or Super Administrator account requires a Super Administrator.
        </div>
      )}
      <div className="card">
        <h3>Add a user</h3>
        <p className="muted small">New users must change their password on first sign-in.</p>
        <NewUserForm assignableRoles={assignableRoles} departments={departments.filter((d: any) => d.active).map((d: any) => d.name)} />
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((r: any) => <UserRow key={r.id} r={r} isSelf={r.id === s.id} assignableRoles={assignableRoles} canManageAdmins={canManageAdmins} />)}</tbody>
        </table></div>
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <h3>Departments</h3>
        <p className="muted small">The list used when assigning a department to a user. Retiring a department keeps it on existing users' records but hides it from the picker for new ones.</p>
        <DepartmentsPanel departments={departments} />
      </div>
    </Shell>
  );
}
