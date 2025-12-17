import { test, expect } from "bun:test";
import { OcError, InvalidTechError, RetryableError, NonRetryableError } from "../src/lib/errors.ts";
import { isRetryableError, retryWithBackoff } from "../src/services/oc.ts";

test("isRetryableError classifies errors correctly", () => {
  // Non-retryable
  expect(isRetryableError(new InvalidTechError("test", []))).toBe(false);
  expect(isRetryableError(new NonRetryableError("test"))).toBe(false);

  // Retryable
  expect(isRetryableError(new OcError("port exhausted"))).toBe(true);
  expect(isRetryableError(new OcError("timeout"))).toBe(true);
  expect(isRetryableError(new RetryableError("test"))).toBe(true);

  // Default retryable
  expect(isRetryableError(new Error("unknown"))).toBe(true);
});

test("retryWithBackoff retries on retryable errors", async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    if (attempts < 3) {
      throw new RetryableError("retry me");
    }
    return "success";
  };

  const result = await retryWithBackoff(fn, isRetryableError, 3, 10, 100);
  expect(result).toBe("success");
  expect(attempts).toBe(3);
});

test("retryWithBackoff does not retry on non-retryable errors", async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    throw new NonRetryableError("don't retry");
  };

  await expect(retryWithBackoff(fn, isRetryableError, 3, 10, 100)).rejects.toThrow(NonRetryableError);
  expect(attempts).toBe(1);
});

test("retryWithBackoff gives up after max retries", async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    throw new RetryableError("keep retrying");
  };

  await expect(retryWithBackoff(fn, isRetryableError, 2, 10, 100)).rejects.toThrow(RetryableError);
  expect(attempts).toBe(3); // initial + 2 retries
});