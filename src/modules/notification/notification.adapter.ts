import { NotificationChannel } from '@prisma/client';

export interface NotificationSendRequest {
  phone: string;
  content: string;
  type: string;
  channel: NotificationChannel;
}

export interface NotificationSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NotificationAdapter {
  send(request: NotificationSendRequest): Promise<NotificationSendResult>;
  supports(channel: NotificationChannel): boolean;
}

export class MockSmsAdapter implements NotificationAdapter {
  private simulateFailure: boolean = false;

  constructor(simulateFailure: boolean = false) {
    this.simulateFailure = simulateFailure;
  }

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    console.log(`[MockSmsAdapter] Sending SMS to ${request.phone}: ${request.content}`);

    if (this.simulateFailure) {
      return {
        success: false,
        error: 'Mock failure for testing purposes'
      };
    }

    return {
      success: true,
      messageId: `mock-sms-${Date.now()}`
    };
  }

  supports(channel: NotificationChannel): boolean {
    return channel === NotificationChannel.SMS;
  }

  setSimulateFailure(value: boolean): void {
    this.simulateFailure = value;
  }
}

export class NotificationAdapterFactory {
  private static adapters: Map<NotificationChannel, NotificationAdapter> = new Map();

  private static initializeAdapters(): void {
    if (this.adapters.size === 0) {
      const mockSmsAdapter = new MockSmsAdapter();
      this.adapters.set(NotificationChannel.SMS, mockSmsAdapter);
    }
  }

  static getAdapter(channel: NotificationChannel): NotificationAdapter {
    this.initializeAdapters();

    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`No adapter found for channel: ${channel}`);
    }

    return adapter;
  }

  static registerAdapter(channel: NotificationChannel, adapter: NotificationAdapter): void {
    this.initializeAdapters();
    this.adapters.set(channel, adapter);
  }

  static clearAdapters(): void {
    this.adapters.clear();
  }
}
