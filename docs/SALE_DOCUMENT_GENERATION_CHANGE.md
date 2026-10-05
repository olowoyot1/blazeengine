# Sale document generation

Sales and Accounts both need a Generate Documents capability.

## Sales
After Sales Manager verification, Sales can generate the Contract of Sale and Letter of Acknowledgement from the approved sale record. Both PDFs must be stored against the sale and audited.

## Accounts
Accounts keeps its existing Generate Invoice / Sales Order + Receipt capability and may also generate the Contract of Sale and Letter of Acknowledgement from the verified sale record. The action must be idempotent and must not duplicate documents unless explicitly reissued.
