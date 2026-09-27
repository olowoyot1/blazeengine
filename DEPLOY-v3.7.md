# Deploy v3.7

1. Push this code to the existing GitHub repository connected to Vercel.
2. Apply `db/upgrade-v3.7.sql` to the existing Neon database.
3. Redeploy in Vercel.
4. Test in this order:
   - Create lead -> returns to Leads list.
   - Convert lead -> returns to Customers / Clients list.
   - Complete client profile -> returns to Customers / Clients list.
   - Create sale -> sale is Pending Sales Manager Approval.
   - Confirm Sales Manager sees Approve New Sale.
   - Approve sale -> creator receives notification and sale becomes ready for payment proof.
   - Complete an expense approval through CEO -> expense becomes Fully Approved and Finance/Accounts receives notification.
   - Finance/Accounts disburse -> upload payment evidence -> expense becomes Paid.
   - Open Notifications -> mark one read and Mark All Read.
   - Test desktop, tablet and phone widths.


### v3.8 evidence separation
Run `db/upgrade-v3.8.sql` after v3.7. This adds the Finance payment advice/bank receipt table and upload-purpose tracking.
