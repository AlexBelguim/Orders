import { PrismaClient } from '@prisma/client';

// Single shared Prisma instance. Avoids exhausting connections during dev hot reload.
const prisma = new PrismaClient();

// SQLite defaults to the rollback-journal mode, which takes a whole-file lock
// on every write and serializes concurrent order submissions (each one queues
// behind the last, so a festival rush turns into multi-second waits). WAL lets
// readers proceed while a write is in progress and is the standard production
// setting for this workload.
prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;').catch((e) => console.error('[db] failed to set WAL mode', e));

export default prisma;
