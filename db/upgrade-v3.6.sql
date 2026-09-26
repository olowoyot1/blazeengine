-- v3.6: merge Accounts and Finance Operations into one departmental menu/department.
-- Safe to run after v3.5. Existing users assigned to either legacy department
-- are moved to the combined department.

INSERT INTO departments(name) VALUES ('Accounts & Finance Operations')
ON CONFLICT (name) DO NOTHING;

UPDATE users
SET department = 'Accounts & Finance Operations'
WHERE department IN ('Accounts', 'Finance Operations');

UPDATE employees
SET department = 'Accounts & Finance Operations'
WHERE department IN ('Accounts', 'Finance Operations');

UPDATE departments
SET active = false
WHERE name IN ('Accounts', 'Finance Operations');
