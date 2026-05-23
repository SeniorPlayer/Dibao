import type {
  DibaoDatabase,
  ReaderCommandEventRow,
  RecordReaderCommandEventInput
} from "../types.js";

export interface ReaderCommandEventRepository {
  record(input: RecordReaderCommandEventInput): ReaderCommandEventRow;
  transaction<T>(work: () => T): T;
}

export class SqliteReaderCommandEventRepository implements ReaderCommandEventRepository {
  constructor(private readonly db: DibaoDatabase) {}

  record(input: RecordReaderCommandEventInput): ReaderCommandEventRow {
    this.db
      .prepare(
        `
          insert into reader_command_events (
            id,
            command_type,
            scope_json,
            result_json,
            created_at
          )
          values (?, ?, ?, ?, ?)
        `
      )
      .run(
        input.id,
        input.commandType,
        JSON.stringify(input.scope),
        JSON.stringify(input.result),
        input.createdAt
      );

    return {
      id: input.id,
      commandType: input.commandType,
      scopeJson: JSON.stringify(input.scope),
      resultJson: JSON.stringify(input.result),
      createdAt: input.createdAt
    };
  }

  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }
}
