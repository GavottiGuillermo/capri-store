#!/usr/bin/env node
// Genera el hash bcrypt para ADMIN_PASSWORD_HASH.
// Uso: node scripts/hash-password.js "miPasswordSegura"

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Uso: node scripts/hash-password.js "miPasswordSegura"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log(hash);
