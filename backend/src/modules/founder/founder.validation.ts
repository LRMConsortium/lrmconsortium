export const validateFounderProfile = (body: Record<string, unknown>) => {
  const errors = [];

  if (!body.fullName || typeof body.fullName !== 'string') {
    errors.push('fullName is required and must be a string');
  }

  if (!body.founderTitle || typeof body.founderTitle !== 'string') {
    errors.push('founderTitle is required and must be a string');
  }

  if (!body.email || typeof body.email !== 'string') {
    errors.push('email is required and must be a string');
  }

  return errors;
};
