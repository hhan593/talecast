import type { CommandReceipt } from '@/domain/commands';
import type { ReceiptStore } from '@/domain/ports';

import type { TalecastDatabase } from '../db';

interface ReceiptRow {
  result_json: string;
}

/** 幂等回执的 SQLite 实现 */
export class SqliteReceiptStore implements ReceiptStore {
  constructor(private readonly db: TalecastDatabase) {}

  get<T>(commandId: string): Promise<CommandReceipt<T> | null> {
    const row = this.db.getFirstSync<ReceiptRow>(
      'SELECT result_json FROM command_receipts WHERE command_id = ?',
      commandId,
    );
    return Promise.resolve(row ? (JSON.parse(row.result_json) as CommandReceipt<T>) : null);
  }

  put<T>(receipt: CommandReceipt<T>): Promise<void> {
    this.db.runSync(
      'INSERT OR REPLACE INTO command_receipts (command_id, result_json, created_at) VALUES (?, ?, ?)',
      receipt.commandId,
      JSON.stringify(receipt),
      receipt.createdAt,
    );
    return Promise.resolve();
  }
}
