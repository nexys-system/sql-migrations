import * as T from "./type";
import {
  OkPacket,
  ResultSetHeader,
  RowDataPacket,
  FieldPacket,
} from "mysql2/promise";

import * as U from "./utils";

type Response = [
  OkPacket | ResultSetHeader | RowDataPacket[] | RowDataPacket[][] | OkPacket[],
  FieldPacket[]
];

interface SQL {
  execQuery: (query: string) => Promise<Response>;
}

// manages migration
// inspiration from flyway - https://flywaydb.org/
export const runMigrations = async (
  migrations: T.Migration[],
  s: SQL
): Promise<T.MigrationRow[]> => {
  U.checkSequence(migrations);
  // create table if not exists
  //console.log(createMigrationTable);
  await s.execQuery(U.createMigrationTable);

  // get all migrations
  const [r] = await s.execQuery(U.getMigrations);
  const y = r as RowDataPacket[] as T.MigrationRow[];

  const lastRow = U.getLastRow(y);

  const lastRank = lastRow.installed_rank;

  const pRows = migrations.map(async (migration, i) => {
    const version = U.toVersion(migration.version, migration.idx);
    const checksum = U.getChecksum(migration.sql);

    // find previous migration with same version and compare checksums
    if (U.findPreviousMigrations(version, checksum, y)) {
      return;
    }

    const t1 = new Date().getTime();
    const [rm] = await s.execQuery(migration.sql);
    const t2 = new Date().getTime();

    const success: number = getSuccess(rm as OkPacket | OkPacket[]);

    const row: T.MigrationRow = U.migrationToRow(
      migration.name,
      version,
      t2 - t1,
      success,
      checksum,
      lastRank + i + 1
    );

    return row;
  });

  const rawRows = await Promise.all(pRows);

  const rows: T.MigrationRow[] = rawRows.filter(isNotNull);

  if (rows.length !== migrations.length) {
    throw Error("something went wrong while applying migrations");
  }

  // console.log(rows);

  // enter result in flyway table
  const sql = U.migrationsToSQL(rows);
  const [rm] = await s.execQuery(sql);
  console.log(rm);

  return rows;
};

const getSuccess = (rm: OkPacket | OkPacket[]): number => {
  // if array return the last one
  if (Array.isArray(rm)) {
    const l = rm.length;
    return getSuccess(rm[l - 1]);
  }

  return rm.serverStatus;
};

const isNotNull = <A>(x: A | null | undefined): x is A =>
  x !== null && x !== undefined;
