const { unprocessable } = require('../lib/errors');

// validate({ body: schema, query: schema, params: schema }) — zod schemas.
// Parsed (coerced) values replace the originals so handlers get clean types.
module.exports = function validate(schemas) {
  return (req, res, next) => {
    const details = [];
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          details.push({ in: part, field: issue.path.join('.') || part, message: issue.message });
        }
      } else {
        req[part === 'query' ? 'validatedQuery' : part] = result.data;
      }
    }
    if (details.length) return next(unprocessable('Request validation failed', details));
    return next();
  };
};
