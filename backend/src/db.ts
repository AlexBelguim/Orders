import { PrismaClient } from '@prisma/client';

// Single shared Prisma instance. Avoids exhausting connections during dev hot reload.
const prisma = new PrismaClient();
export default prisma;
