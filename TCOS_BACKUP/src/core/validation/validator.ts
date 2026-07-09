export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

export function valid(): ValidationResult {
  return {
    valid: true,
    errors: [],
  };
}

export function invalid(errors: ValidationError[]): ValidationResult {
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function requiredString(value: unknown, field: string): ValidationError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      field,
      message: `${field} is required`,
    };
  }

  return null;
}

export function nonNegativeNumber(value: unknown, field: string): ValidationError | null {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return {
      field,
      message: `${field} must be a non-negative number`,
    };
  }

  return null;
}

export function nonNegativeInteger(value: unknown, field: string): ValidationError | null {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return {
      field,
      message: `${field} must be a non-negative integer`,
    };
  }

  return null;
}