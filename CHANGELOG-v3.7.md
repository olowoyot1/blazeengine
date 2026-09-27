# Landblaze Engine v3.7

## Workflow and UX fixes
- New sales start as `PENDING_SALES_APPROVAL` and require Sales Manager approval before payment proof can be submitted.
- A Sales Manager cannot approve their own newly-created sale.
- New lead submission redirects back to the Leads list.
- Client profile submission redirects to the Customers / Clients list.
- New sale submission redirects back to the Sales list.
- Generic supporting-document uploads have been moved out of the Sales detail page and into Expense Operations.
- Added expense supporting-document storage and upload UI.
- CEO completion of the expense approval chain now moves the expense to `FULLY_APPROVED` and notifies Finance Operations + Accountant to disburse.
- Finance & Accounts can disburse and upload bank/payment evidence in one action; this moves the expense to `PAID` and notifies the next receipt step.
- Added individual notification read/unread controls and preserved Mark All Read.
- Workflow actions now revalidate the notification view as well as the affected record/list.
- Lead creation/status changes now notify the next relevant sales-management line.
- Payroll approval/disbursement notifications strengthened.
- Improved mobile/tablet responsive layout and notification presentation.

## Database
Run `db/upgrade-v3.7.sql` once against the existing Neon database.
