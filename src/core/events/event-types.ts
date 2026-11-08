export type TCOSDomainEvent<TPayload = unknown> = {
  id: string;
  type: string;
  payload: TPayload;
  createdAt: string;
  source: string;
};

export type TCOSEventHandler<TPayload = unknown> = (
  event: TCOSDomainEvent<TPayload>
) => Promise<void> | void;