import type { CommandReceipt } from '@/domain/commands';
import type { ReceiptStore } from '@/domain/ports';

export class FakeReceiptStore implements ReceiptStore {
  private map = new Map<string, CommandReceipt<unknown>>();

  get<T>(commandId: string): Promise<CommandReceipt<T> | null> {
    const hit = this.map.get(commandId);
    return Promise.resolve(hit ? (hit as CommandReceipt<T>) : null);
  }

  put<T>(receipt: CommandReceipt<T>): Promise<void> {
    this.map.set(receipt.commandId, receipt as CommandReceipt<unknown>);
    return Promise.resolve();
  }
}
