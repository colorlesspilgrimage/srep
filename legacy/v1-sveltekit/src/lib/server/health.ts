export type HealthLogger = {
  error: (obj: object, msg?: string) => void;
};

export type HealthResult = {
  status: 200 | 503;
  body: { status: 'ok' | 'error' };
};

export async function checkHealth(
  ping: () => Promise<void>,
  logger: HealthLogger,
): Promise<HealthResult> {
  try {
    await ping();
    return { status: 200, body: { status: 'ok' } };
  } catch (error: unknown) {
    logger.error({ err: error }, 'health check failed');
    return { status: 503, body: { status: 'error' } };
  }
}
