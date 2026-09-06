/**
 * Structured errors.
 *
 * An MCP client is a language model, and "Error" tells it nothing it can act
 * on. Every failure here carries a machine-readable `code`, a sentence a model
 * can read, and — the field that actually changes behaviour — `retryable`, so a
 * client knows whether trying again could possibly help.
 *
 * The categories are the ones that call for genuinely different responses:
 *
 *   VALIDATION    the arguments were wrong        fix them and retry
 *   NOT_FOUND     the thing does not exist        look it up, or create it
 *   CONFLICT      the state moved underneath      re-read, then retry
 *   UNSUPPORTED   Flarent cannot do this at all   stop asking; see docs/MCP.md
 *   CONFIRMATION  destructive, needs an explicit  re-call with confirm: true
 *   UNAVAILABLE   a dependency is down            retryable
 *   RENDER_FAILED the render itself failed        read `message`
 *   INTERNAL      a bug here                      not the caller's fault
 *
 * `UNSUPPORTED` earns its place: this MCP layer deliberately does not expose
 * keyframes, video elements or per-property typography, because the engine has
 * no such concepts. A model that asks for one should be told *that*, clearly and
 * once, rather than receiving a validation error it will try to work around.
 */

export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNSUPPORTED: 'UNSUPPORTED_CAPABILITY',
  CONFIRMATION: 'CONFIRMATION_REQUIRED',
  UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RENDER_FAILED: 'RENDER_FAILED',
  INTERNAL: 'INTERNAL_ERROR',
};

/** Which codes could succeed if the identical call were made again. */
const RETRYABLE = new Set([ErrorCode.UNAVAILABLE]);

export class FlarentError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'FlarentError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE.has(code);
  }
}

export const validationError = (message, details) =>
  new FlarentError(ErrorCode.VALIDATION, message, details);

export const notFound = (message, details) =>
  new FlarentError(ErrorCode.NOT_FOUND, message, details);

export const conflict = (message, details) =>
  new FlarentError(ErrorCode.CONFLICT, message, details);

export const unsupported = (message, details) =>
  new FlarentError(ErrorCode.UNSUPPORTED, message, details);

export const confirmationRequired = (message, details) =>
  new FlarentError(ErrorCode.CONFIRMATION, message, details);

export const unavailable = (message, details) =>
  new FlarentError(ErrorCode.UNAVAILABLE, message, details);

export const renderFailed = (message, details) =>
  new FlarentError(ErrorCode.RENDER_FAILED, message, details);

/**
 * A tool result carrying a payload.
 *
 * The body is JSON in a text block rather than prose: the client is a model
 * that has to read fields out of it, and prose would make it guess. `success`
 * is always present so a caller can branch on one field regardless of tool.
 */
export const ok = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) }],
});

/**
 * A tool result carrying a failure.
 *
 * `isError` is set so MCP-aware clients surface it as a failure rather than as
 * content, and the same structured body is used either way so a client only
 * ever parses one shape.
 */
export const fail = (error) => {
  const structured =
    error instanceof FlarentError
      ? { code: error.code, message: error.message, retryable: error.retryable,
          ...(error.details ? { details: error.details } : {}) }
      : {
          code: ErrorCode.INTERNAL,
          // Never leak a stack trace to the model: it is noise it cannot act on.
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        };

  return {
    isError: true,
    content: [
      { type: 'text', text: JSON.stringify({ success: false, error: structured }, null, 2) },
    ],
  };
};

/**
 * Wrap a tool handler so no throw escapes as an unstructured MCP fault.
 *
 * Every tool is registered through this, which is what makes "every tool
 * returns a structured error" true by construction rather than by discipline.
 */
export const guard = (handler) => async (args, extra) => {
  try {
    return await handler(args, extra);
  } catch (error) {
    return fail(error);
  }
};
