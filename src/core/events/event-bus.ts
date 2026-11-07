import type { TCOSDomainEvent, TCOSEventHandler } from "./event-types";

function createEventId() {
  return crypto.randomUUID();
}

export class TCOSEventBus {
  private handlers = new Map<string, TCOSEventHandler[]>();

  subscribe<TPayload>(
    eventType: string,
    handler: TCOSEventHandler<TPayload>
  ): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler as TCOSEventHandler);
    this.handlers.set(eventType, existing);
  }

  async publish<TPayload>(
    eventType: string,
    payload: TPayload,
    source = "tcos-core"
  ): Promise<TCOSDomainEvent<TPayload>> {
    const event: TCOSDomainEvent<TPayload> = {
      id: createEventId(),
      type: eventType,
      payload,
      createdAt: new Date().toISOString(),
      source,
    };

    const handlers = this.handlers.get(eventType) ?? [];

    for (const handler of handlers) {
      await handler(event);
    }

    return event;
  }
}

export const eventBus = new TCOSEventBus();