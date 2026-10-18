const { PrismaClient } = require('@prisma/client');
require('./env');

const prisma = new PrismaClient();

module.exports = prisma;
