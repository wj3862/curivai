export class CurivaiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CurivaiError';
  }
}

export class ConfigError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

export class PersonaError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PERSONA_ERROR', details);
    this.name = 'PersonaError';
  }
}

export class DbError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DB_ERROR', details);
    this.name = 'DbError';
  }
}

export class SourceError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SOURCE_ERROR', details);
    this.name = 'SourceError';
  }
}

export class IngestError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INGEST_ERROR', details);
    this.name = 'IngestError';
  }
}

export class LlmError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'LLM_ERROR', details);
    this.name = 'LlmError';
  }
}

export class ScoreError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SCORE_ERROR', details);
    this.name = 'ScoreError';
  }
}

export class StudioError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'STUDIO_ERROR', details);
    this.name = 'StudioError';
  }
}

export class ComposeError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'COMPOSE_ERROR', details);
    this.name = 'ComposeError';
  }
}

export class LintError extends CurivaiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'LINT_ERROR', details);
    this.name = 'LintError';
  }
}
