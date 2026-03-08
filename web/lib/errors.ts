function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error"
): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (isRecord(error) && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function getReadContractsError(
  queryError: unknown,
  results: readonly unknown[] | undefined,
  fallback: string
): Error | undefined {
  if (queryError) {
    return new Error(getErrorMessage(queryError, fallback));
  }

  const failedResult = results?.find(
    (result) => isRecord(result) && result.status === "failure"
  );

  if (!failedResult || !isRecord(failedResult)) {
    return undefined;
  }

  return new Error(getErrorMessage(failedResult.error, fallback));
}

export function isFrontendConfigError(error: unknown): boolean {
  const message = getErrorMessage(error, "").toLowerCase();
  return (
    message.includes("next_public_") ||
    message.includes(".env") ||
    message.includes("mainnet only")
  );
}