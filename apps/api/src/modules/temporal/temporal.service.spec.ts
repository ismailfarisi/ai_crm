import { Connection } from '@temporalio/client';
import { TemporalService } from './temporal.service';

jest.mock('@temporalio/client', () => ({
  Connection: { connect: jest.fn() },
  Client: jest.fn().mockImplementation((opts: unknown) => ({ opts })),
}));

const connect = Connection.connect as jest.Mock;

describe('TemporalService', () => {
  let service: TemporalService;

  beforeEach(() => {
    connect.mockReset();
    service = new TemporalService();
  });

  it('does not throw at init when Temporal is down', async () => {
    connect.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('connects lazily on the next getClient after a failed init', async () => {
    const connection = { close: jest.fn() };
    connect
      .mockRejectedValueOnce(new Error('UNAVAILABLE'))
      .mockResolvedValueOnce(connection);
    await service.onModuleInit();

    const client = await service.getClient();

    expect(client).toEqual({ opts: { connection } });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('reuses the client once connected', async () => {
    connect.mockResolvedValue({ close: jest.fn() });
    await service.onModuleInit();
    const a = await service.getClient();
    const b = await service.getClient();
    expect(a).toBe(b);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('concurrent callers share one connect', async () => {
    let resolve!: (c: unknown) => void;
    connect.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const calls = [service.getClient(), service.getClient(), service.getClient()];
    resolve({ close: jest.fn() });
    const clients = await Promise.all(calls);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(clients[1]).toBe(clients[0]);
    expect(clients[2]).toBe(clients[0]);
  });

  it('a failed connect rejects that call; the next call tries again', async () => {
    connect
      .mockRejectedValueOnce(new Error('UNAVAILABLE'))
      .mockResolvedValueOnce({ close: jest.fn() });

    await expect(service.getClient()).rejects.toThrow('UNAVAILABLE');
    await expect(service.getClient()).resolves.toBeDefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('closes the connection on shutdown', async () => {
    const connection = { close: jest.fn().mockResolvedValue(undefined) };
    connect.mockResolvedValueOnce(connection);
    await service.getClient();
    await service.onModuleDestroy();
    expect(connection.close).toHaveBeenCalled();
  });
});
