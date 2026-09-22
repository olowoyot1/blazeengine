// Usage: npm run hash -- 'YourStrongPassword1' admin@company.com "Full Name"
import bcrypt from 'bcryptjs';
const [pw, email = 'admin@landblaze.local', name = 'System Administrator'] = process.argv.slice(2);
if (!pw || pw.length < 10) { console.error("Provide a password of at least 10 characters: npm run hash -- 'Password123!' email name"); process.exit(1); }
const hash = bcrypt.hashSync(pw, 12);
console.log(`\n-- Run in the Neon SQL editor after db/schema.sql:\ninsert into users(name,email,password_hash,role,department)\nvalues ('${name.replace(/'/g, "''")}','${email.replace(/'/g, "''")}','${hash}','ADMIN','Management');\n`);
